package fr.nettoyeur;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.WebView;
import android.widget.BaseAdapter;
import android.widget.Button;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;
import android.widget.Toast;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import rikka.shizuku.Shizuku;

public class MainActivity extends Activity {
    private static final String SHIZUKU = "moe.shizuku.privileged.api";
    private static final int ONGLET_CONSEILLEES = 0, ONGLET_TOUTES = 1, ONGLET_SUPPRIMEES = 2;

    static final class App {
        String paquet, nom;
        Drawable icone;
        int niveau;
        boolean supprimee;
    }

    private final ExecutorService fond = Executors.newSingleThreadExecutor();
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final List<App> toutes = new ArrayList<>();
    private final List<App> visibles = new ArrayList<>();
    private int onglet = ONGLET_CONSEILLEES;
    private boolean occupe;

    private TextView etat;
    private Button action, toutSupprimer;
    private final Button[] onglets = new Button[3];
    private BaseAdapter adaptateur;

    private final Shizuku.OnRequestPermissionResultListener permission = (code, r) -> majEtat();
    private final Shizuku.OnBinderReceivedListener connecte = this::majEtat;
    private final Shizuku.OnBinderDeadListener deconnecte = this::majEtat;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int pad = dp(12);
        LinearLayout racine = new LinearLayout(this);
        racine.setOrientation(LinearLayout.VERTICAL);
        racine.setPadding(pad, pad, pad, 0);

        etat = new TextView(this);
        etat.setTextSize(16);
        etat.setPadding(pad, pad, pad, pad);
        racine.addView(etat);
        action = new Button(this);
        racine.addView(action);

        LinearLayout barre = new LinearLayout(this);
        String[] titres = {"Conseillées", "Toutes", "Supprimées"};
        for (int i = 0; i < 3; i++) {
            final int n = i;
            onglets[i] = new Button(this);
            onglets[i].setText(titres[i]);
            onglets[i].setOnClickListener(v -> { onglet = n; filtrer(); });
            barre.addView(onglets[i], new LinearLayout.LayoutParams(0, -2, 1));
        }
        racine.addView(barre);

        toutSupprimer = new Button(this);
        toutSupprimer.setOnClickListener(v -> confirmerToutes());
        racine.addView(toutSupprimer);

        ListView liste = new ListView(this);
        adaptateur = new Adaptateur();
        liste.setAdapter(adaptateur);
        liste.setOnItemClickListener((p, v, pos, id) -> choisir(visibles.get(pos)));
        racine.addView(liste, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(racine);

        Shizuku.addRequestPermissionResultListener(permission);
        Shizuku.addBinderReceivedListenerSticky(connecte);
        Shizuku.addBinderDeadListener(deconnecte);
    }

    @Override
    protected void onResume() {
        super.onResume();
        majEtat();
        charger();
    }

    @Override
    protected void onDestroy() {
        Shizuku.removeRequestPermissionResultListener(permission);
        Shizuku.removeBinderReceivedListener(connecte);
        Shizuku.removeBinderDeadListener(deconnecte);
        fond.shutdown();
        super.onDestroy();
    }

    // ---- Shizuku : les trois étapes, expliquées simplement ----

    private boolean pret() {
        try {
            return Shizuku.pingBinder()
                    && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED;
        } catch (Throwable t) {
            return false;
        }
    }

    private void majEtat() {
        ui.post(() -> {
            if (pret()) {
                etat.setText("✅ Prêt. Touchez une app pour la supprimer ou la remettre.");
                etat.setBackgroundColor(0xFFE8F5E9);
                action.setVisibility(View.GONE);
                return;
            }
            etat.setBackgroundColor(0xFFFFF3E0);
            action.setVisibility(View.VISIBLE);
            if (!installee(SHIZUKU)) {
                etat.setText("Étape 1 sur 3\n\nAndroid interdit aux apps de supprimer les apps du "
                        + "fabricant. L'app gratuite « Shizuku » lève cette limite en toute sécurité. "
                        + "Installez-la d'abord.");
                action.setText("Installer Shizuku");
                action.setOnClickListener(v -> ouvrir("market://details?id=" + SHIZUKU,
                        "https://play.google.com/store/apps/details?id=" + SHIZUKU));
            } else if (!Shizuku.pingBinder()) {
                etat.setText("Étape 2 sur 3\n\nOuvrez Shizuku et touchez « Démarrer » en suivant "
                        + "ses explications (débogage sans fil). À refaire après chaque redémarrage "
                        + "du téléphone.\n\nRevenez ensuite ici.");
                action.setText("Ouvrir Shizuku");
                action.setOnClickListener(v -> {
                    Intent i = getPackageManager().getLaunchIntentForPackage(SHIZUKU);
                    if (i != null) startActivity(i);
                });
            } else {
                etat.setText("Étape 3 sur 3\n\nAutorisez Nettoyeur à utiliser Shizuku.");
                action.setText("Autoriser");
                action.setOnClickListener(v -> Shizuku.requestPermission(1));
            }
        });
    }

    private boolean installee(String paquet) {
        try {
            getPackageManager().getPackageInfo(paquet, 0);
            return true;
        } catch (PackageManager.NameNotFoundException e) {
            return false;
        }
    }

    private void ouvrir(String lien, String secours) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(lien)));
        } catch (Exception e) {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(secours)));
        }
    }

    // ---- Liste des apps système ----

    /** Ce qui ne doit jamais partir sur CE téléphone : l'écran d'accueil et le clavier utilisés. */
    private Set<String> protegeesIci() {
        Set<String> s = new HashSet<>();
        s.add(getPackageName());
        s.add(SHIZUKU);
        ResolveInfo accueil = getPackageManager().resolveActivity(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                PackageManager.MATCH_DEFAULT_ONLY);
        if (accueil != null && accueil.activityInfo != null) s.add(accueil.activityInfo.packageName);
        String clavier = Settings.Secure.getString(getContentResolver(),
                Settings.Secure.DEFAULT_INPUT_METHOD);
        if (clavier != null && clavier.contains("/")) s.add(clavier.substring(0, clavier.indexOf('/')));
        if (Build.VERSION.SDK_INT >= 26 && WebView.getCurrentWebViewPackage() != null) {
            s.add(WebView.getCurrentWebViewPackage().packageName);
        }
        return s;
    }

    private void charger() {
        fond.execute(() -> {
            PackageManager pm = getPackageManager();
            Set<String> protegees = protegeesIci();
            List<App> res = new ArrayList<>();
            for (ApplicationInfo ai : pm.getInstalledApplications(PackageManager.MATCH_UNINSTALLED_PACKAGES)) {
                if ((ai.flags & ApplicationInfo.FLAG_SYSTEM) == 0) continue;
                App a = new App();
                a.paquet = ai.packageName;
                a.nom = String.valueOf(ai.loadLabel(pm));
                a.icone = ai.loadIcon(pm);
                a.niveau = Regles.niveau(a.paquet, protegees);
                a.supprimee = (ai.flags & ApplicationInfo.FLAG_INSTALLED) == 0;
                res.add(a);
            }
            Collections.sort(res, (x, y) -> x.nom.compareToIgnoreCase(y.nom));
            ui.post(() -> { toutes.clear(); toutes.addAll(res); filtrer(); });
        });
    }

    private void filtrer() {
        visibles.clear();
        for (App a : toutes) {
            if (onglet == ONGLET_SUPPRIMEES ? a.supprimee
                    : !a.supprimee && (onglet == ONGLET_TOUTES || a.niveau == Regles.CONSEILLEE)) {
                visibles.add(a);
            }
        }
        for (int i = 0; i < 3; i++) onglets[i].setTypeface(null, i == onglet ? Typeface.BOLD : Typeface.NORMAL);
        toutSupprimer.setVisibility(onglet == ONGLET_CONSEILLEES && !visibles.isEmpty() ? View.VISIBLE : View.GONE);
        toutSupprimer.setText("Supprimer les " + visibles.size() + " apps conseillées");
        adaptateur.notifyDataSetChanged();
    }

    private class Adaptateur extends BaseAdapter {
        public int getCount() { return visibles.size(); }
        public Object getItem(int i) { return visibles.get(i); }
        public long getItemId(int i) { return i; }

        public View getView(int i, View v, ViewGroup parent) {
            LinearLayout ligne = (LinearLayout) v;
            if (ligne == null) {
                ligne = new LinearLayout(MainActivity.this);
                ligne.setGravity(Gravity.CENTER_VERTICAL);
                ligne.setPadding(dp(8), dp(10), dp(8), dp(10));
                ImageView ic = new ImageView(MainActivity.this);
                ligne.addView(ic, new LinearLayout.LayoutParams(dp(40), dp(40)));
                TextView t = new TextView(MainActivity.this);
                t.setPadding(dp(12), 0, 0, 0);
                t.setTextSize(15);
                ligne.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
            }
            App a = visibles.get(i);
            ((ImageView) ligne.getChildAt(0)).setImageDrawable(a.icone);
            TextView t = (TextView) ligne.getChildAt(1);
            String sous;
            int couleur;
            if (a.supprimee) { sous = "Supprimée · touchez pour la remettre"; couleur = Color.GRAY; }
            else if (a.niveau == Regles.PROTEGEE) { sous = "🔒 Indispensable, ne peut pas être supprimée"; couleur = 0xFF757575; }
            else if (a.niveau == Regles.CONSEILLEE) { sous = "✅ Sans risque · " + Regles.raison(a.paquet); couleur = 0xFF2E7D32; }
            else { sous = "⚠️ Inconnue · à éviter si vous n'êtes pas sûr"; couleur = 0xFFE65100; }
            t.setTextColor(a.niveau == Regles.PROTEGEE ? Color.GRAY : Color.BLACK);
            android.text.SpannableString s = new android.text.SpannableString(a.nom + "\n" + sous);
            s.setSpan(new android.text.style.ForegroundColorSpan(couleur), a.nom.length() + 1, s.length(), 0);
            s.setSpan(new android.text.style.RelativeSizeSpan(0.85f), a.nom.length() + 1, s.length(), 0);
            t.setText(s);
            return ligne;
        }
    }

    // ---- Confirmations ----

    private void choisir(App a) {
        if (occupe) return;
        if (!pret()) { toast("Terminez d'abord les étapes en haut de l'écran."); return; }
        if (a.supprimee) {
            dialogue("Remettre « " + a.nom + " » ?", "L'app revient telle qu'elle était.",
                    "Remettre", () -> executer(Collections.singletonList(a), false));
        } else if (a.niveau == Regles.PROTEGEE) {
            new AlertDialog.Builder(this).setTitle(a.nom)
                    .setMessage("Cette app est indispensable au bon fonctionnement du téléphone "
                            + "(appels, écran, sécurité ou mises à jour). Nettoyeur refuse de la supprimer.")
                    .setPositiveButton("Compris", null).show();
        } else if (a.niveau == Regles.CONSEILLEE) {
            dialogue("Supprimer « " + a.nom + " » ?", Regles.raison(a.paquet) + ". Sa suppression "
                    + "est sans risque.\n\nVous pourrez la remettre à tout moment depuis l'onglet "
                    + "« Supprimées ».", "Supprimer", () -> executer(Collections.singletonList(a), true));
        } else {
            dialogue("⚠️ Attention", "Nous ne savons pas à quoi sert « " + a.nom + " ». La supprimer "
                    + "peut empêcher une fonction du téléphone de marcher.\n\nSi un problème "
                    + "apparaît, remettez-la depuis l'onglet « Supprimées ».", "Je comprends, continuer",
                    () -> dialogue("Dernière confirmation", "Supprimer vraiment « " + a.nom + " » ?\n("
                            + a.paquet + ")", "Supprimer", () -> executer(Collections.singletonList(a), true)));
        }
    }

    private void confirmerToutes() {
        if (!pret()) { toast("Terminez d'abord les étapes en haut de l'écran."); return; }
        List<App> lot = new ArrayList<>(visibles);
        StringBuilder noms = new StringBuilder();
        for (App a : lot) noms.append("• ").append(a.nom).append('\n');
        dialogue("Supprimer " + lot.size() + " apps ?", noms + "\nToutes sont sans risque et "
                + "pourront être remises depuis l'onglet « Supprimées ».", "Supprimer",
                () -> executer(lot, true));
    }

    private void dialogue(String titre, String texte, String oui, Runnable si) {
        new AlertDialog.Builder(this).setTitle(titre).setMessage(texte)
                .setPositiveButton(oui, (d, w) -> si.run()).setNegativeButton("Annuler", null).show();
    }

    // ---- Exécution ----

    private void executer(List<App> lot, boolean supprimer) {
        occupe = true;
        Set<String> protegees = protegeesIci();
        fond.execute(() -> {
            int ok = 0;
            String erreur = null;
            for (App a : lot) {
                // Revérifié ici : aucune app protégée ne peut partir, quel que soit le chemin suivi.
                if (supprimer && Regles.niveau(a.paquet, protegees) == Regles.PROTEGEE) continue;
                if (!Regles.NOM.matcher(a.paquet).matches()) continue;
                String sortie = commande(supprimer
                        ? new String[] {"pm", "uninstall", "-k", "--user", "0", a.paquet}
                        : new String[] {"cmd", "package", "install-existing", a.paquet});
                boolean reussi = supprimer ? sortie.contains("Success") : sortie.contains("installed for user");
                if (reussi) ok++;
                else { erreur = a.nom + " : " + sortie.trim(); break; }
            }
            final int n = ok;
            final String e = erreur;
            ui.post(() -> {
                occupe = false;
                if (e != null) {
                    new AlertDialog.Builder(this).setTitle("Opération arrêtée")
                            .setMessage((n > 0 ? n + " app(s) traitée(s), puis Android a refusé :\n\n" : "Android a refusé :\n\n") + e)
                            .setPositiveButton("OK", null).show();
                } else {
                    toast(supprimer ? n + " app(s) supprimée(s)" : "App remise");
                }
                charger();
            });
        });
    }

    /** Lance une commande avec les droits d'ADB via Shizuku (arguments séparés, sans shell). */
    private String commande(String[] args) {
        try {
            Method m = Shizuku.class.getDeclaredMethod("newProcess", String[].class, String[].class, String.class);
            m.setAccessible(true);
            Process p = (Process) m.invoke(null, args, null, null);
            StringBuilder sb = new StringBuilder();
            for (java.io.InputStream in : new java.io.InputStream[] {p.getInputStream(), p.getErrorStream()}) {
                BufferedReader r = new BufferedReader(new InputStreamReader(in));
                for (String l; (l = r.readLine()) != null; ) sb.append(l).append('\n');
            }
            p.waitFor();
            return sb.toString();
        } catch (Throwable t) {
            return "erreur : " + t;
        }
    }

    private void toast(String s) { Toast.makeText(this, s, Toast.LENGTH_LONG).show(); }

    private int dp(int v) { return Math.round(v * getResources().getDisplayMetrics().density); }
}
