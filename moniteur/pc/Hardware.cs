using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using LibreHardwareMonitor.Hardware;
using Microsoft.Win32;

namespace MoniteurPC;

/// <summary>Lit tous les capteurs avec la bibliothèque de LibreHardwareMonitor.</summary>
public sealed class HardwareReader : IDisposable
{
    private readonly Computer _computer;
    private long _lastRx, _lastTx;
    private DateTime _lastNet = DateTime.MinValue;

    public HardwareReader()
    {
        _computer = new Computer
        {
            IsCpuEnabled = true, IsGpuEnabled = true, IsMemoryEnabled = true,
            IsMotherboardEnabled = true, IsStorageEnabled = true, IsControllerEnabled = true,
        };
        _computer.Open();
    }

    public void Dispose() => _computer.Close();

    public static bool DriverInstalled()
    {
        const string key = @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\PawnIO";
        foreach (var view in new[] { RegistryView.Registry64, RegistryView.Registry32 })
        {
            using var root = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, view);
            if (root.OpenSubKey(key)?.GetValue("DisplayVersion") is string) return true;
        }
        return false;
    }

    private static (string Group, string Unit)? Group(SensorType t) => t switch
    {
        SensorType.Temperature => ("temp", "°C"),
        SensorType.Load => ("charge", "%"),
        SensorType.Fan => ("ventilo", "RPM"),
        SensorType.Clock => ("freq", "MHz"),
        SensorType.Power => ("puissance", "W"),
        SensorType.Voltage => ("tension", "V"),
        SensorType.Control => ("controle", "%"),
        SensorType.Data => ("donnees", "GB"),
        SensorType.SmallData => ("donnees", "MB"),
        _ => null,
    };

    private static string Kind(HardwareType t) => t switch
    {
        HardwareType.Cpu => "cpu",
        HardwareType.GpuAmd or HardwareType.GpuNvidia or HardwareType.GpuIntel => "gpu",
        HardwareType.Memory => "ram",
        HardwareType.Storage => "disque",
        HardwareType.Motherboard => "carte_mere",
        HardwareType.SuperIO or HardwareType.EmbeddedController => "puce",
        HardwareType.Network => "reseau",
        _ => "autre",
    };

    private static Component ToComponent(IHardware hw)
    {
        var c = new Component { Name = hw.Name, Kind = Kind(hw.HardwareType), Integrated = hw.HardwareType == HardwareType.GpuIntel };
        foreach (var s in hw.Sensors)
        {
            if (s.Value is not float v || float.IsNaN(v) || Group(s.SensorType) is not { } g) continue;
            c.Sensors.Add(new Sensor
            {
                Group = g.Group, Name = s.Name, Value = Math.Round(v, 2), Unit = g.Unit,
                Max = s.Max is float m && !float.IsNaN(m) ? Math.Round(m, 2) : null,
            });
        }
        return c;
    }

    public List<Component> ReadComponents()
    {
        var list = new List<Component>();
        foreach (var hw in _computer.Hardware)
        {
            hw.Update();
            list.Add(ToComponent(hw));
            foreach (var sub in hw.SubHardware)
            {
                sub.Update();
                list.Add(ToComponent(sub));
            }
        }
        return list.Where(c => c.Sensors.Count > 0).ToList();
    }

    public static double? Pick(Component? c, string group, string[]? names = null, string[]? contains = null, bool max = false)
    {
        if (c is null) return null;
        var sensors = c.Sensors.Where(s => s.Group == group).ToList();
        foreach (var n in names ?? Array.Empty<string>())
            foreach (var s in sensors)
                if (string.Equals(s.Name, n, StringComparison.OrdinalIgnoreCase)) return s.Value;
        foreach (var n in contains ?? Array.Empty<string>())
            foreach (var s in sensors)
                if (s.Name.Contains(n, StringComparison.OrdinalIgnoreCase)) return s.Value;
        return max && sensors.Count > 0 ? sensors.Max(s => s.Value) : null;
    }

    /// <summary>Remplit les mesures principales (ronds de la page) à partir des composants.</summary>
    public void Fill(Snapshot s)
    {
        var comps = ReadComponents();
        s.Components = comps;
        s.SensorsOk = comps.Count > 0;

        var cpu = comps.FirstOrDefault(c => c.Kind == "cpu");
        // La carte graphique dédiée (le RX 580) passe avant la puce graphique intégrée.
        var gpu = comps.FirstOrDefault(c => c.Kind == "gpu" && !c.Integrated) ?? comps.FirstOrDefault(c => c.Kind == "gpu");
        var ram = comps.FirstOrDefault(c => c.Kind == "ram");

        if (cpu is not null)
        {
            s.CpuName = cpu.Name;
            s.Cpu = Pick(cpu, "charge", new[] { "CPU Total" });
            s.CpuTemp = Pick(cpu, "temp", new[] { "Core (Tctl/Tdie)", "CPU Package", "Core (Tctl)", "Package", "Core Max", "Core Average" }, max: true);
            s.CpuPower = Pick(cpu, "puissance", new[] { "CPU Package", "Package" }, new[] { "package" });
            s.CpuClock = Pick(cpu, "freq", null, new[] { "core #1" }, max: true);
        }
        if (gpu is not null)
        {
            s.GpuName = gpu.Name;
            s.Gpu = Pick(gpu, "charge", new[] { "GPU Core", "D3D 3D" }, new[] { "core", "3d" });
            s.GpuTemp = Pick(gpu, "temp", new[] { "GPU Core", "GPU Hot Spot" }, max: true);
            s.GpuFanRpm = Pick(gpu, "ventilo", new[] { "GPU Fan" }, new[] { "fan" });
            s.GpuFanPercent = Pick(gpu, "controle", new[] { "GPU Fan" }, new[] { "fan" });
            s.GpuClock = Pick(gpu, "freq", new[] { "GPU Core" }, new[] { "core" });
            s.GpuPower = Pick(gpu, "puissance", new[] { "GPU Package", "GPU Core", "GPU Power" }, new[] { "package", "power", "core" });
            double? used = Pick(gpu, "donnees", new[] { "GPU Memory Used", "D3D Dedicated Memory Used" }, new[] { "memory used" });
            double? total = Pick(gpu, "donnees", new[] { "GPU Memory Total" }, new[] { "memory total" });
            if (used is not null && total is > 0)
            {
                s.Vram = Math.Round(100 * used.Value / total.Value, 1);
                s.VramGb = new double?[] { Math.Round(used.Value / 1024, 1), Math.Round(total.Value / 1024, 1) };
            }
            else if (used is not null)
            {
                s.VramGb = new double?[] { Math.Round(used.Value / 1024, 1), null };
            }
        }
        if (ram is not null)
        {
            s.Ram = Pick(ram, "charge", new[] { "Memory" });
            double? used = Pick(ram, "donnees", new[] { "Memory Used" });
            double? avail = Pick(ram, "donnees", new[] { "Memory Available" });
            s.RamUsedGb = used is null ? null : Math.Round(used.Value, 1);
            s.RamTotalGb = used is not null && avail is not null ? Math.Round(used.Value + avail.Value, 1) : null;
        }
        foreach (var d in comps.Where(c => c.Kind == "disque"))
        {
            double? t = Pick(d, "temp", null, new[] { "temperature" }, max: true);
            if (t is not null) s.DiskTemps.Add(new DiskTemp { Name = d.Name, Temp = t.Value });
        }

        foreach (var drive in DriveInfo.GetDrives())
        {
            try
            {
                if (drive.DriveType != DriveType.Fixed || !drive.IsReady || drive.TotalSize == 0) continue;
                s.Disks.Add(new Disk
                {
                    Name = drive.Name.TrimEnd('\\'),
                    Percent = Math.Round(100.0 * (drive.TotalSize - drive.TotalFreeSpace) / drive.TotalSize, 1),
                    FreeGb = drive.TotalFreeSpace / 1073741824.0,
                    TotalGb = drive.TotalSize / 1073741824.0,
                });
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        long rx = 0, tx = 0;
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            try
            {
                var st = nic.GetIPv4Statistics();
                rx += st.BytesReceived;
                tx += st.BytesSent;
            }
            catch (NetworkInformationException) { }
        }
        var now = DateTime.UtcNow;
        if (_lastNet != DateTime.MinValue)
        {
            double dt = Math.Max((now - _lastNet).TotalSeconds, 0.001);
            s.NetDown = Math.Max(0, (rx - _lastRx) / dt);
            s.NetUp = Math.Max(0, (tx - _lastTx) / dt);
        }
        (_lastRx, _lastTx, _lastNet) = (rx, tx, now);
    }
}
