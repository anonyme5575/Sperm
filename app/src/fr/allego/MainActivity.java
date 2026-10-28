package fr.allego;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.pm.ApplicationInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.ColorDrawable;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
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
import android.widget.ScrollView;
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
    private boolean occupe, actif;

    private static final int BLEU = 0xFF2563EB, VERT = 0xFF16A34A;
    private LinearLayout corps, progression;
    private TextView numero, titreEtape, diag;
    private LinearLayout principal;
    private Button action, reglages, toutSupprimer;
    private final Button[] onglets = new Button[3];
    private BaseAdapter adaptateur;

    private final Shizuku.OnRequestPermissionResultListener permission = (code, r) -> majEtat();
    private final Shizuku.OnBinderReceivedListener connecte = this::majEtat;
    private final Shizuku.OnBinderDeadListener deconnecte = this::majEtat;

    @Override
    protected void onCreate(Bundle b) {
        super.onCreate(b);
        int pad = dp(16);
        LinearLayout racine = new LinearLayout(this);
        racine.setOrientation(LinearLayout.VERTICAL);
        racine.setPadding(pad, pad, pad, 0);
        racine.setBackgroundColor(0xFFF5F7FA);
        if (getActionBar() != null) getActionBar().hide();

        LinearLayout entete = new LinearLayout(this);
        entete.setGravity(Gravity.CENTER_VERTICAL);
        entete.setPadding(0, dp(8), 0, pad);
        ImageView logo = new ImageView(this);
        logo.setImageResource(R.drawable.ic_launcher);
        entete.addView(logo, new LinearLayout.LayoutParams(dp(52), dp(52)));
        LinearLayout noms = new LinearLayout(this);
        noms.setOrientation(LinearLayout.VERTICAL);
        noms.setPadding(dp(12), 0, 0, 0);
        TextView titre = texte(26, true, 0xFF10233F);
        titre.setText("Allégo");
        noms.addView(titre);
        TextView sous = texte(14, false, 0xFF6B7785);
        sous.setText("Allégez votre téléphone, en toute sécurité");
        noms.addView(sous);
        entete.addView(noms);
        racine.addView(entete);

        LinearLayout carte = new LinearLayout(this);
        carte.setOrientation(LinearLayout.VERTICAL);
        carte.setPadding(pad, pad, pad, pad);
        carte.setBackground(rond(Color.WHITE));
        carte.setElevation(dp(3));
        progression = new LinearLayout(this);
        progression.setPadding(0, 0, 0, dp(12));
        for (int i = 0; i < 3; i++) {
            View barre = new View(this);
            LinearLayout.LayoutParams lb = new LinearLayout.LayoutParams(0, dp(6), 1);
            lb.setMargins(i == 0 ? 0 : dp(4), 0, 0, 0);
            progression.addView(barre, lb);
        }
        carte.addView(progression);
        numero = texte(13, true, BLEU);
        numero.setLetterSpacing(0.08f);
        titreEtape = texte(22, true, Color.BLACK);
        corps = new LinearLayout(this);
        corps.setOrientation(LinearLayout.VERTICAL);
        corps.setPadding(0, dp(10), 0, dp(14));
        action = gros(BLEU);
        carte.addView(numero);
        carte.addView(titreEtape);
        carte.addView(corps);
        carte.addView(action);
        reglages = gros(0xFF5F6B7A);
        LinearLayout.LayoutParams lr = new LinearLayout.LayoutParams(-1, -2);
        lr.topMargin = dp(10);
        carte.addView(reglages, lr);
        diag = texte(13, false, 0xFF888888);
        diag.setPadding(0, dp(10), 0, 0);
        carte.addView(diag);
        ScrollView defile = new ScrollView(this);
        defile.addView(carte);
        racine.addView(defile, new LinearLayout.LayoutParams(-1, -2));

        principal = new LinearLayout(this);
        principal.setOrientation(LinearLayout.VERTICAL);
        LinearLayout barre = new LinearLayout(this);
        barre.setPadding(0, pad, 0, dp(8));
        String[] titres = {"À supprimer", "Toutes", "Supprimées"};
        for (int i = 0; i < 3; i++) {
            final int n = i;
            onglets[i] = new Button(this);
            onglets[i].setAllCaps(false);
            onglets[i].setTextSize(15);
            onglets[i].setText(titres[i]);
            onglets[i].setOnClickListener(v -> { onglet = n; filtrer(); });
            LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(0, dp(48), 1);
            lp.setMargins(dp(3), 0, dp(3), 0);
            barre.addView(onglets[i], lp);
        }
        principal.addView(barre);

        toutSupprimer = gros(VERT);
        toutSupprimer.setOnClickListener(v -> confirmerToutes());
        principal.addView(toutSupprimer);

        ListView liste = new ListView(this);
        liste.setDivider(new ColorDrawable(0));
        liste.setDividerHeight(dp(8));
        liste.setPadding(0, dp(8), 0, dp(8));
        liste.setClipToPadding(false);
        adaptateur = new Adaptateur();
        liste.setAdapter(adaptateur);
        liste.setOnItemClickListener((p, v, pos, id) -> choisir(visibles.get(pos)));
        principal.addView(liste, new LinearLayout.LayoutParams(-1, 0, 1));
        racine.addView(principal, new LinearLayout.LayoutParams(-1, 0, 1));
        setContentView(racine);

        Shizuku.addRequestPermissionResultListener(permission);
        Shizuku.addBinderReceivedListenerSticky(connecte);
        Shizuku.addBinderDeadListener(deconnecte);
    }

    private TextView texte(int taille, boolean gras, int couleur) {
        TextView t = new TextView(this);
        t.setTextSize(taille);
        t.setTextColor(couleur);
        if (gras) t.setTypeface(null, Typeface.BOLD);
        return t;
    }

    private Button gros(int couleur) {
        Button b = new Button(this);
        b.setAllCaps(false);
        b.setTextSize(18);
        b.setTextColor(Color.WHITE);
        b.setBackground(rond(couleur));
        b.setMinHeight(dp(56));
        return b;
    }

    private GradientDrawable rond(int couleur) {
        GradientDrawable g = new GradientDrawable();
        g.setColor(couleur);
        g.setCornerRadius(dp(16));
        return g;
    }

    @Override
    protected void onResume() {
        super.onResume();
        actif = true;
        majEtat();
        charger();
    }

    @Override
    protected void onPause() {
        actif = false;
        ui.removeCallbacks(verifier);
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        Shizuku.removeRequestPermissionResultListener(permission);
        Shizuku.removeBinderReceivedListener(connecte);
        Shizuku.removeBinderDeadListener(deconnecte);
        ui.removeCallbacks(verifier);
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

    private void etape(String num, String titre, String texte, String bouton, View.OnClickListener clic) {
        numero.setText(num);
        titreEtape.setText(titre);
        int n = num.startsWith("ÉTAPE ") ? num.charAt(6) - '0' : 4;
        for (int i = 0; i < 3; i++) {
            progression.getChildAt(i).setBackground(rond(i < n - 1 ? VERT : i == n - 1 ? BLEU : 0xFFE3E8EE));
        }
        corps.removeAllViews();
        for (String ligne : texte.split("\n")) {
            if (ligne.isEmpty()) continue;
            LinearLayout r = new LinearLayout(this);
            r.setPadding(0, dp(6), 0, dp(6));
            TextView t = texte(16, false, 0xFF2B3542);
            t.setLineSpacing(0, 1.2f);
            if (ligne.matches("\\d+\\. .*")) {
                TextView pastille = texte(14, true, BLEU);
                pastille.setGravity(Gravity.CENTER);
                pastille.setBackground(rond(0xFFE7EEFD));
                pastille.setText(ligne.substring(0, ligne.indexOf('.')));
                r.addView(pastille, new LinearLayout.LayoutParams(dp(28), dp(28)));
                t.setPadding(dp(12), dp(2), 0, 0);
                ligne = ligne.substring(ligne.indexOf(' ') + 1);
            }
            t.setText(ligne);
            r.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
            corps.addView(r);
        }
        action.setVisibility(bouton == null ? View.GONE : View.VISIBLE);
        action.setText(bouton);
        action.setOnClickListener(clic);
        reglages.setVisibility(View.GONE);
    }

    /** Bouton gris qui ouvre directement la bonne page des Paramètres. */
    private void raccourci(String texte, String page, String cle) {
        reglages.setVisibility(View.VISIBLE);
        reglages.setText(texte);
        reglages.setOnClickListener(v -> {
            try {
                // Fait défiler les Paramètres jusqu'au réglage et le met en surbrillance.
                Intent i = new Intent(page);
                Bundle args = new Bundle();
                args.putString(":settings:fragment_args_key", cle);
                i.putExtra(":settings:fragment_args_key", cle);
                i.putExtra(":settings:show_fragment_args", args);
                startActivity(i);
            } catch (Exception e) {
                startActivity(new Intent(Settings.ACTION_SETTINGS));
            }
        });
    }

    private static boolean xiaomi() {
        String m = (Build.MANUFACTURER + Build.BRAND).toLowerCase();
        return m.contains("xiaomi") || m.contains("redmi") || m.contains("poco");
    }

    private final Runnable verifier = this::majEtat;

    private void majEtat() {
        ui.post(() -> {
            boolean ok = pret();
            ui.removeCallbacks(verifier);
            if (!ok && actif) ui.postDelayed(verifier, 1500);
            boolean lie = false, autorise = false;
            try { lie = Shizuku.pingBinder(); autorise = lie && Shizuku.checkSelfPermission() == PackageManager.PERMISSION_GRANTED; } catch (Throwable t) { }
            diag.setText("Vérification automatique : Shizuku installé " + (installee(SHIZUKU) ? "✓" : "✗")
                    + " · connecté " + (lie ? "✓" : "✗") + " · autorisé " + (autorise ? "✓" : "✗")
                    + (installee(SHIZUKU) && !lie ? "\nSi Shizuku est démarré mais « connecté ✗ » reste affiché, fermez Allégo (bouton des apps récentes) puis rouvrez-le." : ""));
            principal.setVisibility(ok ? View.VISIBLE : View.GONE);
            if (ok) {
                etape("✅ TOUT EST PRÊT", "Choisissez les apps à supprimer",
                        "Touchez une app dans la liste. Vous pourrez toujours la remettre dans « Supprimées ».",
                        null, null);
            } else if (!installee(SHIZUKU)) {
                etape("ÉTAPE 1 SUR 3", "Installer l'outil Shizuku",
                        "Par sécurité, Android bloque la suppression des apps du fabricant. "
                        + "L'app gratuite Shizuku lève ce blocage.\n\n"
                        + "1. Touchez le bouton bleu.\n"
                        + "2. Dans le Play Store, touchez « Installer ».\n"
                        + "3. Revenez ici quand c'est fini.",
                        "Installer Shizuku", v -> ouvrir("market://details?id=" + SHIZUKU,
                                "https://play.google.com/store/apps/details?id=" + SHIZUKU));
            } else if (!Shizuku.pingBinder()) {
                View.OnClickListener ouvrirShizuku = v -> {
                    Intent i = getPackageManager().getLaunchIntentForPackage(SHIZUKU);
                    if (i != null) startActivity(i);
                };
                if (Build.VERSION.SDK_INT < 30) {
                    etape("ÉTAPE 2 SUR 3", "Démarrer Shizuku (avec un ordinateur)",
                            "Sur votre téléphone (Android 10 ou plus ancien), cette étape demande un "
                            + "ordinateur et un câble USB. Faites-vous aider si besoin : la marche à "
                            + "suivre est dans Shizuku, partie « Démarrer en se connectant à un ordinateur ».\n\n"
                            + "À refaire après chaque redémarrage du téléphone.",
                            "Ouvrir Shizuku", ouvrirShizuku);
                    raccourci("Ouvrir « À propos du téléphone »", Settings.ACTION_DEVICE_INFO_SETTINGS, "build_number");
                } else {
                    etape("ÉTAPE 2 SUR 3", "Démarrer Shizuku",
                            "Le téléphone doit être connecté au Wi-Fi.\n\n"
                            + "1. Touchez le bouton gris, puis touchez 7 fois "
                            + "« Numéro de build » (sur Xiaomi : « Version de l'OS » ou « Version MIUI »). Un message dit que vous êtes développeur.\n"
                            + "2. Touchez le bouton bleu : Shizuku s'ouvre.\n"
                            + "3. Dans Shizuku, touchez « Associer » (Pairing) et suivez ses indications : "
                            + "il vous fera activer le « Débogage sans fil ».\n"
                            + "4. Un code à 6 chiffres s'affiche : tapez-le dans la notification de Shizuku.\n"
                            + "5. Dans Shizuku, touchez « Démarrer ».\n"
                            + "6. Revenez ici : l'écran passe tout seul à l'étape 3.\n\n"
                            + "Après un redémarrage du téléphone, refaites seulement le point 5.",
                            "Ouvrir Shizuku", ouvrirShizuku);
                    raccourci("Ouvrir « À propos du téléphone »", Settings.ACTION_DEVICE_INFO_SETTINGS, "build_number");
                }
            } else if (xiaomi()) {
                etape("ÉTAPE 3 SUR 3", "Donner l'autorisation",
                        "Sur Xiaomi, un réglage caché doit d'abord être activé, sinon Shizuku "
                        + "affiche « La permission de adb est limitée ».\n\n"
                        + "1. Touchez le bouton gris : les options pour les développeurs s'ouvrent.\n"
                        + "2. Descendez jusqu'à « Débogage », passez « Installer via USB » et activez "
                        + "« Débogage USB (paramètres de sécurité) » (sous-titre : « Accorder les autorisations et simulation d'entrée »). "
                        + "Une carte SIM et un compte Xiaomi connecté sont demandés.\n"
                        + "3. Ouvrez Shizuku, touchez « Arrêter » puis « Démarrer ».\n"
                        + "4. Revenez ici et touchez le bouton bleu, puis « Autoriser ».",
                        "Autoriser", v -> Shizuku.requestPermission(1));
                raccourci("Ouvrir les options pour les développeurs",
                        Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS, "usb_debugging_security");
            } else {
                etape("ÉTAPE 3 SUR 3", "Donner l'autorisation",
                        "Touchez le bouton bleu, puis « Autoriser » dans la fenêtre qui s'ouvre.",
                        "Autoriser", v -> Shizuku.requestPermission(1));
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
        for (int i = 0; i < 3; i++) {
            onglets[i].setBackground(rond(i == onglet ? BLEU : 0xFFDDE3EA));
            onglets[i].setTextColor(i == onglet ? Color.WHITE : Color.BLACK);
        }
        toutSupprimer.setVisibility(onglet == ONGLET_CONSEILLEES && !visibles.isEmpty() ? View.VISIBLE : View.GONE);
        toutSupprimer.setText("Supprimer ces " + visibles.size() + " apps sans risque");
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
                ligne.setPadding(dp(12), dp(14), dp(12), dp(14));
                ligne.setBackground(rond(Color.WHITE));
                ImageView ic = new ImageView(MainActivity.this);
                ligne.addView(ic, new LinearLayout.LayoutParams(dp(48), dp(48)));
                TextView t = new TextView(MainActivity.this);
                t.setPadding(dp(12), 0, 0, 0);
                t.setTextSize(17);
                ligne.addView(t, new LinearLayout.LayoutParams(0, -2, 1));
                TextView pill = texte(12, true, Color.WHITE);
                pill.setPadding(dp(10), dp(4), dp(10), dp(4));
                ligne.addView(pill);
            }
            App a = visibles.get(i);
            ((ImageView) ligne.getChildAt(0)).setImageDrawable(a.icone);
            TextView t = (TextView) ligne.getChildAt(1);
            String sous;
            int couleur;
            String statut;
            if (a.supprimee) { sous = "Touchez pour la remettre"; statut = "Supprimée"; couleur = 0xFF6B7785; }
            else if (a.niveau == Regles.PROTEGEE) { sous = "Indispensable au téléphone"; statut = "Protégée"; couleur = 0xFF8A94A3; }
            else if (a.niveau == Regles.CONSEILLEE) { sous = Regles.raison(a.paquet); statut = "Sans risque"; couleur = VERT; }
            else { sous = "Rôle inconnu, à éviter en cas de doute"; statut = "Prudence"; couleur = 0xFFE07B00; }
            TextView pill = (TextView) ligne.getChildAt(2);
            pill.setText(statut);
            pill.setBackground(rond(couleur));
            t.setTextColor(a.niveau == Regles.PROTEGEE ? Color.GRAY : Color.BLACK);
            android.text.SpannableString s = new android.text.SpannableString(a.nom + "\n" + sous);
            s.setSpan(new android.text.style.ForegroundColorSpan(0xFF6B7785), a.nom.length() + 1, s.length(), 0);
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
                            + "(appels, écran, sécurité ou mises à jour). Allégo refuse de la supprimer.")
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
