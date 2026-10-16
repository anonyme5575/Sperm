package com.moniteur.pc;

import android.content.Context;
import android.content.SharedPreferences;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InterfaceAddress;
import java.net.NetworkInterface;
import java.net.SocketTimeoutException;
import java.net.URL;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Le PC surveillé : adresse retenue, recherche sur le Wi-Fi, lecture de l'état. */
final class Pc {
    static final int DISCOVERY_PORT = 8791;
    static final int DEFAULT_PORT = 8790;

    /** Un PC trouvé : « 192.168.1.20:8790 » et son nom. */
    static final class Found {
        final String host;
        final String name;
        Found(String host, String name) { this.host = host; this.name = name; }
    }

    private Pc() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("pc", Context.MODE_PRIVATE);
    }

    static String host(Context c) {
        return prefs(c).getString("host", null);
    }

    static void save(Context c, String host, String name) {
        prefs(c).edit().putString("host", host).putString("name", name).apply();
    }

    static String name(Context c) {
        return prefs(c).getString("name", "PC");
    }

    static String normalize(String input) {
        String h = input.trim().replaceFirst("^https?://", "").replaceAll("/.*$", "");
        return h.contains(":") ? h : h + ":" + DEFAULT_PORT;
    }

    /** GET http://host/path, ou null si le PC ne répond pas. */
    static String get(String host, String path, int timeoutMs) {
        HttpURLConnection con = null;
        try {
            con = (HttpURLConnection) new URL("http://" + host + path).openConnection();
            con.setConnectTimeout(timeoutMs);
            con.setReadTimeout(timeoutMs);
            con.setUseCaches(false);
            if (con.getResponseCode() != 200) return null;
            InputStream in = con.getInputStream();
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        } catch (Exception e) {
            return null;
        } finally {
            if (con != null) con.disconnect();
        }
    }

    static boolean reachable(String host) {
        String s = get(host, "/api/etat", 2000);
        return s != null && s.contains("\"version\"");
    }

    /**
     * Cherche les PC qui font tourner Moniteur PC : par le câble USB (adb reverse) puis par une
     * diffusion sur le Wi-Fi, à laquelle chaque PC répond avec son nom.
     */
    static List<Found> discover() {
        Map<String, Found> found = new LinkedHashMap<>();
        if (reachable("127.0.0.1:" + DEFAULT_PORT)) {
            found.put("usb", new Found("127.0.0.1:" + DEFAULT_PORT, "PC branché en USB"));
        }
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(400);
            byte[] ask = "MONITEURPC?".getBytes("UTF-8");
            List<InetAddress> targets = new ArrayList<>();
            targets.add(InetAddress.getByName("255.255.255.255"));
            for (NetworkInterface ni : Collections.list(NetworkInterface.getNetworkInterfaces())) {
                if (!ni.isUp() || ni.isLoopback()) continue;
                for (InterfaceAddress ia : ni.getInterfaceAddresses()) {
                    if (ia.getBroadcast() != null) targets.add(ia.getBroadcast());
                }
            }
            long end = System.currentTimeMillis() + 2500;
            int round = 0;
            byte[] buf = new byte[512];
            while (System.currentTimeMillis() < end) {
                if (round++ < 3) {
                    for (InetAddress t : targets) {
                        try { socket.send(new DatagramPacket(ask, ask.length, t, DISCOVERY_PORT)); }
                        catch (Exception ignored) { }
                    }
                }
                try {
                    DatagramPacket p = new DatagramPacket(buf, buf.length);
                    socket.receive(p);
                    String[] parts = new String(p.getData(), 0, p.getLength(), "UTF-8").split("\\|");
                    if (parts.length >= 3 && parts[0].equals("MONITEURPC")) {
                        String host = p.getAddress().getHostAddress() + ":" + parts[1];
                        found.put(host, new Found(host, parts[2]));
                    }
                } catch (SocketTimeoutException ignored) {
                    // on renvoie une demande au tour suivant
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (socket != null) socket.close();
        }
        return new ArrayList<>(found.values());
    }
}
