using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.RegularExpressions;

namespace MoniteurPC;

/// <summary>
/// Lit la sortie CSV de PresentMon et calcule les FPS de l'application qui affiche des images
/// (de préférence celle au premier plan). Marche avec les colonnes de PresentMon 1.x et 2.x.
/// </summary>
public sealed class FpsTracker
{
    private const double Window = 2.0; // secondes

    private static readonly HashSet<string> Ignored = new(StringComparer.OrdinalIgnoreCase)
    {
        "dwm.exe", "explorer.exe", "searchhost.exe", "startmenuexperiencehost.exe",
        "textinputhost.exe", "shellexperiencehost.exe", "applicationframehost.exe",
        "steamwebhelper.exe", "msedgewebview2.exe", "nvcontainer.exe", "radeonsoftware.exe",
        "amdrsserv.exe", "<unknown>", "lockapp.exe", "moniteurpc.exe",
    };

    private static readonly string[] FrameTimeColumns =
        { "FrameTime", "MsBetweenPresents", "msBetweenPresents", "MsBetweenAppStart" };

    private readonly object _lock = new();
    private readonly Dictionary<(string App, int Pid), Queue<(double T, double Ms)>> _frames = new();
    private Dictionary<string, int>? _cols;

    public string Status { get; set; } = "non démarré";

    public void Reset()
    {
        lock (_lock) { _cols = null; }
    }

    public void Feed(string line, double now)
    {
        if (string.IsNullOrWhiteSpace(line)) return;
        string[] parts = line.TrimEnd('\r', '\n').Split(',');
        lock (_lock)
        {
            // L'en-tête peut arriver après un texte d'accueil, ou revenir après un redémarrage.
            if (parts[0].Trim() == "Application")
            {
                _cols = new Dictionary<string, int>();
                for (int i = 0; i < parts.Length; i++) _cols[parts[i].Trim()] = i;
                return;
            }
            if (_cols is null || parts.Length < 3) return;
            string? ftCol = FrameTimeColumns.FirstOrDefault(_cols.ContainsKey);
            if (ftCol is null || !_cols.TryGetValue("Application", out int appIdx)) return;
            int pidIdx = _cols.TryGetValue("ProcessID", out int p) ? p : 1;
            int ftIdx = _cols[ftCol];
            if (Math.Max(Math.Max(appIdx, pidIdx), ftIdx) >= parts.Length) return;
            if (!int.TryParse(parts[pidIdx], out int pid)) return;
            if (!double.TryParse(parts[ftIdx], System.Globalization.NumberStyles.Float,
                    System.Globalization.CultureInfo.InvariantCulture, out double ms)) return;
            string app = parts[appIdx];
            if (ms <= 0 || ms > 1000 || Ignored.Contains(app)) return;
            if (!_frames.TryGetValue((app, pid), out var q))
                _frames[(app, pid)] = q = new Queue<(double, double)>();
            q.Enqueue((now, ms));
        }
    }

    public FpsInfo? Snapshot(double now, int? foregroundPid)
    {
        (bool Fg, int Count)? bestScore = null;
        string bestApp = "";
        List<double>? best = null;
        lock (_lock)
        {
            foreach (var key in _frames.Keys.ToList())
            {
                var q = _frames[key];
                while (q.Count > 0 && now - q.Peek().T > Window) q.Dequeue();
                if (q.Count == 0) { _frames.Remove(key); continue; }
                var score = (key.Pid == foregroundPid, q.Count);
                if (bestScore is null || score.CompareTo(bestScore.Value) > 0)
                {
                    bestScore = score;
                    bestApp = key.App;
                    best = q.Select(f => f.Ms).ToList();
                }
            }
        }
        if (best is null || best.Count < 5) return null;
        best.Sort();
        double avg = best.Average();
        // Le « 1 % bas » : la moyenne des 1 % d'images les plus lentes.
        int start = Math.Max(0, (int)(best.Count * 0.99) - 1);
        double low = best.Skip(start).Average();
        return new FpsInfo
        {
            App = Regex.Replace(bestApp, @"\.exe$", "", RegexOptions.IgnoreCase),
            Fps = (int)Math.Round(1000 / avg),
            Low1 = (int)Math.Round(1000 / low),
            FrameTime = Math.Round(avg, 1),
        };
    }
}
