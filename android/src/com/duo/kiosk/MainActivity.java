package com.duo.kiosk;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.provider.Settings;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.CheckBox;
import android.widget.CompoundButton;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;

import java.util.Collections;
import java.util.Comparator;
import java.util.List;

/** Réglages (hors mode Duo) et écran d'accueil verrouillé (en mode Duo). */
public class MainActivity extends Activity {
    private static final int BG = 0xFF0B0F17, CARD = 0xFF111827, TEXT = 0xFFE5E7EB,
            MUTED = 0xFF94A3B8, BLUE = 0xFF3B82F6, GREEN = 0xFF22C55E, RED = 0xFFEF4444;

    private LinearLayout root;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        ScrollView scroll = new ScrollView(this);
        scroll.setBackgroundColor(BG);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        int pad = dp(16);
        root.setPadding(pad, pad, pad, pad);
        scroll.addView(root);
        setContentView(scroll);
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (Duo.isActive(this)) {
            Duo.prefs(this).edit().putString("current", Duo.HOME).apply();
            // Après un redémarrage, le téléphone revient ici : on remet le verrouillage.
            if (!Duo.inLockTask(this) && Duo.isOwner(this)) Duo.resume(this);
            else startService(new Intent(this, ToggleService.class));
            showKioskHome();
        } else {
            showSetup();
        }
    }

    @Override
    public void onBackPressed() {
        if (!Duo.isActive(this)) super.onBackPressed();
    }

    // ------------------------------------------------------------ mode Duo

    private void showKioskHome() {
        root.removeAllViews();
        title("Duo");
        note("Touche une app pour l'ouvrir. Ensuite, le bouton rond bascule d'une app à l'autre. "
                + "Appui long sur le bouton rond : retour ici.");
        for (int n = 1; n <= 2; n++) {
            final String pkg = Duo.app(this, n);
            LinearLayout tile = new LinearLayout(this);
            tile.setOrientation(LinearLayout.HORIZONTAL);
            tile.setGravity(Gravity.CENTER_VERTICAL);
            tile.setPadding(dp(16), dp(16), dp(16), dp(16));
            tile.setBackground(rounded(CARD));
            ImageView icon = new ImageView(this);
            try {
                icon.setImageDrawable(getPackageManager().getApplicationIcon(pkg));
            } catch (PackageManager.NameNotFoundException ignored) {
            }
            tile.addView(icon, new LinearLayout.LayoutParams(dp(56), dp(56)));
            TextView name = text(Duo.label(this, pkg), 22, TEXT);
            name.setPadding(dp(16), 0, 0, 0);
            tile.addView(name);
            tile.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Duo.launch(MainActivity.this, pkg);
                }
            });
            add(tile, 12);
        }
        button("Fermer les apps en arrière-plan", CARD, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                int n = Duo.killOthers(MainActivity.this);
                toast(n + " apps fermées");
            }
        });
        button("Sortir de Duo", RED, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                askPinThenExit();
            }
        });
    }

    private void askPinThenExit() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        new AlertDialog.Builder(this)
                .setTitle("Code PIN")
                .setView(input)
                .setPositiveButton("Valider", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        if (input.getText().toString().equals(Duo.prefs(MainActivity.this).getString("pin", ""))) {
                            chooseExit();
                        } else {
                            toast("Code incorrect");
                        }
                    }
                })
                .setNegativeButton("Annuler", null)
                .show();
    }

    private void chooseExit() {
        new AlertDialog.Builder(this)
                .setTitle("Sortir de Duo")
                .setMessage("Sortir seulement : le téléphone est déverrouillé, tu pourras relancer Duo "
                        + "d'un toucher.\n\nRendre le téléphone normal : tout est remis comme avant, "
                        + "Duo perd ses droits. Pour le relancer, il faudra refaire la commande adb.")
                .setPositiveButton("Rendre normal", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        Duo.makeNormal(MainActivity.this);
                        toast("Téléphone remis à la normale");
                        showSetup();
                    }
                })
                .setNeutralButton("Sortir seulement", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        Duo.exit(MainActivity.this);
                        showSetup();
                    }
                })
                .setNegativeButton("Annuler", null)
                .show();
    }

    // ------------------------------------------------------------ réglages

    private void showSetup() {
        root.removeAllViews();
        final SharedPreferences p = Duo.prefs(this);
        final boolean owner = Duo.isOwner(this);
        title("Duo");
        note("Verrouille le téléphone sur deux apps, coupe tout le reste, "
                + "et ajoute un bouton rond pour basculer de l'une à l'autre d'un toucher.");

        TextView status = text(owner
                ? "✓ Propriétaire de l'appareil : verrouillage complet disponible."
                : "✗ Pas propriétaire de l'appareil : le bouton de bascule marche, mais le "
                + "téléphone ne sera pas verrouillé et les autres apps ne seront pas coupées. "
                + "Voir le README (commande adb à lancer une seule fois depuis le PC).", 14, owner ? GREEN : RED);
        add(status, 16);

        for (int n = 1; n <= 2; n++) {
            final int which = n;
            button("App " + n + " : " + Duo.label(this, Duo.app(this, n)), CARD, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    pickApp(which);
                }
            });
        }

        add(text("Code PIN pour quitter le mode Duo (4 chiffres minimum)", 14, MUTED), 16);
        final EditText pin = new EditText(this);
        pin.setInputType(InputType.TYPE_CLASS_NUMBER | InputType.TYPE_NUMBER_VARIATION_PASSWORD);
        pin.setTextColor(TEXT);
        pin.setText(p.getString("pin", ""));
        add(pin, 4);

        if (owner) {
            checkbox("Couper toutes les autres apps (elles reviennent en quittant)", "cut");
            checkbox("Écran toujours allumé quand le téléphone charge", "stayOn");
        }

        final boolean overlay = Settings.canDrawOverlays(this);
        if (!overlay) {
            button("1. Autoriser le bouton rond (superposition)", BLUE, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:" + getPackageName())));
                }
            });
        }
        button("Autorisations MIUI : activer « Afficher les fenêtres pop-up en arrière-plan »", CARD,
                new View.OnClickListener() {
                    @Override
                    public void onClick(View v) {
                        openMiuiPermissions();
                    }
                });

        button("DÉMARRER LE MODE DUO", GREEN, new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                String code = pin.getText().toString();
                if (Duo.app(MainActivity.this, 1) == null || Duo.app(MainActivity.this, 2) == null) {
                    toast("Choisis les deux apps");
                } else if (Duo.app(MainActivity.this, 1).equals(Duo.app(MainActivity.this, 2))) {
                    toast("Choisis deux apps différentes");
                } else if (code.length() < 4) {
                    toast("PIN de 4 chiffres minimum");
                } else if (!Settings.canDrawOverlays(MainActivity.this)) {
                    toast("Autorise d'abord le bouton rond");
                } else {
                    p.edit().putString("pin", code).apply();
                    Duo.enter(MainActivity.this);
                }
            }
        });

        if (owner) {
            button("Rendre le téléphone normal (retire les droits de Duo)", RED,
                    new View.OnClickListener() {
                        @Override
                        public void onClick(View v) {
                            confirmRemoveOwner();
                        }
                    });
        }
    }

    private void pickApp(final int which) {
        PackageManager pm = getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        final List<ResolveInfo> apps = pm.queryIntentActivities(launcher, 0);
        for (int i = apps.size() - 1; i >= 0; i--) {
            if (apps.get(i).activityInfo.packageName.equals(getPackageName())) apps.remove(i);
        }
        final PackageManager fpm = pm;
        Collections.sort(apps, new Comparator<ResolveInfo>() {
            @Override
            public int compare(ResolveInfo x, ResolveInfo y) {
                return x.loadLabel(fpm).toString().compareToIgnoreCase(y.loadLabel(fpm).toString());
            }
        });
        CharSequence[] names = new CharSequence[apps.size()];
        for (int i = 0; i < names.length; i++) names[i] = apps.get(i).loadLabel(pm);
        new AlertDialog.Builder(this)
                .setTitle("App " + which)
                .setItems(names, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int i) {
                        Duo.prefs(MainActivity.this).edit()
                                .putString(which == 1 ? "appA" : "appB",
                                        apps.get(i).activityInfo.packageName)
                                .apply();
                        showSetup();
                    }
                })
                .show();
    }

    private void openMiuiPermissions() {
        Intent miui = new Intent("miui.intent.action.APP_PERM_EDITOR")
                .putExtra("extra_pkgname", getPackageName());
        try {
            startActivity(miui);
        } catch (Exception e) {
            startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.parse("package:" + getPackageName())));
        }
    }

    private void confirmRemoveOwner() {
        new AlertDialog.Builder(this)
                .setTitle("Rendre le téléphone normal ?")
                .setMessage("Duo redevient une app ordinaire, que tu peux désinstaller. Pour "
                        + "reverrouiller plus tard, il faudra relancer la commande adb depuis le PC.")
                .setPositiveButton("Rendre normal", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        Duo.makeNormal(MainActivity.this);
                        toast("Téléphone remis à la normale");
                        showSetup();
                    }
                })
                .setNegativeButton("Annuler", null)
                .show();
    }

    // ------------------------------------------------------------ petits outils d'interface

    private void title(String s) {
        TextView t = text(s, 28, TEXT);
        t.setTypeface(t.getTypeface(), android.graphics.Typeface.BOLD);
        add(t, 0);
    }

    private void note(String s) {
        add(text(s, 14, MUTED), 8);
    }

    private TextView text(CharSequence s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        return t;
    }

    private void button(String label, int color, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextColor(color == CARD ? TEXT : Color.WHITE);
        b.setTextSize(16);
        b.setBackground(rounded(color));
        b.setPadding(dp(16), dp(14), dp(16), dp(14));
        b.setOnClickListener(click);
        add(b, 12);
    }

    private void checkbox(String label, final String key) {
        CheckBox c = new CheckBox(this);
        c.setText(label);
        c.setTextColor(TEXT);
        c.setChecked(Duo.prefs(this).getBoolean(key, true));
        c.setOnCheckedChangeListener(new CompoundButton.OnCheckedChangeListener() {
            @Override
            public void onCheckedChanged(CompoundButton b, boolean on) {
                Duo.prefs(MainActivity.this).edit().putBoolean(key, on).apply();
            }
        });
        add(c, 8);
    }

    private GradientDrawable rounded(int color) {
        GradientDrawable d = new GradientDrawable();
        d.setColor(color);
        d.setCornerRadius(dp(14));
        return d;
    }

    private void add(View v, int topMarginDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(topMarginDp);
        root.addView(v, lp);
    }

    private void toast(String s) {
        Toast.makeText(this, s, Toast.LENGTH_SHORT).show();
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
