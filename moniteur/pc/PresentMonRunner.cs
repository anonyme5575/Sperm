using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;

namespace MoniteurPC;

/// <summary>Lance PresentMon (inclus dans l'exe) et lui transmet chaque image affichée.</summary>
public sealed class PresentMonRunner
{
    private readonly FpsTracker _tracker;
    private Process? _process;
    private volatile bool _stopping;

    public PresentMonRunner(FpsTracker tracker) => _tracker = tracker;

    [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    public static int? ForegroundPid()
    {
        try
        {
            GetWindowThreadProcessId(GetForegroundWindow(), out uint pid);
            return (int)pid;
        }
        catch { return null; }
    }

    private static string? Extract()
    {
        var res = typeof(PresentMonRunner).Assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("PresentMon.exe", StringComparison.OrdinalIgnoreCase));
        if (res is null) return null;
        string path = Path.Combine(Settings.DataDir, "PresentMon.exe");
        using var src = typeof(PresentMonRunner).Assembly.GetManifestResourceStream(res)!;
        if (File.Exists(path) && new FileInfo(path).Length == src.Length) return path;
        using var dst = File.Create(path);
        src.CopyTo(dst);
        return path;
    }

    public void Start() => new Thread(Run) { IsBackground = true, Name = "PresentMon" }.Start();

    public void Stop()
    {
        _stopping = true;
        try { _process?.Kill(true); } catch { }
    }

    private void Run()
    {
        string? exe;
        try { exe = Extract(); }
        catch (Exception e) { _tracker.Status = "PresentMon illisible : " + e.Message; return; }
        if (exe is null) { _tracker.Status = "PresentMon absent de cette version"; return; }

        // Les options ont changé entre PresentMon 1.x et 2.x : on essaie dans l'ordre.
        string[] variants =
        {
            "--output_stdout --stop_existing_session --session_name MoniteurPC --no_console_stats",
            "--output_stdout --stop_existing_session --session_name MoniteurPC",
            "-output_stdout -stop_existing_session -session_name MoniteurPC -no_top",
        };
        int i = 0;
        while (!_stopping)
        {
            var started = DateTime.UtcNow;
            int rows = 0;
            string lastErr = "";
            try
            {
                var psi = new ProcessStartInfo(exe, variants[i])
                {
                    UseShellExecute = false, CreateNoWindow = true,
                    RedirectStandardOutput = true, RedirectStandardError = true,
                };
                _process = Process.Start(psi)!;
                _process.ErrorDataReceived += (_, e) => { if (!string.IsNullOrWhiteSpace(e.Data)) lastErr = e.Data; };
                _process.BeginErrorReadLine();
                _tracker.Reset();
                _tracker.Status = "actif";
                string? line;
                while ((line = _process.StandardOutput.ReadLine()) is not null)
                {
                    rows++;
                    _tracker.Feed(line, Program.Now());
                }
                _process.WaitForExit();
                _tracker.Status = "arrêté : " + (lastErr != "" ? lastErr : "code " + _process.ExitCode);
            }
            catch (Exception e)
            {
                _tracker.Status = "erreur : " + e.Message;
            }
            if (_stopping) return;
            if (rows <= 1 && (DateTime.UtcNow - started).TotalSeconds < 5)
                i = (i + 1) % variants.Length; // options refusées : variante suivante
            Thread.Sleep(i == 0 ? 10000 : 3000);
        }
    }
}
