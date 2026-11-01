package com.fanfics.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.Charset;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Affiche l'interface web (assets/index.html) et lui donne ce qu'un navigateur refuse :
 * télécharger les pages des sites de fanfics, garder les données dans un fichier,
 * recevoir les liens partagés depuis une autre app, sauvegarder et restaurer.
 */
public class MainActivity extends Activity {
    private static final int REQ_EXPORT = 1, REQ_IMPORT = 2;
    private static final int MAX_BYTES = 6 * 1024 * 1024;
    private static final String UA = "Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 "
            + "(KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36 MesFanfics/1.0";

    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newFixedThreadPool(2);
    private final Map<String, String> results = new ConcurrentHashMap<>();
    private WebView web;
    private FrameLayout root;
    private boolean ready;
    private volatile String inbox;      // texte partagé ou fichier importé, en attente pour la page
    private String inboxCallback = "__shared";
    private String pendingExport;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF0A0910);
        getWindow().setNavigationBarColor(0xFF0A0910);

        web = new WebView(this);
        web.setBackgroundColor(0xFF0A0910);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebChromeClient(new WebChromeClient()); // nécessaire pour confirm()
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("file".equals(u.getScheme())) return false;
                openExternal(u.toString());
                return true;
            }
        });
        root = new FrameLayout(this);
        root.addView(web);
        setContentView(root);
        web.loadUrl("file:///android_asset/index.html");
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        handleIntent(intent);
    }

    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return;
        String text = intent.getStringExtra(Intent.EXTRA_TEXT);
        if (text == null) return;
        String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
        deliver(subject != null ? subject + "\n" + text : text, "__shared");
    }

    private void deliver(String text, String callback) {
        inbox = text;
        inboxCallback = callback;
        if (ready) web.evaluateJavascript("window." + callback + " && window." + callback + "()", null);
    }

    @Override
    public void onBackPressed() {
        if (bShown) { finishBrowser(error("Vérification annulée.")); return; }
        web.evaluateJavascript("window.__back ? window.__back() : false", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String v) {
                if (!"true".equals(v)) MainActivity.super.onBackPressed();
            }
        });
    }

    @Override
    protected void onDestroy() {
        pool.shutdownNow();
        super.onDestroy();
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, "Aucune app pour ouvrir ce lien", Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------ sauvegarde et restauration

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (res != RESULT_OK || data == null || data.getData() == null) return;
        Uri uri = data.getData();
        if (req == REQ_EXPORT && pendingExport != null) {
            try (OutputStream out = getContentResolver().openOutputStream(uri, "wt")) {
                out.write(pendingExport.getBytes(StandardCharsets.UTF_8));
                Toast.makeText(this, "Sauvegarde enregistrée", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Échec de la sauvegarde : " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
            pendingExport = null;
        } else if (req == REQ_IMPORT) {
            try (InputStream in = getContentResolver().openInputStream(uri)) {
                deliver(new String(readAll(in, 50 * 1024 * 1024), StandardCharsets.UTF_8), "__imported");
            } catch (Exception e) {
                Toast.makeText(this, "Lecture impossible : " + e.getMessage(), Toast.LENGTH_LONG).show();
            }
        }
    }

    private void js(final String code) {
        ui.post(new Runnable() { @Override public void run() { web.evaluateJavascript(code, null); } });
    }

    private File cacheDir() {
        File d = new File(getNoBackupFilesDir(), "cache"); // hors sauvegarde Google (limitée à 25 Mo)
        d.mkdirs();
        return d;
    }

    private File cacheFile(String key) {
        try {
            byte[] h = java.security.MessageDigest.getInstance("SHA-1").digest(key.getBytes(StandardCharsets.UTF_8));
            StringBuilder b = new StringBuilder();
            for (byte x : h) b.append(String.format("%02x", x));
            return new File(cacheDir(), b.toString());
        } catch (Exception e) {
            return new File(cacheDir(), Integer.toHexString(key.hashCode()));
        }
    }

    private File dataFile() {
        return new File(getFilesDir(), "fanfics.json");
    }

    // ------------------------------------------------------------ téléchargement

    private static byte[] readAll(InputStream in, int max) throws Exception {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] b = new byte[16384];
        int n;
        while ((n = in.read(b)) > 0) {
            buf.write(b, 0, n);
            if (buf.size() > max) break;
        }
        return buf.toByteArray();
    }

    private static final Pattern CHARSET = Pattern.compile("charset=\"?([\\w-]+)", Pattern.CASE_INSENSITIVE);

    /** Télécharge une page en suivant les redirections. Renvoie {ok, status, body, error}. */
    static JSONObject download(String address) throws Exception {
        JSONObject r = new JSONObject();
        String current = address;
        for (int hop = 0; hop < 6; hop++) {
            HttpURLConnection c = (HttpURLConnection) new URL(current).openConnection();
            c.setInstanceFollowRedirects(false);
            c.setConnectTimeout(15000);
            c.setReadTimeout(25000);
            c.setRequestProperty("User-Agent", UA);
            c.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8");
            c.setRequestProperty("Accept-Language", "fr-FR,fr;q=0.9,en;q=0.8");
            int code = c.getResponseCode();
            if (code >= 300 && code < 400 && c.getHeaderField("Location") != null) {
                current = new URL(new URL(current), c.getHeaderField("Location")).toString();
                c.disconnect();
                continue;
            }
            r.put("status", code);
            r.put("url", current);
            InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
            byte[] bytes = in == null ? new byte[0] : readAll(in, MAX_BYTES);
            c.disconnect();
            Charset cs = StandardCharsets.UTF_8;
            String type = c.getContentType();
            if (type != null) {
                Matcher m = CHARSET.matcher(type);
                if (m.find()) try { cs = Charset.forName(m.group(1)); } catch (Exception ignored) { }
            }
            String body = new String(bytes, cs);
            if (code >= 400) {
                r.put("ok", false);
                r.put("error", code == 429 ? "Le site demande de ralentir : réessaie dans quelques minutes."
                        : code == 404 ? "Page introuvable (supprimée ou lien erroné)."
                        : (code == 403 || code == 503) && (body.contains("challenge") || body.contains("Just a moment"))
                        ? "Le site bloque la lecture automatique (protection anti-robot)."
                        : "Le site a répondu " + code + ".");
                return r;
            }
            r.put("ok", true);
            r.put("body", body);
            return r;
        }
        r.put("ok", false);
        r.put("error", "Trop de redirections.");
        return r;
    }

    // ------------------------------------------------------------ navigateur intégré
    // Certains sites (FanFiction.net) ne s'affichent qu'à un vrai navigateur qui passe leur
    // vérification anti-robot. On charge donc la page dans une WebView placée derrière
    // l'interface, et on la montre seulement si la vérification demande de cocher une case.
    // Les cookies de vérification sont gardés : les fois suivantes, ça passe sans rien demander.

    /** Script qui dit où en est la page : OK (attendue), WAIT (vérification), MAINT, PAGE (autre). */
    private static String probe(String ready) {
        String sel = ready == null || ready.isEmpty() ? "#profile_top" : ready;
        return "(function(){var d=document;"
            + "if(d.querySelector(" + JSONObject.quote(sel) + ")&&d.readyState!=='loading')return 'OK'+d.documentElement.outerHTML;"
            + "var t=(d.title||'')+' '+(d.body?d.body.innerText.slice(0,3000):'');"
            + "if(/just a moment|un instant|verify you are human|v\u00e9rifi|checking your browser|cloudflare|ddos/i.test(t))return 'WAIT';"
            + "if(/maintenance/i.test(t))return 'MAINT';"
            + "if(d.readyState==='complete'&&d.body&&d.body.innerText.length>200)return 'PAGE'+d.documentElement.outerHTML;"
            + "return 'WAIT';})()";
    }

    private final ArrayDeque<String[]> bQueue = new ArrayDeque<>();
    private WebView browser;
    private LinearLayout browserBox;
    private View browserBar;
    private String bId;
    private String bProbe;
    private long bStart;
    private boolean bShown;

    private final Runnable poll = new Runnable() {
        @Override
        public void run() {
            if (bId == null) return;
            final String id = bId;
            browser.evaluateJavascript(bProbe, new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String v) {
                    if (!id.equals(bId)) return;
                    String r = "";
                    try { r = new JSONArray("[" + v + "]").optString(0, ""); } catch (Exception ignored) { }
                    long elapsed = SystemClock.uptimeMillis() - bStart;
                    try {
                        // PAGE = page chargée sans fiche d'histoire : on laisse quelques secondes
                        // à une éventuelle redirection avant de la rendre telle quelle.
                        if (r.startsWith("OK") || (r.startsWith("PAGE") && elapsed > 6000)) {
                            CookieManager.getInstance().flush();
                            JSONObject o = new JSONObject();
                            o.put("ok", true);
                            o.put("status", 200);
                            o.put("url", browser.getUrl());
                            o.put("body", r.substring(r.startsWith("OK") ? 2 : 4));
                            finishBrowser(o.toString());
                        } else if (r.equals("MAINT")) {
                            finishBrowser(error("Le site est en maintenance : réessaie plus tard."));
                        } else if (elapsed > 150000) {
                            finishBrowser(error("La vérification anti-robot n'a pas abouti."));
                        } else {
                            if (elapsed > 7000 && !bShown) showBrowser();
                            ui.postDelayed(poll, 1000);
                        }
                    } catch (Exception e) {
                        finishBrowser(error(e.getMessage()));
                    }
                }
            });
        }
    };

    private static String error(String msg) {
        return "{\"ok\":false,\"error\":" + JSONObject.quote(msg) + "}";
    }

    private void browserFetch(String id, String url, String ready) {
        bQueue.add(new String[]{id, url, ready});
        if (bId == null) nextBrowser();
    }

    private void nextBrowser() {
        String[] job = bQueue.poll();
        if (job == null) {
            bId = null;
            if (browser != null) browser.loadUrl("about:blank");
            return;
        }
        ensureBrowser();
        bId = job[0];
        bProbe = probe(job[2]);
        bStart = SystemClock.uptimeMillis();
        browser.loadUrl(job[1]);
        ui.postDelayed(poll, 1500);
    }

    private void finishBrowser(String json) {
        if (bId == null) return;
        ui.removeCallbacks(poll);
        results.put(bId, json);
        String id = bId;
        bId = null;
        hideBrowser();
        web.evaluateJavascript("window.__fetched(" + JSONObject.quote(id) + ")", null);
        nextBrowser();
    }

    private void ensureBrowser() {
        if (browser != null) return;
        browser = new WebView(this);
        WebSettings s = browser.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setUserAgentString(desktopUserAgent(s.getUserAgentString()));
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(browser, true);
        browser.setWebViewClient(new WebViewClient());

        browserBox = new LinearLayout(this);
        browserBox.setOrientation(LinearLayout.VERTICAL);
        browserBox.setBackgroundColor(0xFF0A0910);
        LinearLayout bar = new LinearLayout(this);
        bar.setGravity(Gravity.CENTER_VERTICAL);
        bar.setPadding(24, 16, 16, 16);
        bar.setBackgroundColor(0xFF2C2834);
        TextView msg = new TextView(this);
        msg.setTextColor(0xFFF1EEF5);
        msg.setText("Le site vérifie que tu n'es pas un robot. Si une case apparaît, coche-la : la fanfic sera ajoutée toute seule.");
        bar.addView(msg, new LinearLayout.LayoutParams(0, -2, 1));
        Button close = new Button(this);
        close.setText("Annuler");
        close.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) { finishBrowser(error("Vérification annulée.")); }
        });
        bar.addView(close);
        bar.setVisibility(View.GONE);
        browserBar = bar;
        browserBox.addView(bar, new LinearLayout.LayoutParams(-1, -2));
        browserBox.addView(browser, new LinearLayout.LayoutParams(-1, 0, 1));
        root.addView(browserBox, 0); // derrière l'interface : chargée et active, mais pas visible
    }

    /**
     * Ce que fait Chrome avec « Version pour ordinateur » : même version de Chrome, mais annoncé
     * comme un ordinateur. Sinon FanFiction.net renvoie vers m.fanfiction.net, mis en page autrement.
     */
    static String desktopUserAgent(String ua) {
        Matcher m = Pattern.compile("Chrome/[\\d.]+").matcher(ua);
        String chrome = m.find() ? m.group() : "Chrome/124.0.0.0";
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " + chrome + " Safari/537.36";
    }

    private void showBrowser() {
        bShown = true;
        browserBar.setVisibility(View.VISIBLE);
        browserBox.bringToFront();
    }

    private void hideBrowser() {
        if (!bShown) return;
        bShown = false;
        browserBar.setVisibility(View.GONE);
        web.bringToFront();
    }

    // ------------------------------------------------------------ pont JavaScript

    class Bridge {
        @JavascriptInterface
        public String load() {
            File f = dataFile();
            if (!f.exists()) return "";
            try (InputStream in = new java.io.FileInputStream(f)) {
                return new String(readAll(in, Integer.MAX_VALUE), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return "";
            }
        }

        /** Écrit d'abord dans un fichier temporaire : une coupure en pleine écriture ne perd rien. */
        @JavascriptInterface
        public synchronized void save(String json) {
            File tmp = new File(getFilesDir(), "fanfics.json.tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
                out.getFD().sync();
            } catch (Exception e) {
                return;
            }
            tmp.renameTo(dataFile());
        }

        @JavascriptInterface
        public void fetch(final String id, final String url) {
            pool.execute(new Runnable() { @Override public void run() {
                String out;
                try {
                    out = download(url).toString();
                } catch (Exception e) {
                    String msg = e instanceof java.net.UnknownHostException ? "Pas de connexion Internet."
                            : e instanceof java.net.SocketTimeoutException ? "Le site ne répond pas."
                            : "Erreur réseau : " + e.getMessage();
                    out = "{\"ok\":false,\"error\":" + JSONObject.quote(msg) + "}";
                }
                results.put(id, out);
                js("window.__fetched(" + JSONObject.quote(id) + ")");
            }});
        }

        /** Comme fetch, mais à travers le navigateur intégré (pages protégées contre les robots). */
        @JavascriptInterface
        public void fetchBrowser(final String id, final String url, final String ready) {
            ui.post(new Runnable() { @Override public void run() { browserFetch(id, url, ready); } });
        }

        // Chapitres et traductions déjà téléchargés : un fichier par clé dans files/cache.
        @JavascriptInterface
        public String cacheGet(String key) {
            File f = cacheFile(key);
            if (!f.exists()) return null;
            try (InputStream in = new java.io.FileInputStream(f)) {
                return new String(readAll(in, Integer.MAX_VALUE), StandardCharsets.UTF_8);
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public void cachePut(String key, String value) {
            File f = cacheFile(key);
            File tmp = new File(f.getPath() + ".tmp");
            try (FileOutputStream out = new FileOutputStream(tmp)) {
                out.write(value.getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                return;
            }
            tmp.renameTo(f);
        }

        @JavascriptInterface
        public void cacheClear() {
            File[] all = cacheDir().listFiles();
            if (all != null) for (File f : all) f.delete();
        }

        @JavascriptInterface
        public String take(String id) {
            String r = results.remove(id);
            return r == null ? "{\"ok\":false,\"error\":\"réponse perdue\"}" : r;
        }

        @JavascriptInterface
        public String takeShared() {
            String t = inbox;
            inbox = null;
            return t == null ? "" : t;
        }

        @JavascriptInterface
        public void ready() {
            ui.post(new Runnable() { @Override public void run() {
                ready = true;
                if (inbox != null) deliver(inbox, inboxCallback);
            }});
        }

        @JavascriptInterface
        public void open(final String url) {
            ui.post(new Runnable() { @Override public void run() { openExternal(url); } });
        }

        @JavascriptInterface
        public void exportFile(final String name, final String json) {
            ui.post(new Runnable() { @Override public void run() {
                pendingExport = json;
                Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("application/json");
                i.putExtra(Intent.EXTRA_TITLE, name);
                startActivityForResult(i, REQ_EXPORT);
            }});
        }

        @JavascriptInterface
        public void importFile() {
            ui.post(new Runnable() { @Override public void run() {
                Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                startActivityForResult(i, REQ_IMPORT);
            }});
        }
    }
}
