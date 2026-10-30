package com.blocs;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import android.util.Base64;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;

// Affiche le jeu (assets/index.html) en plein écran, hors ligne.
public class MainActivity extends Activity {
    private WebView web;
    private ValueCallback<Uri[]> pick;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                pick = cb;
                startActivityForResult(p.createIntent(), 1);
                return true;
            }
        });
        web.addJavascriptInterface(new Net(), "Android");
        setContentView(web);
        if (b != null) web.restoreState(b);
        else web.loadUrl("file:///android_asset/index.html");
    }

    // Télécharge un fichier pour la page (contourne le blocage CORS). Renvoie du base64, ou null.
    static class Net {
        @JavascriptInterface
        public String get(String url) {
            try {
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                for (int n; (n = in.read(buf)) > 0; ) {
                    out.write(buf, 0, n);
                    if (out.size() > 30 << 20) return null;
                }
                in.close();
                return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP);
            } catch (Exception e) {
                return null;
            }
        }
    }

    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        if (pick != null) pick.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
        pick = null;
    }

    @Override
    protected void onSaveInstanceState(Bundle b) { web.saveState(b); }

    @Override
    public void onBackPressed() { if (web.canGoBack()) web.goBack(); else super.onBackPressed(); }
}
