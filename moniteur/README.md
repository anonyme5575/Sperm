# Moniteur PC

Affiche sur le téléphone les **FPS**, les **températures**, les **charges** et le détail des **composants** du PC. Il **prévient en cas de problème** : bandeau, son et vibration sur la page, et en option une notification push même quand la page n'est pas affichée.

- **En direct** : FPS du jeu (moyenne et « 1 % bas »), ronds CPU, température CPU, GPU, température GPU, RAM et VRAM, ventilateur GPU, réseau, puissance.
- **Composants** : système, disques, et chaque composant avec tous ses capteurs (températures, charges, ventilateurs, fréquences, puissances, tensions).
- **Alertes** : problèmes en cours, historique, réglage des notifications.

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
| PC injoignable (planté, éteint, câble débranché) | | après 5 s |

Le RX 580 arrête ses ventilateurs au repos : un ventilateur à 0 tr/min ne déclenche une alerte que si le GPU chauffe. Les seuils se changent dans `moniteur-config.json`, créé à côté de l'exe au premier lancement (relance l'exe après modification).

## Installation sur le PC

1. **LibreHardwareMonitor** (lit les capteurs) : télécharge la dernière version sur https://github.com/LibreHardwareMonitor/LibreHardwareMonitor/releases, dézippe, puis lance `LibreHardwareMonitor.exe` **en administrateur** (clic droit > Exécuter en tant qu'administrateur). Dans le menu **Options**, active :
   - **Remote Web Server > Run** ;
   - **Run On Windows Startup** et **Start Minimized**.
2. **Moniteur PC** : télécharge `MoniteurPC.exe` sur https://github.com/anonyme5575/Sperm/releases/download/moniteur-pc/MoniteurPC.exe et range-le dans un dossier à lui, par exemple `Bureau\duo\moniteur`.
3. Lance `MoniteurPC.exe` et accepte la demande de droits administrateur (nécessaire pour mesurer les FPS). Au premier lancement, il télécharge **PresentMon**, l'outil open source d'Intel qui mesure les FPS.
   - Si Windows affiche « Windows a protégé votre ordinateur » : **Informations complémentaires > Exécuter quand même**. L'exe n'est pas signé, c'est ce qui déclenche l'avertissement.
4. **Démarrage automatique** (une fois) : dans un terminal ouvert dans ce dossier, `.\MoniteurPC.exe --demarrage`. Pour l'enlever : `.\MoniteurPC.exe --retirer-demarrage`.

## Sur le téléphone

**Par le câble USB** (débogage USB activé) :

```
adb reverse tcp:8790 tcp:8790
```

puis ouvre **http://localhost:8790** dans Chrome. Par le câble, l'écran reste allumé tant que la page est affichée.

**Par le Wi-Fi** : ouvre l'adresse affichée dans la fenêtre du Moniteur PC (`http://192.168.x.x:8790`) et autorise l'accès « réseau privé » quand le pare-feu Windows le demande.

Dans Chrome, **⋮ > Ajouter à l'écran d'accueil** pour l'ouvrir comme une app, en plein écran.

### Rebrancher sans retaper la commande

Le fichier `tunnel-usb.bat` du dossier `duo` peut refaire le tunnel à chaque branchement : remplace ses lignes `adb reverse` par `adb reverse tcp:8790 tcp:8790`.

### Notifications push

Onglet **Alertes > Activer les notifications push**, puis installe l'app **ntfy** (Play Store, gratuite et open source) et abonne-toi au sujet affiché. Les alertes arrivent alors comme des notifications normales, même téléphone verrouillé. Seuls le titre et le texte de l'alerte passent par le serveur ntfy.sh ; le sujet est un nom aléatoire que personne d'autre ne connaît.

## Si quelque chose manque

| Ce que tu vois | Cause | Solution |
|---|---|---|
| « Températures indisponibles » | LibreHardwareMonitor fermé, sans serveur web, ou sans droits admin | Relance-le en administrateur, active **Remote Web Server > Run** |
| « Mesure des FPS : … » | PresentMon pas lancé | Lance `MoniteurPC.exe` en administrateur ; le message affiché donne la raison exacte |
| « Pas de jeu détecté » en jeu | Le jeu n'est pas au premier plan ou n'affiche rien | Clique dans la fenêtre du jeu |
| « PC injoignable » | Moniteur fermé, tunnel USB perdu ou Wi-Fi coupé | Relance l'exe ou refais `adb reverse` |

## Développement

```
pip install psutil
python moniteur/agent.py            # lance le serveur (FPS seulement sous Windows)
python -m unittest moniteur/test_agent.py
```

Le workflow GitHub « Moniteur PC » lance les tests, compile `MoniteurPC.exe` sous Windows, vérifie qu'il démarre et le publie dans la release `moniteur-pc`.
