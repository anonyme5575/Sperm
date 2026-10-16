using System;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace MoniteurPC;

/// <summary>Réglages, dans C:\ProgramData\MoniteurPC\config.json.</summary>
public sealed class Settings
{
    public static readonly string DataDir =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "MoniteurPC");

    private static string PathFile => System.IO.Path.Combine(DataDir, "config.json");

    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    [JsonPropertyName("port")] public int Port { get; set; } = 8790;
    [JsonPropertyName("seuils")] public Thresholds Thresholds { get; set; } = new();
    [JsonPropertyName("demarrage_auto")] public bool AutoStart { get; set; } = true;
    [JsonPropertyName("pilote_refuse")] public bool DriverDeclined { get; set; }
    [JsonPropertyName("pare_feu_ok")] public bool FirewallDone { get; set; }

    public static Settings Load()
    {
        Directory.CreateDirectory(DataDir);
        try
        {
            if (File.Exists(PathFile))
                return JsonSerializer.Deserialize<Settings>(File.ReadAllText(PathFile)) ?? new Settings();
        }
        catch (Exception) { /* réglages illisibles : valeurs par défaut */ }
        var s = new Settings();
        s.Save();
        return s;
    }

    public void Save()
    {
        try { File.WriteAllText(PathFile, JsonSerializer.Serialize(this, Json)); }
        catch (Exception) { }
    }
}
