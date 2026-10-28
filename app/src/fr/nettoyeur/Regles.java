package fr.nettoyeur;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.regex.Pattern;

/** Classe chaque app système : indispensable, conseillée à supprimer, ou inconnue. */
final class Regles {
    static final int PROTEGEE = 0, INCONNUE = 1, CONSEILLEE = 2;

    /** Seul format de nom accepté avant d'envoyer une commande : bloque toute injection. */
    static final Pattern NOM = Pattern.compile("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z0-9_]+)+");

    /** Sans elles, le téléphone ne démarre plus, ne téléphone plus ou ne s'installe plus rien. */
    private static final Set<String> PROTEGEES = new HashSet<>();
    private static final String[] PREFIXES_PROTEGES = {
        "android.", "com.android.providers.", "com.android.server.", "com.android.networkstack",
        "com.google.android.networkstack", "com.android.internal.", "com.mediatek.ims",
        "com.qualcomm.qti.telephony", "com.android.ims", "com.android.phone",
    };
    private static final Map<String, String> CONSEILLEES = new HashMap<>();

    static {
        for (String p : new String[] {
            "android", "com.android.systemui", "com.android.settings", "com.android.shell",
            "com.android.packageinstaller", "com.google.android.packageinstaller",
            "com.android.permissioncontroller", "com.google.android.permissioncontroller",
            "com.android.bluetooth", "com.android.nfc", "com.android.se", "com.android.keychain",
            "com.android.location.fused", "com.android.inputdevices", "com.android.externalstorage",
            "com.android.ext.services", "com.google.android.ext.services", "com.android.extservices",
            "com.google.android.ext.shared", "com.android.carrierconfig", "com.android.certinstaller",
            "com.android.defcontainer", "com.android.mms.service", "com.android.incallui",
            "com.android.stk", "com.android.emergency", "com.android.cellbroadcastreceiver",
            "com.google.android.cellbroadcastreceiver", "com.android.provision",
            "com.google.android.setupwizard", "com.android.localtransport", "com.android.vpndialogs",
            "com.android.webview", "com.google.android.webview", "com.google.android.gsf",
            "com.google.android.gms", "com.android.vending", "com.android.wallpaperbackup",
            "com.miui.securitycenter", "com.miui.securityadd", "com.miui.securitycore",
            "com.miui.system", "com.miui.rom", "com.miui.core", "com.miui.home",
            "com.lbe.security.miui", "com.xiaomi.finddevice", "com.xiaomi.account",
            "com.miui.guardprovider", "com.miui.powerkeeper", "com.android.updater",
            "com.samsung.android.lool", "com.sec.android.app.launcher", "com.samsung.android.honeyboard",
            "com.huawei.android.launcher", "com.oppo.launcher", "com.google.android.apps.nexuslauncher",
            "moe.shizuku.privileged.api", "fr.nettoyeur",
        }) PROTEGEES.add(p);

        c("Publicités et statistiques Xiaomi", "com.miui.analytics", "com.miui.msa.global",
            "com.miui.daemon", "com.xiaomi.joyose", "com.miui.hybrid", "com.miui.hybrid.accessory");
        c("Facebook préinstallé", "com.facebook.appmanager", "com.facebook.services",
            "com.facebook.system", "com.facebook.katana");
        c("App préinstallée par le fabricant", "com.mi.globalbrowser", "com.miui.videoplayer",
            "com.miui.player", "com.miui.yellowpage", "com.miui.bugreport", "com.xiaomi.mipicks",
            "com.mi.android.globalminusscreen", "com.xiaomi.glgm", "com.miui.weather2",
            "com.mi.health", "com.xiaomi.midrop", "com.miui.compass", "com.miui.fm",
            "com.xiaomi.payment", "com.mipay.wallet.in", "com.miui.miservice",
            "com.samsung.android.game.gamehome", "com.samsung.android.bixby.agent",
            "com.samsung.android.app.tips", "com.samsung.android.arzone");
        c("Partenaire commercial préinstallé", "com.netflix.partner.activation", "com.netflix.mediaclient",
            "com.amazon.appmanager", "com.amazon.mShop.android.shopping", "com.ebay.mobile",
            "com.ebay.carrier", "com.linkedin.android", "com.spotify.music", "com.booking",
            "com.microsoft.skydrive", "cn.wps.moffice_eng", "com.block.juggle");
        c("App Google facultative", "com.google.android.apps.tachyon", "com.google.android.videos",
            "com.google.android.music", "com.google.android.apps.youtube.music",
            "com.google.android.apps.magazines", "com.google.android.apps.subscriptions.red",
            "com.google.android.feedback", "com.google.android.apps.wellbeing",
            "com.google.android.apps.podcasts", "com.google.android.apps.books",
            "com.google.android.apps.googleassistant", "com.google.ar.lens");
    }

    private static void c(String raison, String... paquets) {
        for (String p : paquets) CONSEILLEES.put(p, raison);
    }

    static int niveau(String paquet, Set<String> protegeesEnPlus) {
        if (!NOM.matcher(paquet).matches() || PROTEGEES.contains(paquet)
                || protegeesEnPlus.contains(paquet)) return PROTEGEE;
        for (String p : PREFIXES_PROTEGES) if (paquet.startsWith(p)) return PROTEGEE;
        return CONSEILLEES.containsKey(paquet) ? CONSEILLEE : INCONNUE;
    }

    static String raison(String paquet) {
        return CONSEILLEES.get(paquet);
    }
}
