using System.Collections.Generic;
using MoniteurPC;
using Xunit;

public class FpsTests
{
    private const string HeaderV2 =
        "Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags," +
        "AllowsTearing,PresentMode,FrameType,CPUStartTime,FrameTime,CPUBusy,CPUWait";

    [Fact]
    public void Fps_from_frametimes_v2_ignores_banner_and_dwm()
    {
        var t = new FpsTracker();
        t.Feed("PresentMon 2.6.0 - capturing", 0); // texte avant l'en-tête : ignoré
        t.Feed(HeaderV2, 0);
        for (int i = 0; i < 120; i++)
        {
            double ft = i == 60 ? 50.0 : 16.667;
            t.Feed($"game.exe,4242,0x1,DXGI,1,0,0,Hardware,Application,{i},{ft.ToString(System.Globalization.CultureInfo.InvariantCulture)},1,1", 10 + i / 60.0);
            t.Feed($"dwm.exe,99,0x2,Other,1,0,0,Composed,Application,{i},16.6,1,1", 10 + i / 60.0);
        }
        var snap = t.Snapshot(12, null)!;
        Assert.Equal("game", snap.App);
        Assert.InRange(snap.Fps, 57, 60);
        Assert.True(snap.Low1 < snap.Fps);
    }

    [Fact]
    public void Fps_v1_column()
    {
        var t = new FpsTracker();
        t.Feed("Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,Dropped,TimeInSeconds,MsBetweenPresents", 0);
        for (int i = 0; i < 60; i++) t.Feed($"jeu.exe,1,0x1,DXGI,0,0,0,{i},33.333", 5 + i / 30.0);
        Assert.Equal(30, t.Snapshot(7, null)!.Fps);
    }

    [Fact]
    public void Foreground_app_wins()
    {
        var t = new FpsTracker();
        t.Feed(HeaderV2, 0);
        for (int i = 0; i < 100; i++)
        {
            t.Feed($"fond.exe,1,0x1,DXGI,1,0,0,Hardware,Application,0,8.0,1,1", 1 + i / 100.0);
            if (i % 2 == 0) t.Feed($"jeu.exe,2,0x1,DXGI,1,0,0,Hardware,Application,0,16.0,1,1", 1 + i / 100.0);
        }
        Assert.Equal("jeu", t.Snapshot(2, 2)!.App);
    }

    [Fact]
    public void No_game()
    {
        var t = new FpsTracker();
        t.Feed(HeaderV2, 0);
        Assert.Null(t.Snapshot(1, null));
    }
}

public class AlertTests
{
    private readonly List<Alert> _sent = new();
    private readonly AlertEngine _alerts;
    private readonly Thresholds _t = new();

    public AlertTests() => _alerts = new AlertEngine(_sent.Add);

    private static Snapshot State() => new()
    {
        Cpu = 20, Ram = 50, CpuTemp = 60, GpuTemp = 65, Gpu = 30, GpuFanRpm = 1200, DriverOk = true,
    };

    [Fact]
    public void Hot_gpu_needs_duration_then_clears()
    {
        var hot = State();
        hot.GpuTemp = 80;
        _alerts.Evaluate(hot, _t, 0);
        Assert.False(_alerts.Active.ContainsKey("gpu_temp")); // pas d'alerte sur un pic d'une seconde
        _alerts.Evaluate(hot, _t, 11);
        Assert.Equal("attention", _alerts.Active["gpu_temp"].Level);
        Assert.Single(_sent);
        _alerts.Evaluate(State(), _t, 12);
        Assert.False(_alerts.Active.ContainsKey("gpu_temp"));
        Assert.NotNull(_alerts.History()[0].End);
    }

    [Fact]
    public void Critical_is_fast()
    {
        var s = State();
        s.CpuTemp = 93;
        _alerts.Evaluate(s, _t, 0);
        _alerts.Evaluate(s, _t, 3);
        Assert.Equal("critique", _alerts.Active["cpu_temp"].Level);
    }

    [Fact]
    public void Gpu_fan_stopped_when_hot()
    {
        var s = State();
        s.GpuFanRpm = 0;
        s.GpuTemp = 70;
        _alerts.Evaluate(s, _t, 0);
        _alerts.Evaluate(s, _t, 16);
        Assert.True(_alerts.Active.ContainsKey("gpu_fan"));
    }

    [Fact]
    public void Zero_rpm_mode_at_idle_is_fine()
    {
        var s = State();
        s.GpuFanRpm = 0;
        s.GpuTemp = 45; // le RX 580 coupe ses ventilateurs au repos
        _alerts.Evaluate(s, _t, 0);
        _alerts.Evaluate(s, _t, 60);
        Assert.False(_alerts.Active.ContainsKey("gpu_fan"));
    }

    [Fact]
    public void Low_fps_only_in_game()
    {
        var browser = State();
        browser.Gpu = 10;
        browser.Fps = new FpsInfo { App = "chrome", Fps = 20 };
        _alerts.Evaluate(browser, _t, 0);
        _alerts.Evaluate(browser, _t, 20);
        Assert.False(_alerts.Active.ContainsKey("fps"));
        var game = State();
        game.Gpu = 95;
        game.Fps = new FpsInfo { App = "jeu", Fps = 22 };
        _alerts.Evaluate(game, _t, 21);
        _alerts.Evaluate(game, _t, 32);
        Assert.True(_alerts.Active.ContainsKey("fps"));
    }

    [Fact]
    public void Unplugged_disk_alert_ends()
    {
        var s = State();
        s.Disks.Add(new Disk { Name = "E:", Percent = 99, FreeGb = 1 });
        _alerts.Evaluate(s, _t, 0);
        Assert.True(_alerts.Active.ContainsKey("disk_E:"));
        _alerts.Evaluate(State(), _t, 1);
        Assert.False(_alerts.Active.ContainsKey("disk_E:"));
    }

    [Fact]
    public void Missing_driver_is_info()
    {
        var s = State();
        s.CpuTemp = null;
        s.DriverOk = false;
        _alerts.Evaluate(s, _t, 0);
        _alerts.Evaluate(s, _t, 21);
        Assert.Equal("info", _alerts.Active["pilote"].Level);
        Assert.Empty(_sent); // une info ne déclenche pas de notification…
    }
}
