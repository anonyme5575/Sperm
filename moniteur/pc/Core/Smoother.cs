using System;
using System.Collections.Generic;

namespace MoniteurPC;

/// <summary>
/// Stabilise les mesures prises chaque seconde : moyenne glissante exponentielle (les charges
/// CPU/GPU sautent de 0 à 100 % d'une seconde à l'autre), et maintien de la dernière valeur
/// quelques secondes quand un capteur rate une lecture, au lieu d'afficher « – ».
/// </summary>
public sealed class Smoother
{
    private const double HoldSeconds = 5;
    private readonly Dictionary<string, (double Value, double Time)> _last = new();

    /// <param name="tau">Constante de temps en secondes : plus elle est grande, plus c'est lisse.</param>
    public double? Next(string key, double? value, double now, double tau)
    {
        if (value is null)
        {
            if (_last.TryGetValue(key, out var held) && now - held.Time <= HoldSeconds) return held.Value;
            _last.Remove(key);
            return null;
        }
        double v = value.Value;
        if (_last.TryGetValue(key, out var prev) && now - prev.Time <= HoldSeconds && tau > 0)
        {
            double alpha = 1 - Math.Exp(-(now - prev.Time) / tau);
            v = prev.Value + alpha * (v - prev.Value);
        }
        _last[key] = (v, now);
        return Math.Round(v, 1);
    }

    /// <summary>Applique le lissage aux mesures principales (celles des ronds et des alertes).</summary>
    public void Apply(Snapshot s, double now)
    {
        s.Cpu = Next("cpu", s.Cpu, now, 3);
        s.Gpu = Next("gpu", s.Gpu, now, 3);
        s.Ram = Next("ram", s.Ram, now, 0);
        s.Vram = Next("vram", s.Vram, now, 0);
        s.CpuTemp = Next("cpu_temp", s.CpuTemp, now, 2);
        s.GpuTemp = Next("gpu_temp", s.GpuTemp, now, 2);
        s.CpuPower = Next("cpu_w", s.CpuPower, now, 2);
        s.GpuPower = Next("gpu_w", s.GpuPower, now, 2);
        s.CpuClock = Next("cpu_mhz", s.CpuClock, now, 2);
        s.GpuClock = Next("gpu_mhz", s.GpuClock, now, 2);
        s.GpuFanRpm = Next("gpu_fan", s.GpuFanRpm, now, 2);
        s.GpuFanPercent = Next("gpu_fan_pct", s.GpuFanPercent, now, 2);
        s.NetDown = Next("down", s.NetDown, now, 2) ?? 0;
        s.NetUp = Next("up", s.NetUp, now, 2) ?? 0;
    }
}
