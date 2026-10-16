using System;
using System.Diagnostics;
using System.Drawing;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace MoniteurPC;

/// <summary>
/// Moniteur PC : une icône près de l'horloge. Mesure le PC chaque seconde, sert la page du
/// téléphone et prévient quand quelque chose ne va pas.
/// </summary>
public static class Program
{
    public static string Version =>
        Assembly.GetExecutingAssembly().GetName().Version?.ToString(2) ?? "1.0";

    public static double Now() => DateTimeOffset.UtcNow.ToUnixTimeMilliseconds() / 1000.0;

    private static readonly object Lock = new();
    private static Snapshot _state = new();
    private static NotifyIcon? _tray;
    private static Control? _ui; // pour toucher l'icône depuis le fil des mesures

    [STAThread]
    public static int Main(string[] args)
    {
        // --test : démarrage sans fenêtre ni question (utilisé par la vérification automatique).
        bool test = args.Contains("--test");
        using var single = new Mutex(true, @"Global\MoniteurPC", out bool first);
        if (!first) return 0;

        ApplicationConfiguration.Initialize();
        var settings = Settings.Load();

        if (!test)
        {
            Setup.EnsureDriver(settings, interactive: true);
            Setup.EnsureFirewall(settings);
            if (settings.AutoStart && !Setup.AutoStartInstalled()) Setup.SetAutoStart(true);
        }

        var tracker = new FpsTracker();
        var presentMon = new PresentMonRunner(tracker);
        presentMon.Start();
        var alerts = new AlertEngine(a => Notify(a));
        var server = new Server(settings.Port, () => { lock (Lock) return _state; });
        server.Start();

        var sampler = new Thread(() => Sample(settings, tracker, alerts)) { IsBackground = true, Name = "Mesures" };
        sampler.Start();

        if (test)
        {
            Thread.Sleep(Timeout.Infinite);
            return 0;
        }

        _ui = new Control();
        _ui.CreateControl();
        _tray = BuildTray(settings);
        Application.ApplicationExit += (_, _) =>
        {
            presentMon.Stop();
            server.Stop();
            if (_tray is not null) _tray.Visible = false;
        };
        _tray.ShowBalloonTip(5000, "Moniteur PC",
            $"Prêt. Sur le téléphone, ouvre l'app Moniteur PC (ou http://{LanIp()}:{settings.Port}).", ToolTipIcon.Info);
        Application.Run();
        return 0;
    }

    private static void Sample(Settings settings, FpsTracker tracker, AlertEngine alerts)
    {
        HardwareReader? reader = null;
        string sensorError = "";
        try { reader = new HardwareReader(); }
        catch (Exception e) { sensorError = e.Message; }
        var system = SystemInfoReader.Read();
        while (true)
        {
            var start = DateTime.UtcNow;
            double now = Now();
            var s = new Snapshot
            {
                Time = now, Version = Version, System = system,
                Uptime = Environment.TickCount64 / 1000.0,
                Thresholds = settings.Thresholds,
                DriverOk = HardwareReader.DriverInstalled(),
                FpsStatus = tracker.Status,
                Fps = tracker.Snapshot(now, PresentMonRunner.ForegroundPid()),
            };
            try { reader?.Fill(s); }
            catch (Exception e) { sensorError = e.Message; }
            if (reader is null) s.FpsStatus += sensorError == "" ? "" : " · capteurs : " + sensorError;
            alerts.Evaluate(s, settings.Thresholds, now);
            s.Alerts = alerts.ActiveSorted();
            s.History = alerts.History();
            lock (Lock) _state = s;
            UpdateTrayText(s);
            int wait = 1000 - (int)(DateTime.UtcNow - start).TotalMilliseconds;
            if (wait > 0) Thread.Sleep(wait);
        }
    }

    private static void OnUi(Action action)
    {
        if (_ui is { IsHandleCreated: true } && _tray is not null)
            try { _ui.BeginInvoke(action); } catch { }
    }

    private static void Notify(Alert a)
    {
        if (a.Level == "info") return;
        OnUi(() => _tray!.ShowBalloonTip(8000, a.Title, a.Detail,
            a.Level == "critique" ? ToolTipIcon.Error : ToolTipIcon.Warning));
    }

    private static void UpdateTrayText(Snapshot s)
    {
        string text = $"Moniteur PC · CPU {s.CpuTemp:0}° · GPU {s.GpuTemp:0}°" + (s.Fps is null ? "" : $" · {s.Fps.Fps} FPS");
        OnUi(() => _tray!.Text = text.Length > 63 ? text[..63] : text);
    }

    private static NotifyIcon BuildTray(Settings settings)
    {
        var menu = new ContextMenuStrip();
        menu.Items.Add("Ouvrir sur ce PC", null, (_, _) =>
            Process.Start(new ProcessStartInfo($"http://localhost:{settings.Port}/") { UseShellExecute = true }));
        menu.Items.Add($"Adresse pour le téléphone : http://{LanIp()}:{settings.Port}").Enabled = false;
        var auto = new ToolStripMenuItem("Démarrer avec Windows") { Checked = Setup.AutoStartInstalled(), CheckOnClick = true };
        auto.CheckedChanged += (_, _) =>
        {
            settings.AutoStart = auto.Checked;
            settings.Save();
            Setup.SetAutoStart(auto.Checked);
        };
        menu.Items.Add(auto);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Quitter", null, (_, _) => Application.Exit());
        return new NotifyIcon { Icon = MakeIcon(), Text = "Moniteur PC", Visible = true, ContextMenuStrip = menu };
    }

    [DllImport("user32.dll")] private static extern bool DestroyIcon(IntPtr handle);

    /// <summary>Icône dessinée à la volée : un rond bleu, comme les jauges de la page.</summary>
    private static Icon MakeIcon()
    {
        using var bmp = new Bitmap(32, 32);
        using (var g = Graphics.FromImage(bmp))
        {
            g.SmoothingMode = System.Drawing.Drawing2D.SmoothingMode.AntiAlias;
            g.Clear(Color.Transparent);
            using var track = new Pen(Color.FromArgb(34, 50, 74), 5);
            using var bar = new Pen(Color.FromArgb(79, 143, 230), 5) { StartCap = System.Drawing.Drawing2D.LineCap.Round, EndCap = System.Drawing.Drawing2D.LineCap.Round };
            g.DrawArc(track, 4, 4, 24, 24, 135, 270);
            g.DrawArc(bar, 4, 4, 24, 24, 135, 190);
        }
        IntPtr h = bmp.GetHicon();
        var icon = (Icon)Icon.FromHandle(h).Clone();
        DestroyIcon(h);
        return icon;
    }

    public static string LanIp()
    {
        try
        {
            using var s = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
            s.Connect("10.255.255.255", 1);
            return ((IPEndPoint)s.LocalEndPoint!).Address.ToString();
        }
        catch { return "127.0.0.1"; }
    }
}

public static class SystemInfoReader
{
    public static SystemInfo Read()
    {
        var info = new SystemInfo
        {
            Threads = Environment.ProcessorCount,
            Machine = Environment.MachineName,
            Os = RuntimeInformation.OSDescription,
        };
        try
        {
            using var cpu = Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\CentralProcessor\0");
            info.Cpu = (cpu?.GetValue("ProcessorNameString") as string)?.Trim() ?? "";
            using var nt = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows NT\CurrentVersion");
            string name = nt?.GetValue("ProductName") as string ?? "Windows";
            if (int.TryParse(nt?.GetValue("CurrentBuildNumber") as string, out int build))
            {
                if (build >= 22000) name = name.Replace("Windows 10", "Windows 11");
                info.Os = $"{name} (build {build})";
            }
        }
        catch { }
        try
        {
            var mem = new MemoryStatus();
            if (GlobalMemoryStatusEx(mem)) info.RamGb = Math.Round(mem.TotalPhys / 1073741824.0, 1);
        }
        catch { }
        return info;
    }

    [StructLayout(LayoutKind.Sequential)]
    private sealed class MemoryStatus
    {
        public uint Length = (uint)Marshal.SizeOf<MemoryStatus>();
        public uint MemoryLoad;
        public ulong TotalPhys, AvailPhys, TotalPageFile, AvailPageFile, TotalVirtual, AvailVirtual, AvailExtendedVirtual;
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GlobalMemoryStatusEx([In, Out] MemoryStatus status);
}
