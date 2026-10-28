# Nettoyeur

App Android pour **supprimer les apps préinstallées** (Facebook, publicités Xiaomi, apps du fabricant…) directement depuis le téléphone, sans PC et sans root.

## Ce qui la rend sûre

- **Les apps indispensables sont verrouillées** 🔒 : système, téléphone, sécurité, mises à jour, Google Play, ainsi que l'écran d'accueil et le clavier que vous utilisez. L'app refuse de les supprimer, sans exception.
- **Tout est réversible** : une app supprimée reste rangée dans le téléphone. L'onglet « Supprimées » la remet en un toucher. Une réinitialisation d'usine remet aussi tout.
- **Trois niveaux clairs** : ✅ sans risque (liste vérifiée), ⚠️ inconnue (double confirmation), 🔒 indispensable (impossible).
- Aucune connexion Internet, aucune donnée envoyée.

## Installation

1. Copiez `dist/nettoyeur.apk` sur le téléphone et installez-le.
2. Ouvrez Nettoyeur et suivez les 3 étapes affichées :
   1. installer **Shizuku** (gratuit, sur le Play Store) : c'est lui qui donne le droit de supprimer les apps du fabricant ;
   2. démarrer Shizuku (il explique comment, par le « débogage sans fil ») ;
   3. autoriser Nettoyeur.

Android 11 et plus : tout se fait sur le téléphone. Android 7 à 10 : Shizuku doit être démarré une fois depuis un PC après chaque redémarrage (voir l'aide de Shizuku).

## Utilisation

- **Conseillées** : les apps qu'on peut supprimer sans risque. Un bouton les supprime toutes d'un coup.
- **Toutes** : toutes les apps du fabricant, avec leur niveau de risque.
- **Supprimées** : touchez une app pour la remettre.

## Compiler

`app/build.sh` produit `dist/nettoyeur.apk` (JDK 17+, curl, unzip, zip). GitHub Actions le compile à chaque push.
