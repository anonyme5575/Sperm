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
| Glisser le bouton rond | Le déplace ; il se colle au bord le plus proche et reste visible en portrait comme en paysage |
| Appui long (0,7 s) sur le bouton rond | Retour à l'écran Duo : les deux apps, « Fermer les apps en arrière-plan », « Sortir de Duo » (PIN demandé) |

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

## Sortir de Duo

Appui long sur le bouton rond, **Sortir de Duo**, puis le PIN. Deux choix :

- **Sortir seulement** : le téléphone est déverrouillé et les apps masquées reviennent. Duo garde ses droits : tu peux relancer le mode d'un toucher.
- **Rendre le téléphone normal** : tout est remis comme avant (apps réaffichées, verrouillage levé, écran qui ne reste plus allumé, accueil MIUI) et Duo perd ses droits de propriétaire. Duo devient une app ordinaire, que tu peux désinstaller. Pour le reverrouiller, il faudra refaire la commande `adb` du PC.

Hors mode Duo, le même bouton **Rendre le téléphone normal** est dans l'écran de réglages de Duo.

## Compiler

```
android/build.sh      # -> dist/duo.apk
```

Il faut un JDK 17 ou plus, `curl`, `unzip` et `zip`. Le script télécharge le reste dans `android/.tools`. Le workflow GitHub « APK » compile aussi l'APK à chaque push (onglet Actions, artefact `duo-apk`).

---

# Boîte à Blocs

Construction 3D avec des blocs de couleur unie, dans un monde sans bord, dans le navigateur. Ouvre `blocs/index.html` (PC ou téléphone, connexion internet nécessaire pour charger three.js).

| Action | PC | Téléphone |
|---|---|---|
| Poser / effacer / peindre / pipette | clic (ou touches 1 à 4) | toucher |
| Effacer vite | Maj + clic | — |
| Tourner la vue | glisser | glisser à un doigt |
| Zoomer | molette | pincer |
| Avancer dans le monde | clic droit glissé, ZQSD / WASD ou flèches | glisser à deux doigts |
| Choisir la forme : bloc, demi-bloc, pente, micro-cube, bonhomme | touches 5 à 9 | ligne des formes |
| Tourner une pente ou un bonhomme | touche R | bouton Tourner |
| Symétrie (miroir gauche-droite) | touche M | bouton Symétrie |
| Annuler / rétablir | Ctrl+Z / Ctrl+Y | boutons en haut |

Le monde est infini à l'horizontale (le sol est à la hauteur 0, plafond à 512 blocs). La position affichée en haut à gauche indique où tu es ; le menu « ⋯ » permet de revenir au centre ou d'aller à ta construction.

Formes : un **demi-bloc** fait la moitié de la hauteur d'un bloc, un **micro-cube** fait la moitié d'un bloc dans chaque sens (8 micro-cubes = 1 bloc). Une **pente** monte en s'éloignant de toi ; « Tourner » lui ajoute un quart de tour. La pipette reprend la couleur et la forme.

Accueil : au lancement, un écran d'accueil propose de continuer le dernier monde, d'en créer un nouveau (vide ou avec l'exemple), de gérer « Mes mondes » (jouer, supprimer) ou de lire l'aide. Chaque monde est sauvegardé à part. Le menu « ⋯ » en jeu ramène au menu principal.

Bonshommes : des petits personnages (un bloc et demi de haut) avec un métier choisi au moment de les poser.
- **Promeneur** : il se balade, monte et descend les marches d'un demi-bloc, passe par une porte de 2 blocs.
- **Bâtisseur** (il tient un bloc) : il construit une cabane de 3 × 3 blocs devant lui, avec une porte et un toit en pente, pièce par pièce, puis se promène.
- **Peintre** (il tient un pinceau) : il repeint de la couleur de son haut les blocs qu'il touche en passant.
- **Guerrier** (épée) : il traque le bonhomme d'une autre couleur le plus proche et l'attaque. Tout bonhomme frappé riposte. 10 points de vie, une barre apparaît après un coup, la vie remonte lentement.
- **Démolisseur** (marteau) : il va casser les blocs les plus proches.

La couleur d'un bonhomme est son équipe. Deux bonshommes de même couleur qui se croisent font un bébé de leur couleur, avec le métier d'un parent (parfois un autre) ; 80 bonshommes au plus, bouton « Naissances » pour couper. Le bouton pause en haut (ou Espace) fige tout le monde.

Interface : deux onglets en bas, « Construire » (formes) et « Bonshommes » (métiers, naissances), avec les outils en icônes et la palette en commun.

Aucun ne traverse les blocs ; ils tombent si on retire ce qui les porte. Ce qu'ils construisent ou peignent ne passe pas par Annuler. 

Images : le menu « ⋯ » transforme une image PNG ou JPG en mur de pixel art, face à toi (64 px max en micro-cubes, 32 px max en blocs ; les pixels transparents sont ignorés). « Prendre une photo » affiche une image PNG de la vue, à enregistrer par appui long ou clic droit.

La construction est sauvegardée automatiquement dans le navigateur. Le menu « ⋯ » donne un code texte pour la copier ailleurs ou la partager.
