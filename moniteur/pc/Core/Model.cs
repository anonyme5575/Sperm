using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace MoniteurPC;

// Format JSON lu par la page du téléphone (web/index.html) et par l'app Android.

public sealed class Sensor
{
    [JsonPropertyName("groupe")] public string Group { get; set; } = "";
    [JsonPropertyName("nom")] public string Name { get; set; } = "";
    [JsonPropertyName("valeur")] public double Value { get; set; }
    [JsonPropertyName("unite")] public string Unit { get; set; } = "";
    [JsonPropertyName("max")] public double? Max { get; set; }
}

public sealed class Component
{
    [JsonPropertyName("nom")] public string Name { get; set; } = "";
    [JsonPropertyName("type")] public string Kind { get; set; } = "autre";
    [JsonPropertyName("capteurs")] public List<Sensor> Sensors { get; set; } = new();
    [JsonIgnore] public bool Integrated { get; set; }
}

public sealed class Disk
{
    [JsonPropertyName("nom")] public string Name { get; set; } = "";
    [JsonPropertyName("pct")] public double Percent { get; set; }
    [JsonPropertyName("libre_go")] public double FreeGb { get; set; }
    [JsonPropertyName("total_go")] public double TotalGb { get; set; }
}

public sealed class DiskTemp
{
    [JsonPropertyName("nom")] public string Name { get; set; } = "";
    [JsonPropertyName("temp")] public double Temp { get; set; }
}

public sealed class FpsInfo
{
    [JsonPropertyName("app")] public string App { get; set; } = "";
    [JsonPropertyName("fps")] public int Fps { get; set; }
    [JsonPropertyName("low1")] public int Low1 { get; set; }
    [JsonPropertyName("frametime")] public double FrameTime { get; set; }
}

public sealed class SystemInfo
{
    [JsonPropertyName("os")] public string Os { get; set; } = "";
    [JsonPropertyName("cpu")] public string Cpu { get; set; } = "";
    [JsonPropertyName("ram_go")] public double RamGb { get; set; }
    [JsonPropertyName("coeurs")] public int? Cores { get; set; }
    [JsonPropertyName("threads")] public int Threads { get; set; }
    [JsonPropertyName("machine")] public string Machine { get; set; } = "";
}

public sealed class Alert
{
    [JsonPropertyName("id")] public string Id { get; set; } = "";
    [JsonPropertyName("niveau")] public string Level { get; set; } = "info";
    [JsonPropertyName("titre")] public string Title { get; set; } = "";
    [JsonPropertyName("detail")] public string Detail { get; set; } = "";
    [JsonPropertyName("debut")] public double Start { get; set; }
    [JsonPropertyName("fin")] public double? End { get; set; }

    public Alert Copy() => (Alert)MemberwiseClone();
}

public sealed class Snapshot
{
    [JsonPropertyName("t")] public double Time { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("systeme")] public SystemInfo System { get; set; } = new();
    [JsonPropertyName("uptime")] public double Uptime { get; set; }
    [JsonPropertyName("cpu")] public double? Cpu { get; set; }
    [JsonPropertyName("ram")] public double? Ram { get; set; }
    [JsonPropertyName("ram_util_go")] public double? RamUsedGb { get; set; }
    [JsonPropertyName("ram_total_go")] public double? RamTotalGb { get; set; }
    [JsonPropertyName("net_down")] public double NetDown { get; set; }
    [JsonPropertyName("net_up")] public double NetUp { get; set; }
    [JsonPropertyName("fps")] public FpsInfo? Fps { get; set; }
    [JsonPropertyName("fps_statut")] public string FpsStatus { get; set; } = "";
    [JsonPropertyName("seuils")] public Thresholds Thresholds { get; set; } = new();
    [JsonPropertyName("disques")] public List<Disk> Disks { get; set; } = new();
    [JsonPropertyName("lhm_ok")] public bool SensorsOk { get; set; }
    [JsonPropertyName("pilote_ok")] public bool DriverOk { get; set; }
    [JsonPropertyName("composants")] public List<Component> Components { get; set; } = new();
    [JsonPropertyName("disques_temp")] public List<DiskTemp> DiskTemps { get; set; } = new();
    [JsonPropertyName("cpu_nom")] public string? CpuName { get; set; }
    [JsonPropertyName("cpu_temp")] public double? CpuTemp { get; set; }
    [JsonPropertyName("cpu_puissance")] public double? CpuPower { get; set; }
    [JsonPropertyName("cpu_freq")] public double? CpuClock { get; set; }
    [JsonPropertyName("gpu_nom")] public string? GpuName { get; set; }
    [JsonPropertyName("gpu")] public double? Gpu { get; set; }
    [JsonPropertyName("gpu_temp")] public double? GpuTemp { get; set; }
    [JsonPropertyName("gpu_fan_rpm")] public double? GpuFanRpm { get; set; }
    [JsonPropertyName("gpu_fan_pct")] public double? GpuFanPercent { get; set; }
    [JsonPropertyName("gpu_freq")] public double? GpuClock { get; set; }
    [JsonPropertyName("gpu_puissance")] public double? GpuPower { get; set; }
    [JsonPropertyName("vram")] public double? Vram { get; set; }
    [JsonPropertyName("vram_go")] public double?[]? VramGb { get; set; }
    [JsonPropertyName("alertes")] public List<Alert> Alerts { get; set; } = new();
    [JsonPropertyName("historique")] public List<Alert> History { get; set; } = new();
}

/// <summary>Seuils d'alerte : [attention, critique].</summary>
public sealed class Thresholds
{
    [JsonPropertyName("cpu_temp")] public double[] CpuTemp { get; set; } = { 80, 90 };
    // Le RX 580 encaisse jusqu'à ~85 °C.
    [JsonPropertyName("gpu_temp")] public double[] GpuTemp { get; set; } = { 78, 85 };
    [JsonPropertyName("disque_temp")] public double[] DiskTemp { get; set; } = { 55, 65 };
    [JsonPropertyName("ram")] public double[] Ram { get; set; } = { 90, 97 };
    [JsonPropertyName("disque_plein")] public double[] DiskFull { get; set; } = { 90, 97 };
    [JsonPropertyName("cpu_charge")] public double[] CpuLoad { get; set; } = { 95, 101 };
    [JsonPropertyName("fps_bas")] public double LowFps { get; set; } = 30;
}
