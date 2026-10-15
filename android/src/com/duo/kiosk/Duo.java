package com.duo.kiosk;

import android.app.Activity;
import android.app.ActivityManager;
import android.app.admin.DevicePolicyManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.provider.Settings;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

/** Entrée et sortie du mode Duo : verrouillage sur deux apps, coupure du reste. */
final class Duo {
    static final String HOME = "home";

    /**
     * Apps système préinstallées qu'on peut masquer sans casser le téléphone
     * (pubs et services Xiaomi, apps Google et Facebook préinstallées). Les apps
     * installées par l'utilisateur sont toujours masquées, sauf les deux choisies.
     */
    private static final Set<String> SAFE_SYSTEM = new HashSet<>(Arrays.asList(
            "com.miui.analytics", "com.miui.msa.global", "com.miui.videoplayer",
            "com.miui.player", "com.mi.globalbrowser", "com.miui.weather2",
            "com.xiaomi.mipicks", "com.miui.yellowpage", "com.miui.notes",
            "com.miui.compass", "com.miui.fm", "com.xiaomi.glgm", "com.mi.global.bbs",
            "com.mi.global.shop", "com.mi.android.globalFileexplorer", "com.miui.gallery",
            "com.xiaomi.midrop", "com.miui.calculator", "com.android.email",
            "com.facebook.appmanager", "com.facebook.services", "com.facebook.system",
            "com.facebook.katana", "com.netflix.mediaclient",
            "com.google.android.youtube", "com.google.android.apps.youtube.music",
            "com.google.android.apps.photos", "com.google.android.gm",
            "com.google.android.apps.maps", "com.google.android.videos",
            "com.google.android.apps.tachyon", "com.google.android.apps.docs",
            "com.google.android.music", "com.google.android.apps.subscriptions.red",
            "com.google.android.apps.googleassistant", "com.google.android.googlequicksearchbox",
            "com.google.android.apps.wellbeing", "com.google.android.feedback"));

    private Duo() {}

    static SharedPreferences prefs(Context c) {
        return c.getSharedPreferences("duo", Context.MODE_PRIVATE);
    }

    static ComponentName admin(Context c) {
        return new ComponentName(c, AdminReceiver.class);
    }

    static DevicePolicyManager dpm(Context c) {
        return (DevicePolicyManager) c.getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    static boolean isOwner(Context c) {
        return dpm(c).isDeviceOwnerApp(c.getPackageName());
    }

    static boolean isActive(Context c) {
        return prefs(c).getBoolean("active", false);
    }

    static String app(Context c, int n) {
        return prefs(c).getString(n == 1 ? "appA" : "appB", null);
    }

    static boolean inLockTask(Context c) {
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        return am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE;
    }

    static CharSequence label(Context c, String pkg) {
        if (pkg == null) return "(aucune)";
        PackageManager pm = c.getPackageManager();
        try {
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0));
        } catch (PackageManager.NameNotFoundException e) {
            return pkg;
        }
    }

    /** Ouvre l'app (ou la ramène au premier plan dans l'état où on l'a laissée). */
    static void launch(Context c, String pkg) {
        Intent i = c.getPackageManager().getLaunchIntentForPackage(pkg);
        if (i == null) return;
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        c.startActivity(i);
        prefs(c).edit().putString("current", pkg).apply();
    }

    /** Bascule vers l'autre app que celle affichée. */
    static void toggle(Context c) {
        String a = app(c, 1), b = app(c, 2);
        launch(c, a.equals(prefs(c).getString("current", HOME)) ? b : a);
    }

    static void enter(Activity a) {
        SharedPreferences p = prefs(a);
        String self = a.getPackageName(), appA = app(a, 1), appB = app(a, 2);
        if (isOwner(a)) {
            DevicePolicyManager dpm = dpm(a);
            ComponentName adm = admin(a);
            dpm.setLockTaskPackages(adm, new String[]{self, appA, appB});
            // Pas de barre de notifications, pas de bouton Accueil ni Récents.
            // On garde le menu du bouton marche/arrêt et l'heure/batterie.
            dpm.setLockTaskFeatures(adm, DevicePolicyManager.LOCK_TASK_FEATURE_GLOBAL_ACTIONS
                    | DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO);
            IntentFilter home = new IntentFilter(Intent.ACTION_MAIN);
            home.addCategory(Intent.CATEGORY_HOME);
            home.addCategory(Intent.CATEGORY_DEFAULT);
            dpm.addPersistentPreferredActivity(adm, home, new ComponentName(a, MainActivity.class));
            if (p.getBoolean("stayOn", true)) {
                dpm.setGlobalSetting(adm, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "7");
                p.edit().putBoolean("stayOnApplied", true).apply();
            }
            if (p.getBoolean("cut", true)) hideOthers(a);
        }
        killOthers(a);
        p.edit().putBoolean("active", true).putString("current", HOME).apply();
        resume(a);
        launch(a, appA);
    }

    /** Remet le verrouillage et le bouton flottant (au démarrage du téléphone par exemple). */
    static void resume(Activity a) {
        if (isOwner(a) && !inLockTask(a)) a.startLockTask();
        a.startService(new Intent(a, ToggleService.class));
    }

    static void exit(Activity a) {
        if (isOwner(a) && inLockTask(a)) a.stopLockTask();
        exit((Context) a);
    }

    /** Sans activité (sortie de secours par adb) : vider la liste suffit à sortir du verrouillage. */
    static void exit(Context a) {
        SharedPreferences p = prefs(a);
        a.stopService(new Intent(a, ToggleService.class));
        if (isOwner(a)) {
            DevicePolicyManager dpm = dpm(a);
            ComponentName adm = admin(a);
            dpm.setLockTaskPackages(adm, new String[0]);
            dpm.clearPackagePersistentPreferredActivities(adm, a.getPackageName());
            if (p.getBoolean("stayOnApplied", false)) {
                dpm.setGlobalSetting(adm, Settings.Global.STAY_ON_WHILE_PLUGGED_IN, "0");
                p.edit().remove("stayOnApplied").apply();
            }
            unhideAll(a);
        }
        p.edit().putBoolean("active", false).apply();
    }

    /** Masque les autres apps : elles ne peuvent plus tourner du tout. Réversible. */
    private static void hideOthers(Context c) {
        DevicePolicyManager dpm = dpm(c);
        ComponentName adm = admin(c);
        Set<String> keep = keep(c);
        Set<String> hidden = new HashSet<>(prefs(c).getStringSet("hidden", new HashSet<String>()));
        for (ApplicationInfo ai : installed(c)) {
            boolean system = (ai.flags & ApplicationInfo.FLAG_SYSTEM) != 0;
            if (keep.contains(ai.packageName)) continue;
            if (system && !SAFE_SYSTEM.contains(ai.packageName)) continue;
            try {
                if (dpm.setApplicationHidden(adm, ai.packageName, true)) hidden.add(ai.packageName);
            } catch (SecurityException ignored) {
                // App protégée par le système : on la laisse.
            }
        }
        prefs(c).edit().putStringSet("hidden", hidden).apply();
    }

    private static void unhideAll(Context c) {
        DevicePolicyManager dpm = dpm(c);
        ComponentName adm = admin(c);
        for (String pkg : prefs(c).getStringSet("hidden", new HashSet<String>())) {
            try {
                dpm.setApplicationHidden(adm, pkg, false);
            } catch (SecurityException ignored) {
            }
        }
        prefs(c).edit().remove("hidden").apply();
    }

    /** Demande à Android de fermer les processus en arrière-plan de toutes les autres apps. */
    static int killOthers(Context c) {
        ActivityManager am = (ActivityManager) c.getSystemService(Context.ACTIVITY_SERVICE);
        Set<String> keep = keep(c);
        int n = 0;
        for (ApplicationInfo ai : installed(c)) {
            if (keep.contains(ai.packageName)) continue;
            am.killBackgroundProcesses(ai.packageName);
            n++;
        }
        return n;
    }

    /** Ce qu'on ne touche jamais : Duo, les deux apps choisies et le clavier. */
    private static Set<String> keep(Context c) {
        Set<String> keep = new HashSet<>();
        keep.add(c.getPackageName());
        if (app(c, 1) != null) keep.add(app(c, 1));
        if (app(c, 2) != null) keep.add(app(c, 2));
        String ime = Settings.Secure.getString(c.getContentResolver(),
                Settings.Secure.DEFAULT_INPUT_METHOD);
        if (ime != null) keep.add(ime.split("/")[0]);
        return keep;
    }

    private static List<ApplicationInfo> installed(Context c) {
        return c.getPackageManager().getInstalledApplications(0);
    }
}
