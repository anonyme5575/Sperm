# Moniteur PC

Deux pièces, rien d'autre à installer :

- **`MoniteurPC.exe`** sur le PC Windows : une icône près de l'horloge. Il lit lui-même tous les capteurs, mesure les FPS des jeux et surveille les problèmes.
- **`moniteur-pc.apk`** sur le téléphone Android : trouve le PC tout seul sur le Wi-Fi, affiche tout en plein écran et envoie une **notification Android** quand quelque chose ne va pas, même écran éteint.

Téléchargements (mis à jour à chaque version) :

- PC : https://github.com/anonyme5575/Sperm/releases/download/moniteur-pc/MoniteurPC.exe
- Téléphone : https://github.com/anonyme5575/Sperm/releases/download/moniteur-pc/moniteur-pc.apk

## Installation

### Sur le PC (une fois)

1. Lance `MoniteurPC.exe` et accepte la demande de droits administrateur.
   - « Windows a protégé votre ordinateur » : **Informations complémentaires > Exécuter quand même** (l'exe n'est pas signé).
2. Il propose d'installer le pilote **PawnIO** : réponds **Oui**. C'est le pilote open source de LibreHardwareMonitor, nécessaire pour la température du processeur et les ventilateurs de la carte mère.
3. C'est tout : il ouvre le pare-feu pour le réseau local seulement, et se relance à chaque ouverture de session. Une bulle « Prêt » s'affiche près de l'horloge.

### Sur le téléphone

1. Installe `moniteur-pc.apk` (Gestionnaire de fichiers > Téléchargements > l'APK > Installer).
2. Ouvre **Moniteur PC** : il cherche le PC sur le Wi-Fi et s'y connecte. Si plusieurs PC répondent, choisis le tien.
3. Bouton **Retour** : chercher un autre PC, taper l'adresse à la main, ou arrêter la surveillance.

Par le câble USB plutôt que le Wi-Fi : `adb reverse tcp:8790 tcp:8790`, puis ouvre l'app.

## Ce qui s'affiche

- **En direct** : FPS du jeu (moyenne et « 1 % bas »), ronds CPU, température CPU, GPU, température GPU, RAM, VRAM, ventilateur GPU, réseau, puissance.
- **Composants** : système, disques, et chaque composant avec tous ses capteurs.
- **Alertes** : problèmes en cours et historique.

## Ce qui déclenche une alerte

| Alerte | Attention | Critique |
|---|---|---|
| Température CPU | 80 °C pendant 10 s | 90 °C |
| Température GPU (RX 580) | 78 °C pendant 10 s | 85 °C |
| Ventilateur GPU arrêté alors que le GPU dépasse 65 °C | | pendant 15 s |
| RAM | 90 % pendant 30 s | 97 % |
| Processeur à 95 % ou plus | pendant 1 min | |
| Disque plein | 90 % | 97 % |
| Disque trop chaud | 55 °C pendant 30 s | 65 °C |
| FPS sous 30 en jeu (GPU chargé à plus de 50 %) | pendant 10 s | |
| PC injoignable (sur le téléphone) | après 45 s | |

Le RX 580 arrête ses ventilateurs au repos : 0 tr/min n'est un problème que si le GPU chauffe. Les seuils se changent dans `C:\ProgramData\MoniteurPC\config.json` (quitte puis relance Moniteur PC).

## Menu de l'icône (clic droit, près de l'horloge)

- **Ouvrir sur ce PC** : la même page, dans le navigateur.
- **Adresse pour le téléphone** : à taper dans l'app si la recherche automatique ne trouve rien.
- **Démarrer avec Windows** : coché par défaut.
- **Quitter**.

## Si quelque chose manque

| Ce que tu vois | Cause | Solution |
|---|---|---|
| « PC introuvable » dans l'app | Moniteur PC fermé, ou téléphone sur un autre Wi-Fi | Vérifie l'icône près de l'horloge, puis **Réessayer** ; sinon tape l'adresse du menu de l'icône |
| « Température du processeur indisponible » | Pilote PawnIO refusé | Supprime `"pilote_refuse": true` de `config.json`, relance et réponds **Oui** |
| « Mesure des FPS : … » | PresentMon n'a pas démarré | Le message donne la raison exacte |
| « Pas de jeu détecté » en jeu | Le jeu n'est pas au premier plan | Clique dans la fenêtre du jeu |

## Développement

- `pc/` : l'exe Windows (C#, .NET 8, bibliothèque [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) 0.9.6). `pc/Core/` contient la logique testée sans Windows (FPS, alertes, format JSON).
- `web/index.html` : la page, incluse dans l'exe.
- `android/` : l'app (Java, compilée sans Android Studio par `android/build.sh`).
- `tests/` : `dotnet test moniteur/tests/MoniteurPC.Tests.csproj`.

Le workflow GitHub « Moniteur PC » lance les tests, compile l'exe sous Windows avec PresentMon et PawnIO inclus, vérifie qu'il démarre et lit des capteurs, compile l'APK, puis publie les deux dans la release `moniteur-pc`.

Composants tiers inclus dans l'exe : [PresentMon](https://github.com/GameTechDev/PresentMon) (Intel, licence MIT), [PawnIO](https://github.com/namazso/PawnIO) (installateur fourni par LibreHardwareMonitor), [LibreHardwareMonitorLib](https://github.com/LibreHardwareMonitor/LibreHardwareMonitor) (MPL 2.0).
