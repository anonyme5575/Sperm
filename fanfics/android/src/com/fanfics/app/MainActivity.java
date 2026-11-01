package com.fanfics.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

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
    private boolean ready;
    private volatile String inbox;      // texte partagé ou fichier importé, en attente pour la page
    private String inboxCallback = "__shared";
    private String pendingExport;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFF16141A);
        getWindow().setNavigationBarColor(0xFF16141A);

        web = new WebView(this);
        web.setBackgroundColor(0xFF16141A);
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
        setContentView(web);
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
                        : (code == 403 || code == 503) && body.contains("challenge")
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
