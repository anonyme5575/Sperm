# Mes Fanfics

App Android pour ranger les fanfics que tu aimes à partir de leurs liens.

- **Ajouter** : touche **+** et colle un ou plusieurs liens (un par ligne, ou un texte qui en contient), ou **partage** une page depuis ton navigateur / l'app AO3 vers **Mes Fanfics**.
- L'app va lire elle-même les infos : titre, auteur, fandoms, relations, personnages, tags, classement, nombre de mots, chapitres, terminée ou non, résumé.
- **Ranger** : À lire / En cours / Lue / Abandonnée, favorite, note sur 5, « lu jusqu'au chapitre N », étagères à toi (ex. « Slow burn », « À relire »), notes perso.
- **Retrouver** : recherche dans tout (titre, auteur, tags, résumé, tes notes…), filtre par fandom et par étagère, tri par ajout, mise à jour, titre, auteur, note, longueur.
- **Nouveaux chapitres** : le bouton ⟳ relit toutes les fanfics pas encore terminées et regroupe celles qui ont de nouveaux chapitres dans l'onglet « Nouveaux chapitres ».
- **Sauvegarde** : menu ⋮ > « Sauvegarder ma liste » crée un fichier `.json` (à mettre sur Drive, par exemple) ; « Restaurer une sauvegarde » le relit. La liste suit aussi la sauvegarde Google du téléphone.

## Installation

Copie `dist/mes-fanfics.apk` sur le téléphone, ouvre-le et autorise l'installation depuis des sources inconnues. Android 8 ou plus.

## Sites

| Site | Ce qui est lu |
|---|---|
| Archive of Our Own | Tout (y compris les fanfics « adultes »). Les fanfics réservées aux membres connectés ne sont pas lisibles : remplis-les avec **Modifier**. |
| Wattpad | Titre, auteur, résumé, tags, nombre de parties, terminée ou non. |
| FanFiction.net | Tout, **quand le site laisse passer**. Il est souvent protégé par une page anti-robot : dans ce cas la fanfic est ajoutée avec le titre tiré du lien et tu complètes avec **Modifier**. « Ouvrir » t'emmène au chapitre suivant celui que tu as lu. |
| Autres sites | Titre, résumé et auteur quand la page les annonce (balises de partage). |

Si un site change sa mise en page, la lecture des infos peut casser pour ce site : la fanfic reste ajoutée et modifiable à la main.

## Version navigateur

`fanfics/web/index.html` s'ouvre aussi dans un navigateur de PC (données dans le navigateur). Les navigateurs interdisent à une page de lire d'autres sites : dans ce mode, les infos des fanfics ne se remplissent pas toutes seules.

## Développement

```
fanfics/android/build.sh      # -> dist/mes-fanfics.apk (JDK 17+, curl, unzip, zip)
node fanfics/tests/test.cjs   # tests dans Chromium (Playwright)
```

- `web/parsers.js` : reconnaissance des liens et lecture des pages de chaque site.
- `web/app.js` : l'interface. `android/.../MainActivity.java` : télécharge les pages, garde la liste dans `fanfics.json`, reçoit les partages.
- Les pages de `tests/pages/` sont des reconstitutions de la structure de chaque site, pas des copies récentes.
