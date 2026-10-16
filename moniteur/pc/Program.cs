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

    public static readonly string LogFile = System.IO.Path.Combine(Settings.DataDir, "erreurs.log");

    public static void Log(string message)
    {
        try
        {
            System.IO.Directory.CreateDirectory(Settings.DataDir);
            System.IO.File.AppendAllText(LogFile, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {message}{Environment.NewLine}");
        }
        catch { }
    }

    private static void Fatal(string message, bool show)
    {
        Log(message);
        if (show)
            MessageBox.Show(message + $"\n\nDétails : {LogFile}", "Moniteur PC", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    [STAThread]
    public static int Main(string[] args)
    {
        // --test : démarrage sans fenêtre ni question (utilisé par la vérification automatique).
        // --auto : lancé par Windows à l'ouverture de session, sans message de bienvenue.
        bool test = args.Contains("--test");
        bool auto = args.Contains("--auto");
        ApplicationConfiguration.Initialize();
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.CatchException);
        Application.ThreadException += (_, e) => Fatal("Erreur : " + e.Exception, !test);
        AppDomain.CurrentDomain.UnhandledException += (_, e) => Fatal("Erreur : " + e.ExceptionObject, !test);

        using var single = new Mutex(true, @"Global\MoniteurPC", out bool first);
        if (!first)
        {
            if (!test && !auto)
                MessageBox.Show("Moniteur PC tourne déjà.\n\nSon icône est près de l'horloge, en bas à droite " +
                                "(clique sur la petite flèche ^ si tu ne la vois pas).",
                    "Moniteur PC", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }

        var settings = Settings.Load();
        if (!test)
        {
            // Une erreur ici ne doit pas empêcher le moniteur de démarrer.
            try { Setup.EnsureDriver(settings, interactive: true); } catch (Exception e) { Log("Pilote : " + e); }
            try { Setup.EnsureFirewall(settings); } catch (Exception e) { Log("Pare-feu : " + e); }
            // Toujours réécrite : elle peut encore pointer vers un ancien exe (ou l'ancienne version Python).
            try { if (settings.AutoStart) Setup.SetAutoStart(true); } catch (Exception e) { Log("Démarrage auto : " + e); }
        }

        var tracker = new FpsTracker();
        var presentMon = new PresentMonRunner(tracker);
        var alerts = new AlertEngine(a => Notify(a));
        var server = new Server(settings.Port, () => { lock (Lock) return _state; });
        try
        {
            server.Start();
        }
        catch (Exception e)
        {
            Fatal($"Impossible d'ouvrir le port {settings.Port} : {e.Message}\n\n" +
                  "Un autre programme l'utilise, probablement l'ancienne version de Moniteur PC. " +
                  "Ferme-la (Gestionnaire des tâches > MoniteurPC > Fin de tâche) ou redémarre le PC, puis relance.", !test);
            return 1;
        }
        presentMon.Start();

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
        if (!auto)
            MessageBox.Show("Moniteur PC est lancé et tourne en arrière-plan.\n\n" +
                            "• Son icône est près de l'horloge (petite flèche ^ si tu ne la vois pas) : clic droit pour le menu.\n" +
                            $"• Sur le téléphone : ouvre l'app Moniteur PC, ou l'adresse http://{LanIp()}:{settings.Port}\n" +
                            "• Il se relancera tout seul à chaque démarrage de Windows.",
                "Moniteur PC", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
        var smoother = new Smoother();
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
            smoother.Apply(s, now); // avant les alertes : elles réagissent aux valeurs stables
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
