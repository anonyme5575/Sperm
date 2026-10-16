using System;
using System.Collections.Generic;
using System.Linq;

namespace MoniteurPC;

/// <summary>
/// Une alerte ne se déclenche qu'après une durée minimale, pour éviter les fausses alertes
/// sur un pic d'une seconde.
/// </summary>
public sealed class AlertEngine
{
    private readonly Dictionary<string, Alert> _active = new();
    private readonly Dictionary<string, double> _pending = new();
    private readonly Dictionary<string, double> _lastSent = new();
    private readonly LinkedList<Alert> _history = new();
    private readonly Action<Alert> _notify;

    public AlertEngine(Action<Alert> notify) => _notify = notify;

    public IReadOnlyDictionary<string, Alert> Active => _active;

    public List<Alert> ActiveSorted() =>
        _active.Values.OrderBy(a => Array.IndexOf(new[] { "critique", "attention", "info" }, a.Level))
            .Select(a => a.Copy()).ToList();

    public List<Alert> History() => _history.Select(a => a.Copy()).ToList();

    public void Check(string id, string? level, string title, string detail, double delay, double now)
    {
        if (level is null)
        {
            _pending.Remove(id);
            if (_active.Remove(id, out var ended))
            {
                var h = ended.Copy();
                h.End = now;
                AddHistory(h);
            }
            return;
        }
        if (!_pending.TryGetValue(id, out double start)) _pending[id] = start = now;
        if (now - start < delay) return;
        if (!_active.TryGetValue(id, out var a) || a.Level != level)
        {
            a = new Alert { Id = id, Level = level, Title = title, Detail = detail, Start = now };
            _active[id] = a;
            AddHistory(a.Copy());
            // Une notification par problème toutes les 10 min au plus, sauf si ça devient critique.
            // Les simples informations restent sur la page, sans notification.
            if (level != "info" && (!_lastSent.TryGetValue(id, out double last) || now - last > 600 || level == "critique"))
            {
                _lastSent[id] = now;
                _notify(a.Copy());
            }
        }
        else
        {
            a.Detail = detail;
        }
    }

    private void AddHistory(Alert a)
    {
        _history.AddFirst(a);
        while (_history.Count > 50) _history.RemoveLast();
    }

    private static string? Level(double? value, double[] pair)
    {
        if (value is null) return null;
        if (value >= pair[1]) return "critique";
        if (value >= pair[0]) return "attention";
        return null;
    }

    public void Evaluate(Snapshot s, Thresholds t, double now)
    {
        Temp("cpu_temp", s.CpuTemp, t.CpuTemp, "Processeur trop chaud", now);
        Temp("gpu_temp", s.GpuTemp, t.GpuTemp, "Carte graphique trop chaude", now);

        // Le RX 580 coupe ses ventilateurs au repos : 0 tr/min n'est un problème que si le GPU chauffe.
        bool fanStopped = s.GpuFanRpm is < 100 && (s.GpuTemp ?? 0) >= 65;
        Check("gpu_fan", fanStopped ? "critique" : null, "Ventilateur GPU arrêté ?",
            $"{s.GpuFanRpm ?? 0:0} tr/min alors que le GPU est à {s.GpuTemp ?? 0:0} °C", 15, now);

        string? lv = Level(s.Ram, t.Ram);
        Check("ram", lv, "Mémoire presque pleine", $"{s.Ram ?? 0:0} % de RAM utilisée", 30, now);

        lv = Level(s.Cpu, t.CpuLoad);
        Check("cpu_load", lv is null ? null : "attention", "Processeur bloqué à fond",
            $"{s.Cpu ?? 0:0} % depuis plus d'une minute", 60, now);

        var diskIds = new HashSet<string>();
        foreach (var d in s.Disks)
        {
            diskIds.Add("disk_" + d.Name);
            Check("disk_" + d.Name, Level(d.Percent, t.DiskFull), $"Disque {d.Name} presque plein",
                $"{d.Percent:0} % utilisé, {d.FreeGb:0} Go libres", 0, now);
        }
        foreach (var d in s.DiskTemps)
        {
            diskIds.Add("disktemp_" + d.Name);
            Check("disktemp_" + d.Name, Level(d.Temp, t.DiskTemp), "Disque trop chaud",
                $"{d.Name} : {d.Temp:0} °C", 30, now);
        }
        // Un disque débranché ne doit pas laisser son alerte active pour toujours.
        foreach (var id in _active.Keys.Where(k => k.StartsWith("disk") && !diskIds.Contains(k)).ToList())
            Check(id, null, "", "", 0, now);

        // Seulement en jeu (GPU chargé) : un navigateur qui rafraîchit peu ne compte pas.
        bool inGame = s.Fps is not null && (s.Gpu ?? 0) >= 50;
        Check("fps", inGame && s.Fps!.Fps < t.LowFps ? "attention" : null, "FPS bas",
            s.Fps is null ? "" : $"{s.Fps.App} : {s.Fps.Fps} FPS", 10, now);

        Check("pilote", !s.DriverOk && s.CpuTemp is null ? "info" : null, "Température du processeur indisponible",
            "Le pilote PawnIO n'est pas installé : quitte Moniteur PC, relance-le et accepte son installation.",
            20, now);
    }

    private void Temp(string id, double? v, double[] pair, string title, double now)
    {
        string? lv = Level(v, pair);
        double seuil = lv == "critique" ? pair[1] : pair[0];
        Check(id, lv, title, $"{v ?? 0:0} °C (seuil {seuil:0} °C)", lv == "critique" ? 3 : 10, now);
    }
}
