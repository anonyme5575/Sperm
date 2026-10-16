package com.moniteur.pc;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

import org.json.JSONArray;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Set;

/**
 * Surveille le PC en arrière-plan, même écran éteint, et envoie une notification Android
 * pour chaque nouveau problème (température, ventilateur, disque, FPS…).
 */
public class WatchService extends Service {
    private static final String CH_WATCH = "surveillance", CH_ALERT = "alertes";
    private static final long PERIOD_MS = 5000, OFFLINE_MS = 45000;

    private volatile boolean running;
    private final Set<String> seen = new HashSet<>();
    private long lastOk;
    private boolean offlineSent;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel(CH_WATCH, "Surveillance du PC",
                NotificationManager.IMPORTANCE_MIN));
        NotificationChannel alerts = new NotificationChannel(CH_ALERT, "Problèmes du PC",
                NotificationManager.IMPORTANCE_HIGH);
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[]{0, 300, 150, 300});
        nm.createNotificationChannel(alerts);
        startForeground(1, new Notification.Builder(this, CH_WATCH)
                .setSmallIcon(android.R.drawable.ic_menu_view)
                .setContentTitle("Surveillance de " + Pc.name(this))
                .setContentIntent(openApp())
                .setOngoing(true)
                .build());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (!running) {
            running = true;
            new Thread(new Runnable() {
                @Override
                public void run() { loop(); }
            }, "surveillance").start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        super.onDestroy();
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_IMMUTABLE);
    }

    private void loop() {
        while (running) {
            String host = Pc.host(this);
            String json = host == null ? null : Pc.get(host, "/api/etat", 4000);
            long now = System.currentTimeMillis();
            if (json != null) {
                lastOk = now;
                offlineSent = false;
                handle(json);
            } else if (lastOk > 0 && now - lastOk > OFFLINE_MS && !offlineSent) {
                offlineSent = true;
                post("offline".hashCode(), "PC injoignable",
                        Pc.name(this) + " ne répond plus : éteint, planté, ou Wi-Fi coupé. "
                                + "Si tu viens de l'éteindre, ignore ce message.", false);
            }
            try { Thread.sleep(PERIOD_MS); } catch (InterruptedException e) { return; }
        }
    }

    private void handle(String json) {
        try {
            JSONArray alerts = new JSONObject(json).optJSONArray("alertes");
            Set<String> current = new HashSet<>();
            if (alerts != null) {
                for (int i = 0; i < alerts.length(); i++) {
                    JSONObject a = alerts.getJSONObject(i);
                    String level = a.optString("niveau");
                    if ("info".equals(level)) continue;
                    String key = a.optString("id") + ":" + level;
                    current.add(key);
                    if (seen.contains(key)) continue;
                    post(a.optString("id").hashCode(), a.optString("titre"), a.optString("detail"),
                            "critique".equals(level));
                }
            }
            // Un problème réglé puis revenu redonnera une notification.
            seen.retainAll(current);
            seen.addAll(current);
        } catch (Exception ignored) {
        }
    }

    private void post(int id, String title, String text, boolean critical) {
        Notification n = new Notification.Builder(this, CH_ALERT)
                .setSmallIcon(critical ? android.R.drawable.stat_notify_error : android.R.drawable.stat_sys_warning)
                .setContentTitle((critical ? "⛔ " : "⚠ ") + title)
                .setContentText(text)
                .setStyle(new Notification.BigTextStyle().bigText(text))
                .setContentIntent(openApp())
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_ALARM)
                .build();
        getSystemService(NotificationManager.class).notify(id, n);
    }
}
