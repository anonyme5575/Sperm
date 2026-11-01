# Mes Fanfics

App Android pour ranger les fanfics que tu aimes à partir de leurs liens.

- **Ajouter** : touche **+** et colle un ou plusieurs liens (un par ligne, ou un texte qui en contient), ou **partage** une page depuis ton navigateur / l'app AO3 vers **Mes Fanfics**.
- L'app va lire elle-même les infos : titre, auteur, fandoms, relations, personnages, tags, classement, nombre de mots, chapitres, terminée ou non, résumé.
- **Ranger** : À lire / En cours / Lue / Abandonnée, favorite, note sur 5, « lu jusqu'au chapitre N », étagères à toi (ex. « Slow burn », « À relire »), notes perso.
- **Retrouver** : recherche dans tout (titre, auteur, tags, résumé, tes notes…), filtre par fandom et par étagère, tri par ajout, mise à jour, titre, auteur, note, longueur.
- **Nouveaux chapitres** : le bouton ⟳ relit toutes les fanfics pas encore terminées et regroupe celles qui ont de nouveaux chapitres dans l'onglet « Nouveaux chapitres ».
- **Sauvegarde** : menu ⋮ > « Sauvegarder ma liste » crée un fichier `.json` (à mettre sur Drive, par exemple) ; « Restaurer une sauvegarde » le relit. La liste suit aussi la sauvegarde Google du téléphone.

## Lire dans l'app

- **📖 Lire** (dans la fiche ou dans les résultats de recherche) ouvre le lecteur : liste des chapitres, ◀ ▶, taille du texte A− / A+.
- L'app retient le chapitre et l'endroit où tu t'es arrêtée ; « Reprendre au chap. N » te ramène pile là. Un chapitre lu jusqu'en bas compte comme lu.
- Le chapitre suivant est préparé pendant que tu lis. Les chapitres déjà ouverts restent sur le téléphone : ils se relisent sans Internet.
- AO3, FanFiction.net, Wattpad ; pour les autres sites, l'app prend le plus gros bloc de texte de la page.

## Traduction automatique

- Les chapitres et les résumés qui ne sont pas en français sont traduits automatiquement (bandeau « Traduit automatiquement · Voir l'original »).
- Menu ⋮ : activer ou couper la traduction, choisir la langue (français, anglais, espagnol, allemand, italien, portugais).
- La traduction passe par le service gratuit de Google Traduction : le texte des chapitres est envoyé à Google. Ce service n'est pas officiellement prévu pour les apps ; s'il refuse (trop de demandes), réessaie plus tard.

## Recherche Wattpad précise

Wattpad renvoie des résultats approximatifs : l'app les filtre et les trie elle-même (jusqu'à 4 pages lues pour garder assez de bons résultats).
- Tous les mots sont requis (titre, tags, auteur ou résumé), accents ignorés.
- `"phrase exacte"`, `#tag` (ex. `#enemiestolovers`, tirets et espaces ignorés), `@auteur`, `-mot` pour exclure.
- Filtres : langue, terminées seulement, contenu mature ou non.
- Tri : titre exact, puis mots entiers dans un titre court, puis tags, auteur, résumé, puis popularité.

## Rechercher des fanfics

- Bouton 🔍 : recherche sur AO3, FanFiction.net ou Wattpad (titre, fandom, personnage, couple, tag…).
- Sur AO3 : filtre par langue, « Terminées » seulement, tri par kudos, mise à jour, vues ou longueur.
- Chaque résultat : **+ Ajouter** à ta liste, ou **📖 Lire** tout de suite. Les résumés étrangers sont traduits.

## L'interface

- **Biblio** : ta liste, avec en tête tes chiffres (fanfics, en cours, lues, mots lus) et le carrousel **Continuer la lecture** : un toucher et tu reprends pile où tu t'étais arrêtée.
- Chaque fanfic a une **couverture générée** : la couleur vient du fandom (toutes les fics Harry Potter ont la même teinte), le motif du titre.
- **Découvrir** : chercher des histoires. **Comptes** : chercher un pseudo. **+** : ajouter des liens. **Réglages** : traduction, sauvegarde, comptes.
- Lecteur : trois ambiances (🌙 nuit, ☕ sépia, ☀️ papier), barre de progression, toucher le texte pour lire en plein écran.

## Notifications : nouveaux chapitres, nouvelles histoires

Environ toutes les 4 heures, quand il y a du réseau, l'app vérifie en arrière-plan (sans s'ouvrir) :
- **tes auteurs favoris AO3 et Wattpad** : nouvelle histoire publiée, ou nouveaux chapitres sur leurs histoires ;
- **tes fanfics « En cours » AO3 et Wattpad** pas encore terminées.

Tu reçois une notification ; en ouvrant l'app, les fanfics concernées passent dans l'onglet « Nouveaux chapitres » et les nouvelles histoires apparaissent en haut de l'écran **Auteurs** (pastille rose sur le bouton). Réglages : 🔔 activer ou couper, **Vérifier les nouveautés maintenant**.

Limites :
- **FanFiction.net** n'est pas vérifié en arrière-plan : sa protection anti-robot exige un navigateur. Le bouton ⟳ de la bibliothèque le vérifie, app ouverte.
- La première vérification d'un auteur sert de point de départ : elle ne notifie rien.
- Sur MIUI (Xiaomi), autorise l'app à tourner en arrière-plan : **Paramètres > Applications > Mes Fanfics > Économiseur de batterie > Aucune restriction**, et **Démarrage automatique**. Sinon MIUI peut bloquer les vérifications.
- Android 13 et plus : accepte la demande d'autorisation des notifications au premier lancement.

## Synchronisation avec ton compte Google (Google Drive)

Réglages > **Synchronisation Google Drive** :
1. Sur le premier téléphone : **Créer le fichier sur Google Drive**. Dans le sélecteur qui s'ouvre, choisis **Drive** (menu ☰), puis Enregistrer.
2. Sur l'autre téléphone : installe l'app, puis **J'ai déjà un fichier (autre téléphone)** et choisis `mes-fanfics-synchro.json` dans Drive.

Ensuite tout se synchronise seul : fanfics, statuts, notes, étoiles, position de lecture, auteurs favoris, comptes. Synchro à l'ouverture de l'app, 20 s après une modification, et quand tu quittes l'app. Si une même fanfic a été modifiée sur les deux téléphones, la modification la plus récente gagne ; une fanfic supprimée sur un téléphone ne revient pas depuis l'autre.

Il faut l'app **Google Drive** installée sur les deux téléphones. Drive transmet le fichier avec un petit délai (quelques secondes à quelques minutes selon le réseau) : si un changement n'apparaît pas, touche **Synchroniser** un peu plus tard. Les chapitres gardés pour la lecture hors ligne ne sont pas synchronisés (ils se retéléchargent).

## Léger et rapide, même sur un petit téléphone

- APK d'environ 80 Ko, aucune bibliothèque externe.
- Avec 2 000 fanfics sur un téléphone lent (processeur simulé 6 fois plus lent) : démarrage 0,9 s, changement d'onglet 43 ms. La liste n'affiche que ce qui est à l'écran.
- **Mode léger** (Réglages) : sans animations ni ombres ; activé automatiquement sur les téléphones à 2 Go de mémoire ou 4 cœurs.
- Le navigateur caché (FanFiction.net) est libéré après une minute sans usage.
- La vérification en arrière-plan n'utilise pas de navigateur : quelques requêtes légères, puis l'app se rendort.

## Traduction quasi instantanée

- Le haut du chapitre arrive traduit en premier (une fraction de seconde), la suite remplace le texte grisé pendant que tu lis.
- Le chapitre à reprendre est traduit à l'avance : quand tu ouvres la fiche d'une fanfic, au lancement de l'app pour ta dernière lecture, et pour le chapitre suivant pendant que tu lis. Déjà traduit, il s'affiche directement en français, même hors ligne.

## Mes auteurs favoris

- Dans la fiche d'une fanfic : **☆ Auteur favori** à côté du nom de l'auteur l'enregistre (✓ pour le retirer). Toucher son nom ouvre son profil.
- Bouton **Auteurs** en bas : la liste de tes auteurs favoris, chacun avec **Voir le profil** (ses histoires, favoris…). Au-dessus, la recherche par pseudo pour en trouver d'autres.
- Dans les résultats de recherche, ★ à côté d'un auteur signale qu'il est dans tes favoris ; son nom ouvre son profil.
- Pour une ancienne fanfic FanFiction.net, l'app relit la page une fois pour trouver le profil de l'auteur.

## Chercher un compte par son pseudo

**Comptes**, tape un pseudo : l'app le cherche en même temps sur AO3, FanFiction.net et Wattpad et montre les comptes trouvés. **Tout voir** ouvre sa page avec tout ce qui est public :

| Site | Sections |
|---|---|
| FanFiction.net | Ses histoires, ses favoris, ses auteurs favoris |
| AO3 | Ses œuvres, ses marque-pages (les abonnements AO3 sont privés) |
| Wattpad | Ses histoires, ses listes de lecture, les comptes suivis |

Depuis cette page : ajouter ou lire chaque histoire, ouvrir le profil d'un auteur suivi, **C'est moi : importer mes favoris**, **☆ Auteur favori**. Retour revient à la page précédente.

Sur FanFiction.net, seul le pseudo exact est retenu (le site propose aussi des noms proches). **FanFiction.net n'autorise la recherche par pseudo qu'aux membres connectés** : l'app affiche alors « Me connecter à FanFiction.net », ouvre leur page de connexion dans l'app (tu te connectes une fois, la session est gardée) et relance la recherche quand tu touches Terminé. Sans compte, colle simplement le lien du profil (`fanfiction.net/u/…`) avec + : les pages de profil sont publiques.

## Importer mes favoris, mes auteurs favoris

Touche **+** et colle le lien de ton profil, ou partage ta page de profil vers l'app. L'app demande : **« C'est mon compte »** (importer tes favoris) ou **« Ajouter à mes auteurs favoris »** (le lien est celui d'un auteur).

| Site | Lien du profil | Ce qui est importé |
|---|---|---|
| FanFiction.net | `fanfiction.net/u/123456/Pseudo` | Histoires favorites (étagère « Favoris FanFiction.net ») et auteurs favoris |
| AO3 | `archiveofourown.org/users/Pseudo` | Marque-pages, toutes les pages (étagère « Marque-pages AO3 »). Les auteurs suivis (abonnements) sont privés sur AO3 : impossible à lire sans connexion. |
| Wattpad | `wattpad.com/user/Pseudo` | Histoires de tes listes de lecture et comptes suivis |

- Les histoires importées sont marquées ★ Favorites. Celles déjà dans ta liste ne sont pas dupliquées.
- Menu ⋮ > **Mes comptes** > **Synchroniser** : ajoute ce que tu as mis en favori depuis le dernier import.
- Onglet **👤 Auteurs** : tes auteurs favoris ; **Ses histoires** montre tout ce qu'un auteur a publié, à ajouter ou lire directement.
- Seules les informations publiques sont lues : un profil ou des marque-pages privés ne peuvent pas être importés.

## Installation

Copie `dist/mes-fanfics.apk` sur le téléphone, ouvre-le et autorise l'installation depuis des sources inconnues. Android 8 ou plus.

## Sites

| Site | Ce qui est lu |
|---|---|
| Archive of Our Own | Tout (y compris les fanfics « adultes »). Les fanfics réservées aux membres connectés ne sont pas lisibles : remplis-les avec **Modifier**. |
| Wattpad | Titre, auteur, résumé, tags, nombre de parties, terminée ou non. |
| FanFiction.net | Tout. La page est chargée dans un navigateur intégré à l'app, comme si tu l'ouvrais toi-même, pour passer la vérification anti-robot. Si le site demande de cocher une case, l'app te montre la page : coche-la et la fanfic s'ajoute. Ensuite le site s'en souvient et ne redemande plus pendant un moment. S'il est en maintenance, réessaie plus tard. « Ouvrir » t'emmène au chapitre suivant celui que tu as lu. |
| Autres sites | Titre, résumé et auteur quand la page les annonce (balises de partage). Si le site bloque la lecture, l'app réessaie avec le navigateur intégré. |

Si un site change sa mise en page, la lecture des infos peut casser pour ce site : la fanfic reste ajoutée et modifiable à la main.

## Version navigateur

`fanfics/web/index.html` s'ouvre aussi dans un navigateur de PC (données dans le navigateur). Les navigateurs interdisent à une page de lire d'autres sites : dans ce mode, les infos des fanfics ne se remplissent pas toutes seules.

## Développement

```
fanfics/android/build.sh      # -> dist/mes-fanfics.apk (JDK 17+, curl, unzip, zip)
node fanfics/tests/test.cjs   # tests dans Chromium (Playwright)
```

- `web/parsers.js` : reconnaissance des liens, lecture des pages, des chapitres et des résultats de recherche de chaque site.
- `web/reader.js` : le lecteur. `web/translate.js` : la traduction. `web/search.js` : la recherche. `web/accounts.js` : comptes, import des favoris, auteurs.
- `web/app.js` : l'interface. `android/.../MainActivity.java` : télécharge les pages, garde la liste dans `fanfics.json`, reçoit les partages.
- Les pages de `tests/pages/` sont des reconstitutions de la structure de chaque site, pas des copies récentes.
