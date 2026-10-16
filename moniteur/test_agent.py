"""Tests du moniteur : python3 -m unittest moniteur/test_agent.py"""

import json
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import agent  # noqa: E402


def sensor(text, value, maxv=""):
    return {"Text": text, "Value": value, "Min": "", "Max": maxv,
            "ImageURL": "images/transparent.png", "Children": []}


def group(text, *children):
    return {"Text": text, "Value": "", "ImageURL": "images_icon/x.png", "Children": list(children)}


# Arbre au format de LibreHardwareMonitor (data.json), Windows en français.
SAMPLE = {"Text": "Sensor", "Value": "Value", "ImageURL": "", "Children": [{
    "Text": "DESKTOP-JEU", "Value": "", "ImageURL": "images_icon/computer.png", "Children": [
        {"Text": "MSI B450 TOMAHAWK", "Value": "", "ImageURL": "images_icon/mainboard.png", "Children": [
            {"Text": "Nuvoton NCT6797D", "Value": "", "ImageURL": "images_icon/chip.png", "Children": [
                group("Fans", sensor("Fan #1", "1 024 RPM"), sensor("Fan #2", "0 RPM")),
            ]},
        ]},
        {"Text": "AMD Ryzen 5 2600", "Value": "", "ImageURL": "images_icon/cpu.png", "Children": [
            group("Clocks", sensor("Core #1", "3 899,7 MHz"), sensor("Core #2", "3 700,1 MHz")),
            group("Temperatures", sensor("Core (Tctl/Tdie)", "67,4 °C", "81,0 °C"),
                  sensor("CCD1 (Tdie)", "64,0 °C")),
            group("Load", sensor("CPU Total", "42,5 %"), sensor("CPU Core #1", "60,0 %")),
            group("Powers", sensor("Package", "58,3 W")),
        ]},
        {"Text": "Generic Memory", "Value": "", "ImageURL": "images_icon/ram.png", "Children": [
            group("Load", sensor("Memory", "61,2 %")),
            group("Data", sensor("Memory Used", "9,8 GB")),
        ]},
        {"Text": "Radeon RX 580 Series", "Value": "", "ImageURL": "images_icon/ati.png", "Children": [
            group("Temperatures", sensor("GPU Core", "71,0 °C", "79,0 °C")),
            group("Load", sensor("GPU Core", "97,0 %"), sensor("GPU Memory Controller", "55,0 %")),
            group("Fans", sensor("GPU Fan", "1 650 RPM")),
            group("Controls", sensor("GPU Fan", "48,0 %")),
            group("Clocks", sensor("GPU Core", "1 340,0 MHz"), sensor("GPU Memory", "2 000,0 MHz")),
            group("Powers", sensor("GPU Package", "121,5 W")),
            group("SmallData", sensor("GPU Memory Used", "5 120,0 MB"),
                  sensor("GPU Memory Total", "8 192,0 MB")),
        ]},
        {"Text": "Samsung SSD 860 EVO 500GB", "Value": "", "ImageURL": "images_icon/hdd.png", "Children": [
            group("Temperatures", sensor("Temperature", "38,0 °C")),
            group("Load", sensor("Used Space", "71,5 %")),
        ]},
    ]}]}


class ParseTests(unittest.TestCase):
    def test_parse_value_french(self):
        self.assertEqual(agent.parse_value("67,4 °C"), (67.4, "°C"))
        self.assertEqual(agent.parse_value("1 024 RPM"), (1024.0, "RPM"))
        self.assertEqual(agent.parse_value("3 899,7 MHz"), (3899.7, "MHz"))
        self.assertEqual(agent.parse_value("1,234.5 MHz"), (1234.5, "MHz"))
        self.assertEqual(agent.parse_value("Value")[0], None)

    def test_parse_lhm_components(self):
        hw = agent.parse_lhm(SAMPLE)
        kinds = {h["nom"]: h["type"] for h in hw}
        self.assertEqual(kinds["AMD Ryzen 5 2600"], "cpu")
        self.assertEqual(kinds["Radeon RX 580 Series"], "gpu")
        self.assertEqual(kinds["Generic Memory"], "ram")
        self.assertEqual(kinds["Samsung SSD 860 EVO 500GB"], "disque")
        self.assertEqual(kinds["Nuvoton NCT6797D"], "puce")
        gpu = agent.first(hw, "gpu")
        self.assertEqual(agent.pick(gpu, "temp", ("GPU Core",)), 71.0)
        self.assertEqual(agent.pick(gpu, "charge", ("GPU Core",)), 97.0)
        self.assertEqual(agent.pick(gpu, "ventilo", ("GPU Fan",)), 1650.0)
        cpu = agent.first(hw, "cpu")
        self.assertEqual(agent.pick(cpu, "temp", ("Core (Tctl/Tdie)",)), 67.4)
        self.assertEqual(agent.pick(cpu, "puissance", ("CPU Package", "Package")), 58.3)


class FpsTests(unittest.TestCase):
    HEADER_V2 = ("Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,"
                 "AllowsTearing,PresentMode,FrameType,CPUStartTime,FrameTime,CPUBusy,CPUWait\n")

    def test_fps_from_frametimes_v2(self):
        t = agent.FpsTracker()
        t.feed("PresentMon 2.3.0 - capturing\n", now=0)  # texte avant l'en-tête : ignoré
        t.feed(self.HEADER_V2, now=0)
        for i in range(120):  # 60 FPS stables, une saccade à 50 ms
            ft = 50.0 if i == 60 else 16.667
            t.feed("game.exe,4242,0x1,DXGI,1,0,0,Hardware,Application,%d,%.3f,1,1\n" % (i, ft), now=10 + i / 60)
            t.feed("dwm.exe,99,0x2,Other,1,0,0,Composed,Application,%d,16.6,1,1\n" % i, now=10 + i / 60)
        snap = t.snapshot(now=12)
        self.assertEqual(snap["app"], "game")
        self.assertTrue(57 <= snap["fps"] <= 60, snap)
        self.assertLess(snap["low1"], snap["fps"])

    def test_fps_v1_column(self):
        t = agent.FpsTracker()
        t.feed("Application,ProcessID,SwapChainAddress,Runtime,SyncInterval,PresentFlags,"
               "Dropped,TimeInSeconds,MsBetweenPresents\n", now=0)
        for i in range(60):
            t.feed("jeu.exe,1,0x1,DXGI,0,0,0,%f,33.333\n" % (i / 30), now=5 + i / 30)
        self.assertEqual(t.snapshot(now=7)["fps"], 30)

    def test_no_game(self):
        t = agent.FpsTracker()
        t.feed(self.HEADER_V2, now=0)
        self.assertIsNone(t.snapshot(now=1))


class AlertTests(unittest.TestCase):
    def setUp(self):
        self.sent = []
        self.alerts = agent.Alerts(self.sent.append)
        self.cfg = json.loads(json.dumps(agent.DEFAULT_CONFIG))

    def state(self, **kw):
        s = {"cpu": 20, "ram": 50, "cpu_temp": 60, "gpu_temp": 65, "gpu": 30,
             "gpu_fan_rpm": 1200, "disques": [], "disques_temp": [], "fps": None, "lhm_ok": True}
        s.update(kw)
        return s

    def test_hot_gpu_needs_duration(self):
        hot = self.state(gpu_temp=80)
        self.alerts.evaluate(hot, self.cfg, now=0)
        self.assertNotIn("gpu_temp", self.alerts.active)  # pas d'alerte sur un pic d'une seconde
        self.alerts.evaluate(hot, self.cfg, now=11)
        self.assertEqual(self.alerts.active["gpu_temp"]["niveau"], "attention")
        self.assertEqual(len(self.sent), 1)
        self.alerts.evaluate(self.state(), self.cfg, now=12)
        self.assertNotIn("gpu_temp", self.alerts.active)
        self.assertIn("fin", self.alerts.history[0])

    def test_critical_is_fast(self):
        self.alerts.evaluate(self.state(cpu_temp=93), self.cfg, now=0)
        self.alerts.evaluate(self.state(cpu_temp=93), self.cfg, now=3)
        self.assertEqual(self.alerts.active["cpu_temp"]["niveau"], "critique")

    def test_gpu_fan_stopped_when_hot(self):
        s = self.state(gpu_fan_rpm=0, gpu_temp=70)
        self.alerts.evaluate(s, self.cfg, now=0)
        self.alerts.evaluate(s, self.cfg, now=16)
        self.assertIn("gpu_fan", self.alerts.active)

    def test_zero_rpm_mode_at_idle_is_fine(self):
        s = self.state(gpu_fan_rpm=0, gpu_temp=45)  # le RX 580 coupe ses ventilateurs au repos
        self.alerts.evaluate(s, self.cfg, now=0)
        self.alerts.evaluate(s, self.cfg, now=60)
        self.assertNotIn("gpu_fan", self.alerts.active)

    def test_low_fps_only_in_game(self):
        browser = self.state(gpu=10, fps={"app": "chrome", "fps": 20, "low1": 10, "frametime": 50})
        self.alerts.evaluate(browser, self.cfg, now=0)
        self.alerts.evaluate(browser, self.cfg, now=20)
        self.assertNotIn("fps", self.alerts.active)
        game = self.state(gpu=95, fps={"app": "jeu", "fps": 22, "low1": 12, "frametime": 45})
        self.alerts.evaluate(game, self.cfg, now=21)
        self.alerts.evaluate(game, self.cfg, now=32)
        self.assertIn("fps", self.alerts.active)


if __name__ == "__main__":
    unittest.main()
