# Draft Lab — analyseur de draft League of Legends

Application de bureau (macOS + Windows) pour préparer et suivre une draft :
winrate estimé qui évolue à chaque pick, pentagone **Engage › Split › Poke › Protect › Catch › Engage**,
plan de jeu détaillé (scaling, Larves/Héraut, drakes, Baron)
et plusieurs familles de suggestions plutôt qu'une seule « bonne » réponse.

## Installer

**Windows** : dézippe `Draft Lab-1.0.0-win.zip`, lance `Draft Lab.exe`.
Windows SmartScreen peut afficher « application non reconnue » → *Informations complémentaires* → *Exécuter quand même*.

**macOS** : prends le zip `AppleSilicon` pour un Mac Apple Silicon (M1/M2/M3/M4), l'autre pour un Mac Intel.
Dézippe, glisse *Draft Lab.app* dans *Applications*. L'app n'est pas signée par un compte développeur Apple. La première fois : **clic droit → Ouvrir → Ouvrir**.
Si macOS refuse encore, ouvre le Terminal et tape :

```
xattr -cr "/Applications/Draft Lab.app"
codesign --force --deep --sign - "/Applications/Draft Lab.app"
```

## Utilisation

- Clique un champion dans la grille : il remplit l'étape en surbrillance (ordre de draft soloQ ou pro).
- Clique un slot (pick ou ban) pour le modifier, **clic droit** sur un ban ou **×** sur un pick pour le retirer.
- `Ctrl/Cmd + Z` annule, `Échap` désélectionne, `Entrée` dans la recherche prend le premier résultat.
- Le chiffre sur chaque portrait = winrate projeté de ton côté si tu prends ce champion maintenant.
- Choisis ton rôle par slot (le rôle se met à jour tout seul quand c'est logique).
- *Je suis* : côté bleu ou rouge, pour le plan de jeu.

### Les suggestions
| Groupe | Idée |
|---|---|
| Meilleur score global | ce que le modèle juge le plus fort à ce slot |
| Contrer | les 2 styles qui battent l'identité adverse dans le pentagone (gros et léger avantage) |
| Renforcer | rester cohérent avec ce que ton équipe a déjà |
| Plan B | ajouter un second axe pour ne pas être prévisible |
| Méta | ce qui est le plus joué (gol.gg + lolalytics) parmi les choix viables |

Pendant les bans : *plus grosse menace pour ta compo* et *bans méta*.

## Comment le pourcentage est calculé

Point de départ 50 %, puis :
- **Pentagone** (jusqu'à ±8 pts, ex. « ta compo de type Poke face à leur compo de type Engage ») : chaque style a un gros avantage sur le suivant et un léger avantage sur celui d'après (Engage › Split › Poke › Protect › Catch › Engage). On compare la répartition des deux équipes sur les 5 styles.
- **Clarté du plan** : une identité nette est un bonus.
- **Force des champions** : winrates soloQ lolalytics du patch, au rang choisi.
- **Pénalités** : dégâts tout AD ou tout AP, pas de ligne de front, aucun outil d'engage.

Le détail apparaît dans *Pourquoi ce pourcentage*. C'est une estimation de modèle, pas une prédiction certaine.
Les profils (Engage/Split/Poke/Protect/Catch, frontline, dégâts, scaling early/mid/late) de chaque champion sont dans `src/champdb.js` (modifiables). Un champion récent
absent de la liste est estimé automatiquement depuis ses tags Riot.

## Rôles et winrates : lolalytics + gol.gg mélangés

Les deux sources sont toujours combinées, dans les deux modes :
- **part de chaque rôle** = moyenne pondérée soloQ / pro (le pro ne compte qu'à partir de 30 games et pèse plus en mode pro) ;
- un champion n'est proposé à un rôle que si ce rôle représente **au moins 20 %** de ses games : pas de picks extrêmes
  (Vi ADC, Vel'Koz ADC, Hwei ADC…) ;
- **winrate** = 75 % soloQ + 25 % pro en mode soloQ (70 % pro + 30 % soloQ en mode pro), adouci à ±4 points autour de 50 %.

## Solo queue vs compétition pro

Le menu **Mode** change les données utilisées :
- **Solo queue (lolalytics)** : rôles et winrates soloQ du patch, au rang choisi, ordre de draft classé.
- **Compétition pro (gol.gg)** : un champion n'est proposé à un rôle que s'il y est vraiment joué en compétition
  (au moins 10 games et 10 % de ses picks pro). Hwei ou Vel'Koz ADC disparaissent donc des suggestions, Ziggs ADC reste.
  Winrates pro de la saison (lissés quand il y a peu de games), méta = picks pro, ordre de draft pro (bans en 2 phases).
  Les champions jamais joués en pro à un rôle sont grisés.

## Menu de départ

Au lancement (et avec **☰ Menu** ou **Nouvelle draft**) tu choisis :
- **Draft de zéro** : draft vierge, suggestions selon la méta, le pentagone et les synergies.
- **Draft depuis des joueurs** : tu colles les liens multi op.gg des deux équipes, ton côté, le mode, et l'app charge
  les pools avant d'ouvrir la draft.
Tu peux aussi y reprendre une draft sauvegardée.

## Joueurs (multi op.gg)

Ouvre **Joueurs (multi op.gg)** en haut, colle le lien multi op.gg de l'équipe 1 (côté bleu) et de l'équipe 2 (côté rouge),
ou une liste « Nom#TAG, Nom#TAG… », puis **Charger**. L'app récupère le rang et **tous les champions joués en ranked sur la saison**, puis garde ceux qui représentent
**au moins 1 % de ses games ranked**.
Seuls les champions joués à la **lane du joueur** sont gardés (au moins 20 % de leurs games soloQ à cette lane, ou joués à ce rôle en pro) : un joueur placé Support ne montre que ses supports. Les autres sont signalés « +N autres lanes ».
**dpm.lol** complète op.gg : l'app récupère aussi les champions joués en **Ranked Solo et en Flex** sur dpm.lol
(via une fenêtre de navigateur cachée, dpm.lol étant protégé par Cloudflare) et garde pour chaque champion le plus grand nombre
de games connu. Badge « dpm ✓ » sur le joueur quand c'est le cas ; un joueur jamais consulté sur dpm.lol n'y a pas encore de données.
Chaque pool est modifiable à la main (champ « + champion », clic sur un portrait pour le retirer), même si op.gg
ne trouve pas le joueur ou n'est pas accessible : il suffit de remplir les 5 lignes de chaque équipe.
Les joueurs sont placés dans l'ordre Top, Jungle, Mid, ADC, Support (rôle modifiable).

- Pick : quand le pool du joueur est connu, la première colonne devient **Picks prioritaires pour [joueur]** :
  ses champions passent devant (selon ses games et son winrate), les autres reculent nettement ; retirer un champion
  de son pool le fait donc descendre. Dans la grille, ★ = dans son pool, et l'ordre suit la même priorité.
- Colonne **Pool de [joueur]** et facteur **Maîtrise des joueurs** dans le pourcentage (plus de games et un bon winrate = bonus).
- Ban : colonne **Bans ciblés** = champions de confort des joueurs adverses qui sont aussi forts ce patch.
- **Picks adverses probables** : pour chaque rôle libre en face, les champions les plus susceptibles d'être pris, en %.
  Calcul : 75 % pool du joueur adverse (part de ses games) + 25 % popularité du champion à ce rôle (soloQ ou pro),
  le tout pondéré par la force du champion ce patch. Sans joueur chargé : uniquement la méta du rôle.
- **Drafts proposées pour les deux équipes** (ton équipe et l'adversaire), construites **uniquement avec les champions
  joués par chaque joueur à son rôle** (op.gg ou ajout manuel) : aucun pick inventé. Un rôle sans pool connu reste vide.
  Sous chaque draft, **Suggestions hors pool** : si un champion que le joueur ne joue pas ferait gagner au moins 1 point de
  winrate attendu (ou pour un rôle vide), il est proposé à part, la draft de base ne change pas.
  La carte Drafts proposées est la première sous la draft, avant le plan de jeu.
  Chaque draft a une analyse : identité, pentagone face à leur compo probable, fenêtre de force, phase à risque,
  synergie clé, objectifs, répartition des dégâts, condition de victoire, + analyse complète dépliable.
  Les champions voulus par les deux équipes sont marqués « contesté ».
- Algorithme : recherche en faisceau qui complète tes rôles libres en maximisant le
  **winrate attendu** face aux compos adverses les plus probables (la plus probable + une variante par rôle, pondérées).
  La première compo, **« Avec les champions de tes joueurs »**, n'utilise que les pools de tes joueurs ;
  suivent le meilleur score, une autre identité du pentagone et le confort des joueurs. Sous chaque compo :
  d'où vient chaque pick (pool du joueur ou méta). Bouton **Appliquer à ma draft**.
- **Bans conseillés** : probabilité qu'ils prennent le champion × gain qu'il leur apporterait.

op.gg n'a pas d'API publique : l'app utilise les mêmes données que leur site.

## Pronostic hors draft

Dès que les deux équipes ont des joueurs avec un rang op.gg (le rang réel du jeu, non modifiable),
l'app calcule une chance de victoire **sans tenir compte de la draft** :
- rang et LP (Fer IV = 0 … Diamant I = 2 700, Master+ = 2 800 + LP ; saison passée si non classé),
- winrate de la saison (lissé quand il y a peu de games),
- forme : série de victoires, vétéran, inactif,
- profondeur de pool à son rôle (champions avec au moins 10 games).

Les deux équipes reçoivent une note moyenne, convertie en probabilité (800 points d'écart ≈ 91 %).
Sous la barre principale : **Draft**, **Joueurs (hors draft)** et **Global** (les deux combinés). La grande barre affiche
alors le pronostic global. Le détail par joueur est dans la carte **Pronostic hors draft**.

## Mes drafts

**Mes drafts** en haut à droite : donne un nom et sauvegarde la draft (picks, bans, rôles, mode, joueurs chargés).
Même nom = mise à jour. Ouvrir / Supprimer depuis la liste.

## Synergies

Chaque synergie est décrite par son **mécanisme** et un **type** : synergie d’ultime, contrôles en chaîne, plongée / first target,
protection du carry, duo de lane, jungle + support, macro. Exemples : Nocturne + Orianna (Paranoïa + balle : Onde de choc depuis
l’obscurité), Camille + Galio (Ultimatum Hextech isole la cible, Galio atterrit dessus et provoque : kill sécurisé),
Malphite + Yasuo (Force imparable → Dernier souffle sur tous). Règles générales : balle d’Orianna sur un plongeur, atterrissage
de Galio sur un plongeur, projection + Yasuo/Yone (avec le sort exact), Pacte de Kalista, enchanteur + hyper-carry.
- Sous chaque champion pické : badges 🔗 avec ses partenaires de synergie.
- Les suggestions de pick indiquent la raison : synergie avec un champion déjà pris (ex. « 🛡 Hyper-carry protégée avec Jinx »)
  ou réponse au style adverse.
- Les synergies pèsent jusqu’à ±6 points dans le pourcentage.


Chaque paire de champions alliés peut avoir une synergie, comptée dans le pourcentage et affichée dans *Pourquoi ce pourcentage* :
- les combos de **ta feuille « Composition »** (Wukong + Orianna, Camille + Galio, Malphite + Yasuo…),
- les duos **ADC + support** et **jungle + support** du **guide support season 16**,
- des combos connus (Xayah + Rakan, Kalista + Rell…) et des règles (knock-up + Yasuo/Yone, ulti global + split push,
  hypercarry + enchanteur, engage + dégâts de zone).

Les suggestions ont une colonne **Synergie avec ta compo**, et au pick support une colonne **Contre leur support**
(counters du guide support). Le plan de jeu a une partie **Bot lane** (force de lane, portées ADC, comment jouer contre leur support).

## Plan de jeu

Calculé pour ton côté (*Je suis* en haut) à partir des rôles de chaque slot :
- **Identité** et plan B, avec la façon de jouer chaque style.
- **Pentagone** : ton avantage ou désavantage, et comment jouer contre leur style.
- **Scaling** : qui est le plus fort en early, mid et late, ton carry et leur menace long terme (+ graphique de puissance par minute).
- **Objectifs** : priorité Larves/Héraut (force du top + jungle en early), priorité drakes (bot + support + jungle), timing Baron (20 min) et Elder.
- **Plan par phase** : early, mid game, late.

## Plan de jeu visuel

La carte **Plan de jeu** est maintenant la première sous la draft. Ordre : carte + timeline, Early / Mid / Late, objectifs,
**pentagone (style contre style)**, synergies, identité, et en bas la **gestion de la lane bot** (matchup par niveau).

**Pentagone visuel** : type précis de chaque compo (ex. « Engage · Teamfight Dive / First Target », « Protect · Teamfight
Front to Back »), verdict au centre, top 3 des styles de chaque équipe avec les champions qui les portent, puis trois cartes :
*Ce que ça veut dire*, *Plan B* (style secondaire et son rapport face à leur compo), *Face à leur compo*.

- **Mini-carte** : chaque lane colorée (côté fort / égal / côté faible) avec les champions face à face, chemin conseillé du jungler.
- **Jungle et côtés** : où commencer et finir le premier clear, comparaison des junglers, côté où leur jungler va jouer.
- **Timeline des objectifs** (règles saison 16) : vague canon 4:30, drake 5:00, vague canon 7:30, Larves x3 à 8:00
  (despawn 14:45), 2e drake ~10:00, plaques T1 présentes toute la partie (et 3 plaques sur les T2/T3, saison 2026), Héraut 15:00, Baron 20:00, Elder après l’âme (toutes les 6 min).
- **Early / Mid / Late** : barre d’avantage, consignes par lane et **alternatives** (cross-map, lane swap, full clear…).
- **Drakes** : si l’adversaire outscale et que tu as la prio bot → stacker les drakes tôt pour l’âme (bonus permanent)
  (exécution sous 20 %) avant leur pic ; si tu outscale → ne pas forcer, juste refuser leur âme ; Vengeance draconique renforcée en 26.1.
- **Larves** : valeur réduite dans la méta actuelle (moins d’or, split moins rentable) ; à prendre seulement avec la prio top
  et un side-laner capable de convertir en tours, sinon à échanger contre un drake.
- **Héraut / Baron** selon la phase où ta compo est la plus forte. **Elder** : présenté de façon neutre, il profite à l’équipe
  en avance au moment où il apparaît, qu’elle soit early ou late.
- **Faux Nashor** : avec assez de vol de vie / soins (Aatrox, Swain, Samira, Soraka, Nami…), lancer le Baron pour forcer
  l’adversaire à venir et prendre le fight à PV pleins ; conditions et risques indiqués. Prévient aussi quand c’est l’adversaire qui peut le faire.

## Matchup bot par niveau

Dans le plan de jeu : pour le duo ADC + support de chaque équipe, puissance au **niveau 1, 2, 3, 6 et au 1er objet**
(barres bleu / rouge), qui a l’avantage, et un conseil précis à chaque étape : contrôle du buisson au niveau 1,
**course au niveau 2** (fin de la 1re vague + 3 mêlées de la 2e, ADC qui poussent vite, engage du support), fenêtre
d’all-in au niveau 3, pic d’ultimes au niveau 6, pic d’objet. Résumé : meilleure fenêtre de kill et moment dangereux,
plus la comparaison des portées et le profil de chaque champion. Notes estimées à partir des kits (fichier `src/botlevels.js`).

## Mise à jour automatique

- Au lancement, puis toutes les 2 h, l'app vérifie la dernière version sur **Riot Data Dragon**.
  Nouveau patch → champions, winrates et méta pro sont rechargés et un message s'affiche.
- **lolalytics** : rafraîchi toutes les 6 h. En début de patch, s'il n'y a pas encore assez de parties,
  l'app prend le patch précédent (indiqué au survol de la pastille *lolalytics*).
- **gol.gg** : rafraîchi toutes les 12 h (saison en cours, tous tournois).
- Bouton **⟳ Données** pour forcer. Hors ligne, l'app utilise le dernier cache.

Pastilles en haut : vert = données utilisables (mises à jour en silence), doré clignotant = premier chargement sans aucune donnée, jaune = hors ligne (cache), rouge = indisponible. L’pp est livrée avec des données pré-chargées : elle est utilisable tout de suite, même au tout premier lancement.

⚠️ lolalytics et gol.gg n'ont pas d'API publique officielle : l'app lit leurs pages / données publiques.
Si l'un d'eux change son format, sa pastille passe au rouge et l'app continue avec les autres sources
(il faudra alors adapter `providers/lolalytics.js` ou `providers/golgg.js`).

## Développement

```
npm install
npm start          # lancer l'app
npm run dist:mac   # .dmg (à lancer sur un Mac)
npm run dist:win   # installeur .exe (à lancer sur Windows)
```

Le workflow `.github/workflows/build.yml` construit automatiquement les versions Mac et Windows
si tu mets le projet sur GitHub (onglet *Actions* → artefacts à télécharger).

Draft Lab n'est pas affilié à Riot Games.

## Mises à jour automatiques de l'application

Draft Lab vérifie au démarrage puis toutes les 6 h s'il existe une nouvelle version sur GitHub (dépôt indiqué par `updateRepo` dans `package.json`).
Si oui, il la télécharge, vérifie son empreinte sha256, l'installe dans le dossier utilisateur et affiche « Nouvelle version installée — Redémarrer maintenant ».
La pastille `vX.Y.Z` en haut indique la version ; un clic relance une recherche.
Si une version téléchargée ne démarre pas, l'application revient automatiquement à la version livrée.

Publier une mise à jour :
1. augmenter `version` dans `package.json` ;
2. `node tools/build-update.mjs "Notes de version"` → écrit `release/latest.json` et `release/draftlab-<version>.json.gz` ;
3. commit + push sur `main` : les applis installées la récupèrent dans les 6 h (ou au prochain démarrage).

Seul un changement de version d'Electron demande de retélécharger l'application complète.

## Version 2.7 — retour à l’essentiel

- Une seule base de stats : soloQ Émeraude+ (lolalytics), complétée par gol.gg pour écarter les picks hors rôle. Plus de choix Pro / SoloQ ni de rang.
- La draft commence directement par les picks. Les bans sont conseillés à côté, par phase :
  phase 1 (avant les picks, 3 bans) et phase 2 (après les 3 premiers picks de chaque équipe, 2 bans),
  ciblés sur les champions que jouent leurs joueurs (op.gg) et sur ce qui bat la compo que tu veux jouer (pentagone). Un clic = ban.
- Analyse limitée au plan de jeu : lanes, jungle, phases, objectifs simplifiés (à prioriser / si gratuit / à laisser), pentagone, synergies.
- Pentagone : Protect devient Peeling. Courbe de scaling repliée, à ouvrir au clic (les deux compos, la tienne ou la leur).
- Retirés : drafts proposées, suggestions par pick, matchup bot par niveau, évolution du winrate, détail du pourcentage, pronostic hors draft détaillé.

## Version 2.12 — analyse Grandmaster+

- Force des champions : moitié Émeraude+, moitié Grandmaster+ (écart à la moyenne GM+). Le winrate pro (gol.gg, toute la saison) ne sert plus que de départage ; le pro garde son rôle pour les rôles et la présence.
- Face-à-face des lanes mesurés en GM+ (lolalytics, 30 derniers jours) : top, jungle, mid, et pour le bot ADC/support contre ADC/support. Lissés selon le nombre de games, ils corrigent le côté fort / faible du plan de jeu.
- Duos mesurés en GM+ (ex. Zeri + Yuumi, Ashe + Séraphine) : quand la donnée existe, la table de synergies théoriques pèse moins.
- Les % de winrate projeté sont de retour sur les portraits de la grille.
- Barre du haut réorganisée : identité (patch, version) · draft (type, côté, annuler, nouvelle draft) · outils (données, thème).
