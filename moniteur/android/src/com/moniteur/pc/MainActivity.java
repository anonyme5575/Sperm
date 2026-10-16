package com.moniteur.pc;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.util.List;

/**
 * Trouve le PC sur le Wi-Fi (ou par le câble USB), puis affiche sa page en plein écran.
 * Bouton Retour : changer de PC ou quitter.
 */
public class MainActivity extends Activity {
    private static final int BG = 0xFF121211, CARD = 0xFF232321, TEXT = 0xFFF2F1EC,
            MUTED = 0xFFB9B7AE, BLUE = 0xFF4F8FE6;

    private final Handler ui = new Handler(Looper.getMainLooper());
    private WebView web;
    private LinearLayout panel;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        getWindow().setStatusBarColor(BG);
        getWindow().setNavigationBarColor(BG);
        String host = Pc.host(this);
        if (host != null) tryHost(host);
        else search();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) immersive();
    }

    private void immersive() {
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN);
    }

    // ------------------------------------------------------------ connexion

    private void tryHost(final String host) {
        showPanel("Connexion à " + Pc.name(this) + "…", true);
        new Thread(new Runnable() {
            @Override
            public void run() {
                final boolean ok = Pc.reachable(host);
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (ok) open(host);
                        else search();
                    }
                });
            }
        }).start();
    }

    private void search() {
        showPanel("Recherche du PC…", true);
        new Thread(new Runnable() {
            @Override
            public void run() {
                final List<Pc.Found> found = Pc.discover();
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        if (found.size() == 1) {
                            Pc.save(MainActivity.this, found.get(0).host, found.get(0).name);
                            open(found.get(0).host);
                        } else if (found.isEmpty()) {
                            notFound();
                        } else {
                            choose(found);
                        }
                    }
                });
            }
        }).start();
    }

    private void open(String host) {
        startForegroundService(new Intent(this, WatchService.class));
        web = new WebView(this);
        web.setBackgroundColor(BG);
        WebSettings ws = web.getSettings();
        ws.setJavaScriptEnabled(true);
        ws.setDomStorageEnabled(true);
        ws.setMediaPlaybackRequiresUserGesture(false);
        ws.setCacheMode(WebSettings.LOAD_NO_CACHE);
        // La page reconnaît l'app et adapte son onglet Alertes.
        ws.setUserAgentString(ws.getUserAgentString() + " MoniteurPCApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, WebResourceRequest req, WebResourceError err) {
                if (req.isForMainFrame()) search();
            }
        });
        web.loadUrl("http://" + host + "/");
        setContentView(web);
        immersive();
    }

    // ------------------------------------------------------------ écrans

    private void showPanel(String title, boolean spinner) {
        if (web != null) {
            web.destroy();
            web = null;
        }
        getWindow().getDecorView().setSystemUiVisibility(0);
        panel = new LinearLayout(this);
        panel.setOrientation(LinearLayout.VERTICAL);
        panel.setGravity(Gravity.CENTER_HORIZONTAL);
        panel.setBackgroundColor(BG);
        int pad = dp(24);
        panel.setPadding(pad, dp(80), pad, pad);
        TextView t = text(title, 22, TEXT);
        t.setGravity(Gravity.CENTER);
        panel.addView(t);
        if (spinner) {
            ProgressBar pb = new ProgressBar(this);
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(dp(48), dp(48));
            lp.topMargin = dp(24);
            panel.addView(pb, lp);
        }
        setContentView(panel);
    }

    private void notFound() {
        showPanel("PC introuvable", false);
        add(text("Vérifie que :\n\n• Moniteur PC tourne sur le PC (icône près de l'horloge) ;\n"
                + "• le téléphone est sur le même Wi-Fi que le PC.\n\n"
                + "Par câble USB, lance sur le PC : adb reverse tcp:8790 tcp:8790", 15, MUTED), 24);
        add(button("Réessayer", BLUE, new View.OnClickListener() {
            @Override
            public void onClick(View v) { search(); }
        }), 24);
        add(button("Entrer l'adresse du PC", CARD, new View.OnClickListener() {
            @Override
            public void onClick(View v) { manual(); }
        }), 12);
    }

    private void choose(final List<Pc.Found> found) {
        showPanel("Plusieurs PC trouvés", false);
        for (final Pc.Found f : found) {
            add(button(f.name + "  ·  " + f.host, CARD, new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    Pc.save(MainActivity.this, f.host, f.name);
                    open(f.host);
                }
            }), 12);
        }
    }

    private void manual() {
        final EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setHint("192.168.1.20");
        String h = Pc.host(this);
        if (h != null) input.setText(h);
        new AlertDialog.Builder(this)
                .setTitle("Adresse du PC")
                .setMessage("Elle s'affiche dans le menu de l'icône Moniteur PC, près de l'horloge du PC.")
                .setView(input)
                .setPositiveButton("Se connecter", new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int w) {
                        String host = Pc.normalize(input.getText().toString());
                        Pc.save(MainActivity.this, host, host);
                        tryHost(host);
                    }
                })
                .setNegativeButton("Annuler", null)
                .show();
    }

    @Override
    public void onBackPressed() {
        new AlertDialog.Builder(this)
                .setItems(new CharSequence[]{"Chercher un autre PC", "Entrer l'adresse du PC",
                        "Arrêter la surveillance et quitter"}, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface d, int which) {
                        if (which == 0) search();
                        else if (which == 1) manual();
                        else {
                            stopService(new Intent(MainActivity.this, WatchService.class));
                            finish();
                        }
                    }
                })
                .show();
    }

    @Override
    protected void onDestroy() {
        if (web != null) web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------ petits outils

    private TextView text(String s, int sp, int color) {
        TextView t = new TextView(this);
        t.setText(s);
        t.setTextSize(sp);
        t.setTextColor(color);
        return t;
    }

    private Button button(String label, int color, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(16);
        b.setTextColor(color == CARD ? TEXT : Color.WHITE);
        GradientDrawable bg = new GradientDrawable();
        bg.setColor(color);
        bg.setCornerRadius(dp(12));
        b.setBackground(bg);
        b.setPadding(dp(16), dp(14), dp(16), dp(14));
        b.setOnClickListener(click);
        return b;
    }

    private void add(View v, int topDp) {
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT);
        lp.topMargin = dp(topDp);
        panel.addView(v, lp);
    }

    private int dp(int v) {
        return Math.round(v * getResources().getDisplayMetrics().density);
    }
}
