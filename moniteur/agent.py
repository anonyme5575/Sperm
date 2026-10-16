"""Moniteur PC : FPS, températures, composants et alertes, affichés sur le téléphone.

Tourne sur le PC Windows. Sources :
  - LibreHardwareMonitor (serveur web activé) : températures, charges, ventilateurs,
    fréquences, puissances, noms des composants ;
  - PresentMon (outil open source d'Intel) : FPS du jeu au premier plan ;
  - psutil : RAM, disques, réseau.

La page du téléphone est servie sur http://<PC>:8790, ou http://localhost:8790 par le
câble USB avec « adb reverse tcp:8790 tcp:8790 ».
"""

import ctypes
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.request
from collections import deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import psutil

VERSION = "1.0"
FROZEN = getattr(sys, "frozen", False)
HERE = os.path.dirname(sys.executable if FROZEN else os.path.abspath(__file__))
WEB = os.path.join(getattr(sys, "_MEIPASS", HERE), "web")
CONFIG_PATH = os.path.join(HERE, "moniteur-config.json")
IS_WINDOWS = sys.platform == "win32"
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

DEFAULT_CONFIG = {
    "port": 8790,
    "lhm_url": "http://127.0.0.1:8085/data.json",
    # Seuils d'alerte : [attention, critique]. Le RX 580 encaisse jusqu'à ~85 °C.
    "seuils": {
        "cpu_temp": [80, 90],
        "gpu_temp": [78, 85],
        "disque_temp": [55, 65],
        "ram": [90, 97],
        "disque_plein": [90, 97],
        "cpu_charge": [95, 101],
        "fps_bas": 30,
    },
    "ntfy": {"actif": False, "sujet": "", "serveur": "https://ntfy.sh"},
}


def load_config():
    cfg = json.loads(json.dumps(DEFAULT_CONFIG))
    try:
        with open(CONFIG_PATH, encoding="utf-8") as f:
            user = json.load(f)
        for k, v in user.items():
            if isinstance(v, dict) and isinstance(cfg.get(k), dict):
                cfg[k].update(v)
            else:
                cfg[k] = v
    except FileNotFoundError:
        save_config(cfg)
    except (OSError, ValueError) as e:
        print("Config illisible, valeurs par défaut utilisées :", e)
    return cfg


def save_config(cfg):
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2, ensure_ascii=False)


# ------------------------------------------------------------ LibreHardwareMonitor

UNITS = {"°C": "temp", "%": "pct", "RPM": "rpm", "MHz": "mhz", "W": "w",
         "V": "v", "GB": "gb", "MB": "mb", "KB/s": "kbs", "MB/s": "mbs"}


def parse_value(text):
    """« 45,0 °C » ou « 1 234.5 RPM » -> (45.0, '°C'). Gère la virgule française."""
    m = re.match(r"^\s*(-?[\d\s  .,]+)\s*(.*)$", str(text or ""))
    if not m:
        return None, ""
    num = re.sub(r"[\s  ]", "", m.group(1))
    if "," in num and "." in num:
        num = num.replace(",", "")
    num = num.replace(",", ".")
    try:
        return float(num), m.group(2).strip()
    except ValueError:
        return None, m.group(2).strip()


def hardware_kind(image_url, name):
    img = (image_url or "").lower()
    n = (name or "").lower()
    if "cpu" in img:
        return "cpu"
    if any(k in img for k in ("ati", "amd", "nvidia", "gpu", "intel")) and "cpu" not in img:
        return "gpu"
    if "ram" in img or "memory" in n and "gpu" not in n:
        return "ram"
    if "hdd" in img or "nvme" in img or "ssd" in img or "storage" in img:
        return "disque"
    if "mainboard" in img or "motherboard" in img:
        return "carte_mere"
    if "chip" in img or "superio" in img:
        return "puce"
    if "nic" in img or "network" in img or "ethernet" in img:
        return "reseau"
    return "autre"


GROUPS = {"Temperatures": "temp", "Load": "charge", "Fans": "ventilo", "Clocks": "freq",
          "Powers": "puissance", "Voltages": "tension", "Controls": "controle",
          "Data": "donnees", "SmallData": "donnees", "Throughput": "debit"}


def parse_lhm(tree):
    """Aplatit l'arbre JSON de LibreHardwareMonitor en une liste de composants."""
    hardware = []

    def walk(node, current, group):
        children = node.get("Children") or []
        img = node.get("ImageURL", "")
        text = node.get("Text", "")
        value = node.get("Value", "")
        if text in GROUPS and children and current is not None:
            for c in children:
                walk(c, current, GROUPS[text])
            return
        if value and group and current is not None and not children:
            v, unit = parse_value(value)
            if v is not None:
                vmax, _ = parse_value(node.get("Max", ""))
                current["capteurs"].append({"groupe": group, "nom": text, "valeur": v,
                                            "unite": unit, "max": vmax})
            return
        if img and "computer" not in img.lower() and children:
            hw = {"nom": text, "type": hardware_kind(img, text), "capteurs": []}
            hardware.append(hw)
            for c in children:
                walk(c, hw, None)
            return
        for c in children:
            walk(c, current, group)

    walk(tree, None, None)
    return [h for h in hardware if h["capteurs"]]


def read_lhm(url):
    try:
        with urllib.request.urlopen(url, timeout=1.5) as r:
            return parse_lhm(json.load(r))
    except Exception:
        return None


def pick(hw, group, names=(), contains=(), agg=None):
    """Valeur d'un capteur : d'abord par nom exact, puis par sous-chaîne, puis agrégat."""
    sensors = [s for s in hw["capteurs"] if s["groupe"] == group]
    for n in names:
        for s in sensors:
            if s["nom"].lower() == n.lower():
                return s["valeur"]
    for c in contains:
        for s in sensors:
            if c.lower() in s["nom"].lower():
                return s["valeur"]
    if agg and sensors:
        return agg(s["valeur"] for s in sensors)
    return None


def first(hardware, kind):
    return next((h for h in hardware if h["type"] == kind), None)


# ------------------------------------------------------------ PresentMon (FPS)

PRESENTMON_IGNORE = {"dwm.exe", "explorer.exe", "searchhost.exe", "startmenuexperiencehost.exe",
                     "textinputhost.exe", "shellexperiencehost.exe", "applicationframehost.exe",
                     "steamwebhelper.exe", "msedgewebview2.exe", "nvcontainer.exe",
                     "radeonsoftware.exe", "amdrsserv.exe", "<unknown>", "lockapp.exe"}


def foreground_pid():
    if not IS_WINDOWS:
        return None
    try:
        user32 = ctypes.windll.user32
        hwnd = user32.GetForegroundWindow()
        pid = ctypes.c_ulong()
        user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
        return pid.value
    except Exception:
        return None


class FpsTracker:
    """Lit la sortie CSV de PresentMon et calcule les FPS par application."""

    WINDOW = 2.0  # secondes

    def __init__(self):
        self.frames = {}  # (app, pid) -> deque[(t_recu, frametime_ms)]
        self.cols = None
        self.lock = threading.Lock()
        self.status = "non démarré"

    def feed_header(self, line):
        cols = [c.strip() for c in line.strip().split(",")]
        self.cols = {name: i for i, name in enumerate(cols)}

    def feed(self, line, now=None):
        if self.cols is None:
            if "Application" in line:  # ignore le texte d'accueil avant l'en-tête CSV
                self.feed_header(line)
            return
        parts = line.rstrip("\r\n").split(",")
        if len(parts) < 3:
            return
        if parts[0] == "Application":  # nouvel en-tête (redémarrage de session)
            self.feed_header(line)
            return
        try:
            app = parts[self.cols["Application"]]
            pid = int(parts[self.cols.get("ProcessID", 1)])
            ft_col = next(c for c in ("FrameTime", "MsBetweenPresents", "msBetweenPresents",
                                      "MsBetweenAppStart") if c in self.cols)
            ft = float(parts[self.cols[ft_col]])
        except (KeyError, ValueError, IndexError, StopIteration):
            return
        if ft <= 0 or ft > 1000 or app.lower() in PRESENTMON_IGNORE:
            return
        now = time.time() if now is None else now
        with self.lock:
            self.frames.setdefault((app, pid), deque()).append((now, ft))

    def snapshot(self, now=None):
        now = time.time() if now is None else now
        fg = foreground_pid()
        best = None
        with self.lock:
            for key in list(self.frames):
                dq = self.frames[key]
                while dq and now - dq[0][0] > self.WINDOW:
                    dq.popleft()
                if not dq:
                    del self.frames[key]
                    continue
                score = (key[1] == fg, len(dq))
                if best is None or score > best[0]:
                    best = (score, key, list(dq))
        if best is None:
            return None
        _, (app, pid), samples = best
        fts = sorted(ft for _, ft in samples)
        if len(fts) < 5:
            return None
        avg = sum(fts) / len(fts)
        worst = fts[max(0, int(len(fts) * 0.99) - 1):]  # 1 % des images les plus lentes
        low1 = sum(worst) / len(worst)
        return {"app": re.sub(r"\.exe$", "", app, flags=re.I), "fps": round(1000 / avg),
                "low1": round(1000 / low1), "frametime": round(avg, 1)}


def find_presentmon():
    for name in os.listdir(HERE):
        if re.match(r"(?i)presentmon.*\.exe$", name):
            return os.path.join(HERE, name)
    return shutil.which("PresentMon") or shutil.which("presentmon")


def download_presentmon():
    """Télécharge la dernière version console de PresentMon depuis GitHub (licence MIT)."""
    api = "https://api.github.com/repos/GameTechDev/PresentMon/releases/latest"
    req = urllib.request.Request(api, headers={"User-Agent": "MoniteurPC"})
    with urllib.request.urlopen(req, timeout=20) as r:
        assets = json.load(r).get("assets", [])
    pattern = re.compile(r"(?i)^presentmon-[\d.]+-x64\.exe$")
    asset = next((a for a in assets if pattern.match(a["name"])), None)
    if asset is None:
        asset = next((a for a in assets if re.search(r"(?i)x64\.exe$", a["name"])
                      and "service" not in a["name"].lower()), None)
    if asset is None:
        raise RuntimeError("aucun exécutable PresentMon trouvé dans la dernière version")
    path = os.path.join(HERE, asset["name"])
    urllib.request.urlretrieve(asset["browser_download_url"], path)
    return path


def run_presentmon(tracker):
    if not IS_WINDOWS:
        tracker.status = "indisponible (Windows uniquement)"
        return
    exe = find_presentmon()
    if exe is None:
        try:
            tracker.status = "téléchargement de PresentMon…"
            exe = download_presentmon()
        except Exception as e:
            tracker.status = "PresentMon introuvable : " + str(e)
            return
    # Les options ont changé entre PresentMon 1.x et 2.x : on essaie dans l'ordre.
    variants = [
        ["--output_stdout", "--stop_existing_session", "--session_name", "MoniteurPC",
         "--no_console_stats"],
        ["--output_stdout", "--stop_existing_session", "--session_name", "MoniteurPC"],
        ["-output_stdout", "-stop_existing_session", "-session_name", "MoniteurPC", "-no_top"],
    ]
    i = 0
    while True:
        started, rows = time.time(), 0
        try:
            proc = subprocess.Popen([exe] + variants[i], stdout=subprocess.PIPE,
                                    stderr=subprocess.PIPE, text=True, bufsize=1,
                                    creationflags=NO_WINDOW)
            tracker.status = "actif"
            tracker.cols = None
            for line in proc.stdout:
                rows += 1
                tracker.feed(line)
            err = (proc.stderr.read() or "").strip().splitlines()
            tracker.status = "arrêté : " + (err[-1] if err else "code %s" % proc.wait())
        except Exception as e:
            tracker.status = "erreur : " + str(e)
        if rows <= 1 and time.time() - started < 5:
            i = (i + 1) % len(variants)  # options refusées : variante suivante
        time.sleep(3 if i else 10)


# ------------------------------------------------------------ alertes

class Alerts:
    """Une alerte se déclenche après une durée minimale, pour éviter les fausses alertes."""

    def __init__(self, notify):
        self.active = {}      # id -> alerte
        self.pending = {}     # id -> début de la condition
        self.history = deque(maxlen=50)
        self.notify = notify
        self.last_sent = {}

    def check(self, rid, cond, niveau, titre, detail, delay=5.0, now=None):
        now = time.time() if now is None else now
        if not cond:
            self.pending.pop(rid, None)
            if rid in self.active:
                a = self.active.pop(rid)
                self.history.appendleft({**a, "fin": now})
            return
        start = self.pending.setdefault(rid, now)
        if now - start < delay:
            return
        a = self.active.get(rid)
        if a is None or a["niveau"] != niveau:
            a = {"id": rid, "niveau": niveau, "titre": titre, "detail": detail, "debut": now}
            self.active[rid] = a
            self.history.appendleft(dict(a))
            # Une notification par problème toutes les 10 min au plus, sauf si ça devient critique.
            if rid not in self.last_sent or now - self.last_sent[rid] > 600 or niveau == "critique":
                self.last_sent[rid] = now
                self.notify(a)
        else:
            a["detail"] = detail

    def evaluate(self, s, cfg, now=None):
        t = cfg["seuils"]

        def level(value, pair):
            if value is None:
                return None
            if value >= pair[1]:
                return "critique"
            if value >= pair[0]:
                return "attention"
            return None

        for key, label in (("cpu_temp", "Processeur trop chaud"),
                           ("gpu_temp", "Carte graphique trop chaude")):
            v = s.get(key)
            lv = level(v, t[key])
            seuil = t[key][1] if lv == "critique" else t[key][0]
            self.check(key, lv, lv or "attention", label,
                       "%.0f °C (seuil %d °C)" % (v or 0, seuil),
                       delay=3 if lv == "critique" else 10, now=now)

        fan, gtemp = s.get("gpu_fan_rpm"), s.get("gpu_temp")
        self.check("gpu_fan", fan is not None and fan < 100 and (gtemp or 0) >= 65, "critique",
                   "Ventilateur GPU arrêté ?", "%d tr/min alors que le GPU est à %.0f °C"
                   % (fan or 0, gtemp or 0), delay=15, now=now)

        lv = level(s.get("ram"), t["ram"])
        self.check("ram", lv, lv or "attention", "Mémoire presque pleine",
                   "%.0f %% de RAM utilisée" % (s.get("ram") or 0), delay=30, now=now)

        lv = level(s.get("cpu"), t["cpu_charge"])
        self.check("cpu_load", lv, "attention", "Processeur bloqué à fond",
                   "%.0f %% depuis plus d'une minute" % (s.get("cpu") or 0), delay=60, now=now)

        for d in s.get("disques", []):
            lv = level(d.get("pct"), t["disque_plein"])
            self.check("disk_" + d["nom"], lv, lv or "attention", "Disque %s presque plein" % d["nom"],
                       "%.0f %% utilisé, %.0f Go libres" % (d["pct"], d["libre_go"]), delay=0, now=now)
        for d in s.get("disques_temp", []):
            lv = level(d["temp"], t["disque_temp"])
            self.check("disktemp_" + d["nom"], lv, lv or "attention", "Disque trop chaud",
                       "%s : %.0f °C" % (d["nom"], d["temp"]), delay=30, now=now)

        # Seulement en jeu (GPU chargé) : un navigateur qui rafraîchit peu ne compte pas.
        fps = s.get("fps")
        in_game = fps is not None and (s.get("gpu") or 0) >= 50
        self.check("fps", in_game and fps["fps"] < t["fps_bas"], "attention", "FPS bas",
                   "%s : %d FPS" % (fps["app"], fps["fps"]) if fps else "", delay=10, now=now)

        self.check("lhm", not s.get("lhm_ok"), "info", "Températures indisponibles",
                   "LibreHardwareMonitor ne répond pas : lance-le en administrateur et active "
                   "Options > Remote Web Server", delay=20, now=now)


def send_ntfy(cfg, alert):
    n = cfg["ntfy"]
    if not n.get("actif") or not n.get("sujet"):
        return
    prio = {"critique": 5, "attention": 4}.get(alert["niveau"], 3)
    tag = {"critique": "rotating_light", "attention": "warning"}.get(alert["niveau"], "information_source")
    body = json.dumps({"topic": n["sujet"], "title": alert["titre"], "message": alert["detail"],
                       "priority": prio, "tags": [tag]}).encode("utf-8")
    req = urllib.request.Request(n["serveur"].rstrip("/"), data=body,
                                 headers={"Content-Type": "application/json"})
    try:
        urllib.request.urlopen(req, timeout=5).close()
    except Exception as e:
        print("Notification non envoyée :", e)


# ------------------------------------------------------------ collecte

def static_info():
    info = {"os": "", "cpu": "", "ram_go": round(psutil.virtual_memory().total / 2**30, 1),
            "coeurs": psutil.cpu_count(logical=False), "threads": psutil.cpu_count()}
    if IS_WINDOWS:
        try:
            import winreg
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                               r"HARDWARE\DESCRIPTION\System\CentralProcessor\0")
            info["cpu"] = winreg.QueryValueEx(k, "ProcessorNameString")[0].strip()
            k = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE,
                               r"SOFTWARE\Microsoft\Windows NT\CurrentVersion")
            name = winreg.QueryValueEx(k, "ProductName")[0]
            build = int(winreg.QueryValueEx(k, "CurrentBuildNumber")[0])
            if build >= 22000:
                name = name.replace("Windows 10", "Windows 11")
            info["os"] = "%s (build %d)" % (name, build)
        except Exception:
            pass
    if not info["os"]:
        import platform
        info["os"] = platform.platform()
    return info


class Collector(threading.Thread):
    def __init__(self, cfg, tracker):
        super().__init__(daemon=True)
        self.cfg = cfg
        self.tracker = tracker
        self.alerts = Alerts(lambda a: send_ntfy(self.cfg, a))
        self.state = {}
        self.lock = threading.Lock()
        self.static = static_info()
        self.boot = psutil.boot_time()

    def run(self):
        psutil.cpu_percent(None)
        net = psutil.net_io_counters()
        last = time.time()
        while True:
            time.sleep(1)
            now = time.time()
            new_net = psutil.net_io_counters()
            dt = max(now - last, 0.001)
            try:
                s = self.collect(now, (new_net.bytes_recv - net.bytes_recv) / dt,
                                 (new_net.bytes_sent - net.bytes_sent) / dt)
                self.alerts.evaluate(s, self.cfg, now)
                s["alertes"] = sorted(self.alerts.active.values(),
                                      key=lambda a: ("critique", "attention", "info").index(a["niveau"]))
                s["historique"] = list(self.alerts.history)
                with self.lock:
                    self.state = s
            except Exception as e:
                print("Erreur de collecte :", e)
            net, last = new_net, now

    def collect(self, now, down, up):
        mem = psutil.virtual_memory()
        s = {"t": now, "version": VERSION, "systeme": self.static,
             "uptime": now - self.boot, "cpu": psutil.cpu_percent(None), "ram": mem.percent,
             "ram_util_go": round(mem.used / 2**30, 1), "ram_total_go": round(mem.total / 2**30, 1),
             "net_down": down, "net_up": up, "fps": self.tracker.snapshot(now),
             "fps_statut": self.tracker.status, "seuils": self.cfg["seuils"]}
        disques = []
        for p in psutil.disk_partitions(all=False):
            opts = p.opts.split(",")
            if "cdrom" in opts or "ro" in opts or not p.fstype:
                continue
            try:
                u = psutil.disk_usage(p.mountpoint)
            except OSError:
                continue
            disques.append({"nom": p.mountpoint.rstrip("\\/") or p.mountpoint, "pct": u.percent,
                            "libre_go": u.free / 2**30, "total_go": u.total / 2**30})
        s["disques"] = disques

        hw = read_lhm(self.cfg["lhm_url"])
        s["lhm_ok"] = hw is not None
        s["composants"] = hw or []
        s["disques_temp"] = []
        if hw:
            cpu, gpu = first(hw, "cpu"), first(hw, "gpu")
            if cpu:
                s["cpu_nom"] = cpu["nom"]
                s["cpu_temp"] = pick(cpu, "temp", ("Core (Tctl/Tdie)", "CPU Package", "Core (Tctl)",
                                                   "Package", "Core Max", "Core Average"), agg=max)
                s["cpu_puissance"] = pick(cpu, "puissance", ("CPU Package", "Package"),
                                          contains=("package",))
                s["cpu_freq"] = pick(cpu, "freq", contains=("core #1",), agg=max)
            if gpu:
                s["gpu_nom"] = gpu["nom"]
                s["gpu"] = pick(gpu, "charge", ("GPU Core", "D3D 3D"), contains=("core", "3d"))
                s["gpu_temp"] = pick(gpu, "temp", ("GPU Core", "GPU Hot Spot"), agg=max)
                s["gpu_fan_rpm"] = pick(gpu, "ventilo", ("GPU Fan",), contains=("fan",))
                s["gpu_fan_pct"] = pick(gpu, "controle", ("GPU Fan",), contains=("fan",))
                s["gpu_freq"] = pick(gpu, "freq", ("GPU Core",), contains=("core",))
                s["gpu_puissance"] = pick(gpu, "puissance", ("GPU Package", "GPU Core", "GPU Power"),
                                          contains=("package", "power", "core"))
                used = pick(gpu, "donnees", ("GPU Memory Used", "D3D Dedicated Memory Used"),
                            contains=("memory used",))
                total = pick(gpu, "donnees", ("GPU Memory Total",), contains=("memory total",))
                if used is not None and total:
                    s["vram"] = round(100 * used / total, 1)
                    s["vram_go"] = [round(used / 1024, 1), round(total / 1024, 1)]
                elif used is not None:
                    s["vram_go"] = [round(used / 1024, 1), None]
            for d in (h for h in hw if h["type"] == "disque"):
                t = pick(d, "temp", contains=("temperature",), agg=max)
                if t is not None:
                    s["disques_temp"].append({"nom": d["nom"], "temp": t})
        return s

    def get(self):
        with self.lock:
            return self.state


# ------------------------------------------------------------ serveur HTTP

class Handler(BaseHTTPRequestHandler):
    collector = None
    cfg = None

    def log_message(self, fmt, *args):
        pass

    def send(self, code, body, ctype="application/json"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path == "/api/etat":
            return self.send(200, self.collector.get())
        if path == "/api/ntfy":
            n = self.cfg["ntfy"]
            return self.send(200, {"actif": n["actif"], "sujet": n["sujet"], "serveur": n["serveur"]})
        if path in ("/", "/index.html"):
            with open(os.path.join(WEB, "index.html"), "rb") as f:
                return self.send(200, f.read(), "text/html; charset=utf-8")
        if path == "/manifest.webmanifest":
            with open(os.path.join(WEB, "manifest.webmanifest"), "rb") as f:
                return self.send(200, f.read(), "application/manifest+json")
        self.send(404, {"erreur": "introuvable"})

    def do_POST(self):
        n = self.cfg["ntfy"]
        if self.path == "/api/ntfy/activer":
            if not n["sujet"]:
                n["sujet"] = "moniteur-pc-" + secrets.token_hex(8)
            n["actif"] = True
            save_config(self.cfg)
            return self.send(200, {"actif": True, "sujet": n["sujet"], "serveur": n["serveur"]})
        if self.path == "/api/ntfy/desactiver":
            n["actif"] = False
            save_config(self.cfg)
            return self.send(200, {"actif": False, "sujet": n["sujet"], "serveur": n["serveur"]})
        if self.path == "/api/ntfy/test":
            send_ntfy(self.cfg, {"niveau": "info", "titre": "Moniteur PC",
                                 "detail": "Notification de test : tout fonctionne."})
            return self.send(200, {"ok": True})
        self.send(404, {"erreur": "introuvable"})


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


def install_startup():
    """Lance le moniteur à chaque ouverture de session, avec les droits administrateur."""
    if not FROZEN:
        return print("Disponible seulement avec MoniteurPC.exe")
    # PowerShell plutôt que schtasks : schtasks arrête la tâche au bout de 72 h par défaut.
    ps = ("$a = New-ScheduledTaskAction -Execute '{exe}' -WorkingDirectory '{dir}'; "
          "$t = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME; "
          "$p = New-ScheduledTaskPrincipal -UserId $env:USERNAME -RunLevel Highest "
          "-LogonType Interactive; "
          "$s = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) "
          "-AllowStartIfOnBatteries -DontStopIfGoingOnBatteries; "
          "Register-ScheduledTask -TaskName MoniteurPC -Action $a -Trigger $t -Principal $p "
          "-Settings $s -Force | Out-Null; 'Démarrage automatique activé.'"
          ).format(exe=sys.executable.replace("'", "''"), dir=HERE.replace("'", "''"))
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    print(r.stdout or r.stderr)


def main():
    if "--demarrage" in sys.argv:
        return install_startup()
    if "--retirer-demarrage" in sys.argv:
        r = subprocess.run(["schtasks", "/Delete", "/TN", "MoniteurPC", "/F"],
                           capture_output=True, text=True)
        return print(r.stdout or r.stderr)
    cfg = load_config()
    tracker = FpsTracker()
    threading.Thread(target=run_presentmon, args=(tracker,), daemon=True).start()
    collector = Collector(cfg, tracker)
    collector.start()
    Handler.collector, Handler.cfg = collector, cfg
    port = int(cfg["port"])
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    print("Moniteur PC %s lancé." % VERSION)
    print("  Par câble USB : adb reverse tcp:%d tcp:%d puis http://localhost:%d" % (port, port, port))
    print("  Par Wi-Fi     : http://%s:%d" % (lan_ip(), port))
    if IS_WINDOWS and not ctypes.windll.shell32.IsUserAnAdmin():
        print("Attention : lancé sans droits administrateur, les FPS ne seront pas mesurés.")
    print("Laisse cette fenêtre ouverte. Ctrl+C pour arrêter.")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
