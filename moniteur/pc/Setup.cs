using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows.Forms;

namespace MoniteurPC;

/// <summary>Ce qui se règle une seule fois : pilote des capteurs, pare-feu, démarrage avec Windows.</summary>
public static class Setup
{
    private const string TaskName = "MoniteurPC";

    private static (int Code, string Output) Run(string file, string args)
    {
        var psi = new ProcessStartInfo(file, args)
        {
            UseShellExecute = false, CreateNoWindow = true,
            RedirectStandardOutput = true, RedirectStandardError = true,
        };
        using var p = Process.Start(psi)!;
        string output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
        p.WaitForExit();
        return (p.ExitCode, output);
    }

    /// <summary>
    /// PawnIO est le pilote open source qui permet de lire la température du processeur et les
    /// ventilateurs de la carte mère. Même installateur et même option que LibreHardwareMonitor.
    /// </summary>
    public static void EnsureDriver(Settings settings, bool interactive)
    {
        if (HardwareReader.DriverInstalled() || settings.DriverDeclined || !interactive) return;
        var res = typeof(Setup).Assembly.GetManifestResourceNames()
            .FirstOrDefault(n => n.EndsWith("PawnIO_setup.exe", StringComparison.OrdinalIgnoreCase));
        if (res is null) return;
        var answer = MessageBox.Show(
            "Pour lire la température du processeur et les ventilateurs, Moniteur PC a besoin du pilote " +
            "PawnIO (open source, le même que LibreHardwareMonitor).\n\nL'installer maintenant ?",
            "Moniteur PC", MessageBoxButtons.YesNo, MessageBoxIcon.Question);
        if (answer != DialogResult.Yes)
        {
            settings.DriverDeclined = true;
            settings.Save();
            return;
        }
        string path = Path.Combine(Settings.DataDir, "PawnIO_setup.exe");
        using (var src = typeof(Setup).Assembly.GetManifestResourceStream(res)!)
        using (var dst = File.Create(path))
            src.CopyTo(dst);
        try { Process.Start(new ProcessStartInfo(path, "-install") { UseShellExecute = true })?.WaitForExit(); }
        finally { try { File.Delete(path); } catch { } }
    }

    /// <summary>Autorise le téléphone à joindre le PC, seulement depuis le réseau local.</summary>
    public static void EnsureFirewall(Settings settings)
    {
        string exe = Environment.ProcessPath ?? "";
        if (settings.FirewallDone && Run("netsh", "advfirewall firewall show rule name=\"Moniteur PC\"").Code == 0) return;
        Run("netsh", "advfirewall firewall delete rule name=\"Moniteur PC\"");
        var r = Run("netsh", $"advfirewall firewall add rule name=\"Moniteur PC\" dir=in action=allow " +
                             $"program=\"{exe}\" enable=yes profile=any remoteip=localsubnet");
        settings.FirewallDone = r.Code == 0;
        settings.Save();
    }

    public static bool AutoStartInstalled() => Run("schtasks", $"/Query /TN {TaskName}").Code == 0;

    /// <summary>
    /// Tâche planifiée « à l'ouverture de session, avec les droits les plus élevés » : le dossier
    /// Démarrage de Windows ignore les programmes qui demandent les droits administrateur.
    /// </summary>
    public static void SetAutoStart(bool on)
    {
        if (!on)
        {
            Run("schtasks", $"/Delete /TN {TaskName} /F");
            return;
        }
        string exe = (Environment.ProcessPath ?? "").Replace("'", "''");
        string ps =
            $"$a = New-ScheduledTaskAction -Execute '{exe}'; " +
            "$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; " +
            "$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest -LogonType Interactive; " +
            "$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; " +
            $"Register-ScheduledTask -TaskName {TaskName} -Action $a -Trigger $t -Principal $p -Settings $s -Force | Out-Null";
        Run("powershell", $"-NoProfile -NonInteractive -Command \"{ps.Replace("\"", "\\\"")}\"");
    }
}
