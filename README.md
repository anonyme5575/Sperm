# Duo

App Android qui transforme un vieux téléphone en écran dédié à **deux apps** (par exemple un Stream Deck et un moniteur matériel) :

- **un bouton rond flottant** bascule d'une app à l'autre d'un toucher (il affiche l'icône de l'app vers laquelle tu vas) ;
- le téléphone est **verrouillé sur ces deux apps** : pas de bouton Accueil, pas de Récents, pas de barre de notifications ;
- **tout le reste est coupé** : les autres apps sont masquées, elles ne peuvent plus tourner du tout. Elles reviennent intactes quand tu quittes le mode Duo.

Prévu pour Android 9 et plus. Pensé pour un Redmi 9AT (Android 10, MIUI 12, 2 Go de RAM).

## Utilisation

| Geste | Effet |
|---|---|
| Toucher le bouton rond | Bascule vers l'autre app |
| Glisser le bouton rond | Le déplace (la position est retenue) |
| Appui long (0,7 s) sur le bouton rond | Retour à l'écran Duo : les deux apps, « Fermer les apps en arrière-plan », « Quitter le mode Duo » (PIN demandé) |

Après un redémarrage, le téléphone revient directement sur l'écran Duo, toujours verrouillé.

## Installation (une seule fois, environ 15 minutes)

Le verrouillage complet et la coupure des autres apps exigent que Duo soit **propriétaire de l'appareil**. Android ne donne ce droit que par une commande lancée depuis un PC. Sans cette étape, seul le bouton de bascule fonctionne.

### 1. Sur le PC

Télécharge les [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools) et dézippe-les. Tu y trouves `adb`.

### 2. Sur le téléphone

1. **Paramètres > À propos du téléphone** : tape 7 fois sur **Version de MIUI** pour activer les options développeur.
2. **Paramètres > Paramètres supplémentaires > Options pour les développeurs** : active **Débogage USB**.
3. Copie `dist/duo.apk` sur le téléphone, ouvre-le et installe-le. Autorise l'installation depuis des sources inconnues si MIUI le demande.
4. **Supprime tous les comptes** dans **Paramètres > Comptes et synchronisation** : compte Google, compte Mi et tout autre compte. Android refuse la commande de l'étape 3 tant qu'il reste un compte. Tu pourras rajouter ton compte Google après.
   - Pour le compte Mi, désactive d'abord **Localiser mon appareil**.

### 3. Rendre Duo propriétaire

Branche le téléphone en USB, accepte l'empreinte du PC sur le téléphone, puis dans un terminal ouvert dans le dossier `platform-tools` :

```
adb devices
adb shell dpm set-device-owner com.duo.kiosk/.AdminReceiver
```

La réponse doit contenir `Success: Device owner set`. En cas d'erreur `already some accounts`, il reste un compte à supprimer (étape 2.4).

### 4. Dans Duo

1. Choisis **App 1** et **App 2**.
2. Choisis un **code PIN** : il te sera demandé pour quitter le mode Duo.
3. Touche **Autoriser le bouton rond** et active l'autorisation.
4. Touche **Autorisations MIUI** et active **Afficher les fenêtres pop-up lorsque l'app s'exécute en arrière-plan**. Sans ça, MIUI bloque la bascule sans prévenir.
5. Dans **Paramètres > Applications > Gérer les applications > Duo** : **Économiseur de batterie > Aucune restriction** et **Démarrage automatique** activé.
6. Touche **DÉMARRER LE MODE DUO**.

## Ce que fait « couper toutes les autres apps »

- **Masquées** (impossible de tourner, même en arrière-plan) : toutes les apps que tu as installées toi-même, plus une liste d'apps préinstallées sans risque (pubs et services Xiaomi, YouTube, Gmail, Maps, Photos, Facebook…). Voir `SAFE_SYSTEM` dans `Duo.java`.
- **Jamais touchées** : les deux apps choisies, le clavier, et les apps système dont le téléphone a besoin (téléphonie, Wi-Fi, services Google…).
- Tout est réaffiché quand tu quittes le mode Duo.

Si l'une de tes deux apps dépend d'une autre app (rare), décoche l'option ou retire cette app de la liste.

## Sortie de secours

Si l'écran Duo devient inaccessible, branche le téléphone au PC :

```
adb shell am broadcast -n com.duo.kiosk/.RescueReceiver
```

Ça quitte le mode Duo et réaffiche toutes les apps. Pour retirer aussi les droits de propriétaire :

```
adb shell am broadcast -n com.duo.kiosk/.RescueReceiver --ez unowner true
```

Pour désinstaller Duo : quitte le mode Duo, touche **Retirer les droits de propriétaire**, puis désinstalle normalement.

## Compiler

```
android/build.sh      # -> dist/duo.apk
```

Il faut un JDK 17 ou plus, `curl`, `unzip` et `zip`. Le script télécharge le reste dans `android/.tools`. Le workflow GitHub « APK » compile aussi l'APK à chaque push (onglet Actions, artefact `duo-apk`).
