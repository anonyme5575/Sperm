package com.duo.kiosk;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.ImageView;

/**
 * Bouton flottant discret par-dessus les deux apps.
 * Toucher : bascule vers l'autre app (le bouton affiche son icône).
 * Appui long : revient à l'écran Duo. Glisser : déplace le bouton, qui se colle au bord.
 *
 * La position est retenue en proportion de l'écran (bord gauche/droit + hauteur relative),
 * pour rester visible quand une app passe en paysage et l'autre en portrait.
 */
public class ToggleService extends Service {
    private static final long LONG_PRESS_MS = 700;
    private static final float IDLE_ALPHA = 0.35f;

    private WindowManager wm;
    private ImageView button;
    private WindowManager.LayoutParams lp;
    private int size;
    private boolean right;
    private float fy;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private SharedPreferences.OnSharedPreferenceChangeListener listener;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        startForeground(1, notification());
        if (!Settings.canDrawOverlays(this)) {
            stopSelf();
            return;
        }
        wm = (WindowManager) getSystemService(WINDOW_SERVICE);
        size = dp(40);
        button = new ImageView(this);
        int pad = dp(7);
        button.setPadding(pad, pad, pad, pad);
        GradientDrawable bg = new GradientDrawable();
        bg.setShape(GradientDrawable.OVAL);
        bg.setColor(0x99000000);
        button.setBackground(bg);
        button.setAlpha(IDLE_ALPHA);

        SharedPreferences p = Duo.prefs(this);
        lp = new WindowManager.LayoutParams(size, size,
                WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        lp.gravity = Gravity.TOP | Gravity.START;
        right = p.getBoolean("btnRight", true);
        fy = p.getFloat("btnFy", 0.5f);
        place();

        button.setOnTouchListener(new Drag());
        wm.addView(button, lp);
        refreshIcon();

        listener = new SharedPreferences.OnSharedPreferenceChangeListener() {
            @Override
            public void onSharedPreferenceChanged(SharedPreferences sp, String key) {
                if ("current".equals(key)) refreshIcon();
            }
        };
        p.registerOnSharedPreferenceChangeListener(listener);
    }

    @Override
    public void onDestroy() {
        if (listener != null) Duo.prefs(this).unregisterOnSharedPreferenceChangeListener(listener);
        if (button != null) wm.removeView(button);
        super.onDestroy();
    }

    @Override
    public void onConfigurationChanged(Configuration c) {
        super.onConfigurationChanged(c);
        if (button == null) return;
        place();
        // Certaines versions de MIUI donnent la nouvelle taille d'écran un peu après la rotation.
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (button != null) place();
            }
        }, 400);
    }

    private Point screen() {
        Point pt = new Point();
        wm.getDefaultDisplay().getRealSize(pt);
        return pt;
    }

    /** Colle le bouton au bord choisi, à la hauteur relative retenue, toujours dans l'écran. */
    private void place() {
        Point s = screen();
        lp.x = right ? s.x - size : 0;
        lp.y = Math.round(Math.max(0f, Math.min(1f, fy)) * Math.max(0, s.y - size));
        if (button.isAttachedToWindow()) wm.updateViewLayout(button, lp);
    }

    /** Le bouton montre l'icône de l'app vers laquelle on va basculer. */
    private void refreshIcon() {
        String a = Duo.app(this, 1), b = Duo.app(this, 2);
        if (a == null || b == null) return;
        String next = a.equals(Duo.prefs(this).getString("current", Duo.HOME)) ? b : a;
        try {
            Drawable icon = getPackageManager().getApplicationIcon(next);
            button.setImageDrawable(icon);
        } catch (Exception e) {
            button.setImageResource(R.drawable.ic_launcher);
        }
    }

    private class Drag implements View.OnTouchListener {
        private float downX, downY;
        private int startX, startY;
        private boolean moved, longPressed;
        private final Runnable longPress = new Runnable() {
            @Override
            public void run() {
                longPressed = true;
                Intent i = new Intent(ToggleService.this, MainActivity.class);
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                Duo.prefs(ToggleService.this).edit().putString("current", Duo.HOME).apply();
                startActivity(i);
            }
        };

        @Override
        public boolean onTouch(View v, MotionEvent e) {
            switch (e.getActionMasked()) {
                case MotionEvent.ACTION_DOWN:
                    downX = e.getRawX();
                    downY = e.getRawY();
                    startX = lp.x;
                    startY = lp.y;
                    moved = longPressed = false;
                    v.setAlpha(1f);
                    handler.postDelayed(longPress, LONG_PRESS_MS);
                    return true;
                case MotionEvent.ACTION_MOVE:
                    float dx = e.getRawX() - downX, dy = e.getRawY() - downY;
                    if (!moved && Math.hypot(dx, dy) > dp(12)) {
                        moved = true;
                        handler.removeCallbacks(longPress);
                    }
                    if (moved) {
                        lp.x = startX + (int) dx;
                        lp.y = startY + (int) dy;
                        wm.updateViewLayout(button, lp);
                    }
                    return true;
                case MotionEvent.ACTION_UP:
                case MotionEvent.ACTION_CANCEL:
                    handler.removeCallbacks(longPress);
                    v.setAlpha(IDLE_ALPHA);
                    if (moved) {
                        Point s = screen();
                        right = lp.x + size / 2 > s.x / 2;
                        fy = s.y > size ? (float) lp.y / (s.y - size) : 0.5f;
                        place();
                        Duo.prefs(ToggleService.this).edit()
                                .putBoolean("btnRight", right).putFloat("btnFy", fy).apply();
                    } else if (!longPressed && e.getActionMasked() == MotionEvent.ACTION_UP) {
                        Duo.toggle(ToggleService.this);
                    }
                    return true;
            }
            return false;
        }
    }

    private Notification notification() {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.createNotificationChannel(new NotificationChannel("duo", "Mode Duo",
                NotificationManager.IMPORTANCE_MIN));
        return new Notification.Builder(this, "duo")
                .setSmallIcon(R.drawable.ic_launcher)
                .setContentTitle("Mode Duo actif")
                .setOngoing(true)
                .build();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
