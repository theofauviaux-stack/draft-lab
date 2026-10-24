// Synergies entre champions d'une même équipe, avec le MÉCANISME de chaque combo.
// Sources : feuille "Composition" de l'utilisateur, duos bot / jungle-support conseillés,
// combos connus, et règles générales (balle d'Orianna, atterrissage de Galio, projections + Yasuo/Yone…).
// Chaque synergie : { v (force), kind (type), title (titre court), why (explication), src }
import { COACH } from './coachdata.js';
import { fr, supPref } from './coach_fr.js';

export const KINDS = {
  ulti: { label: 'Synergie d’ultime', color: '#c8aa6e' },
  cc: { label: 'Contrôles en chaîne', color: '#5b8cff' },
  dive: { label: 'Plongée / first target', color: '#ff6b4a' },
  peel: { label: 'Protection du carry', color: '#5fe39a' },
  lane: { label: 'Duo de lane', color: '#46c8ff' },
  jgl: { label: 'Jungle + support', color: '#b65cff' },
  macro: { label: 'Macro', color: '#8a93a8' }
};

// ---- Combos détaillés (ta feuille + combos connus) ----
// [a, b, kind, force, titre, explication, source]
const COMBOS = [
  // Feuille "Composition"
  ['MonkeyKing', 'Orianna', 'ulti', 1.7, 'Cyclone + Onde de choc', 'Orianna pose la balle sur Wukong ; il plonge avec Cyclone (ultime) et projette tout le monde en l’air, Orianna enchaîne Onde de choc au même endroit : double contrôle de zone sur toute leur équipe.', 'ta feuille'],
  ['JarvanIV', 'Orianna', 'ulti', 1.7, 'Cataclysme + Onde de choc', 'Balle sur Jarvan, il entre avec Drapeau + Lance (E+Q), enferme leur équipe dans Cataclysme ; Onde de choc tombe au centre de l’arène : personne ne peut sortir.', 'ta feuille'],
  ['Nocturne', 'Orianna', 'ulti', 1.7, 'Paranoïa + balle', 'Paranoïa coupe leur vision, Nocturne fonce sur le carry avec la balle d’Orianna : Onde de choc arrive depuis l’obscurité, impossible à anticiper. First target garanti.', 'ta feuille'],
  ['XinZhao', 'Orianna', 'ulti', 1.6, 'Charge + Onde de choc', 'Balle sur Xin Zhao qui charge (E) la backline ; son ultime repousse les autres et isole le carry. En défense, Xin peel aussi avec son ultime : compo dive ou peel selon le fight.', 'ta feuille'],
  ['Ambessa', 'Orianna', 'ulti', 1.6, 'Dashes d’Ambessa + balle', 'Balle sur Ambessa (top ou jungle) : ses dashes et son ultime (attrape et supprime la cible) amènent la balle au cœur du fight, Onde de choc pour tout ceux autour.', 'ta feuille'],
  ['Camille', 'Galio', 'ulti', 1.7, 'Ultimatum + Héros en approche', 'Camille isole sa cible avec Ultimatum Hextech ; Galio atterrit dessus avec Héros en approche puis provoque (W) : la cible est enfermée, provoquée, et ne peut ni fuir ni être aidée. Sécurise un kill.', 'ta feuille'],
  ['JarvanIV', 'Galio', 'ulti', 1.6, 'Cataclysme + atterrissage', 'Jarvan enferme la cible dans Cataclysme, Galio atterrit dans l’arène et provoque tout le monde à l’intérieur : contrôle très long pour tuer en early-mid game.', 'ta feuille'],
  ['Ambessa', 'Galio', 'ulti', 1.6, 'Attrape + atterrissage', 'Ambessa attrape la cible avec son ultime, Galio suit avec Héros en approche et provoque : la cible attrapée ne peut plus s’échapper.', 'ta feuille'],
  ['Diana', 'Yasuo', 'cc', 1.5, 'Lune décroissante + Tornade', 'Diana regroupe leur équipe avec son ultime ; la Tornade (Q3) de Yasuo touche tout le monde d’un coup et ouvre Dernier souffle sur plusieurs cibles.', 'ta feuille'],
  ['Malphite', 'Yasuo', 'ulti', 1.8, 'Force imparable + Dernier souffle', 'Force imparable projette toute leur équipe en l’air : Yasuo déclenche Dernier souffle immédiatement sur tous ceux touchés. Le combo de teamfight le plus fort pour Yasuo.', 'ta feuille'],
  ['Ambessa', 'Vi', 'dive', 1.5, 'Double plongée', 'Vi verrouille la cible avec son ultime (imparable), Ambessa suit avec ses dashes et son ultime : first target garanti sur le carry adverse.', 'ta feuille'],
  ['Viego', 'Syndra', 'cc', 1.4, 'Étourdissement + resets', 'Syndra étourdit (E) et burst la première cible, Viego reset sur chaque kill et vole le corps : chaîne de picks dans le fight.', 'ta feuille'],
  ['KSante', 'Vi', 'dive', 1.5, 'Éjection + verrou', 'L’ultime de K’Santé éjecte la cible derrière sa propre équipe, Vi la verrouille avec son ultime : le carry est isolé de ses alliés.', 'ta feuille'],
  ['Ambessa', 'Akali', 'dive', 1.3, 'Isoler puis finir', 'Ambessa sort la cible de son équipe, Akali la finit dans son linceul (W) où personne ne la voit.', 'ta feuille'],
  ['KSante', 'Akali', 'dive', 1.3, 'Éjection + linceul', 'K’Santé éjecte la cible hors de son équipe, Akali la tue dans son linceul : pick sûr.', 'ta feuille'],
  ['Jinx', 'Lulu', 'peel', 1.6, 'Hyper-carry protégée', 'Lulu rend Jinx intouchable : bouclier (E), Vitesse d’attaque (W) et ultime contre les plongeurs. Jinx enchaîne ses resets (Excitation) sans mourir.', 'ta feuille'],
  ['Yunara', 'Lulu', 'peel', 1.6, 'Hyper-carry protégée', 'Lulu boost Yunara (W) et la sauve des plongeurs avec son ultime : l’ADC tape librement en fond de fight.', 'ta feuille'],
  ['Poppy', 'JarvanIV', 'cc', 1.4, 'Mur garanti', 'Jarvan crée un mur (Cataclysme ou Drapeau), Poppy y plaque la cible (E) : étourdissement garanti, engage early très fort.', 'ta feuille'],
  ['Kaisa', 'Neeko', 'dive', 1.4, 'Explosion + plongée', 'L’ultime de Neeko immobilise un groupe, Kai’Sa plonge avec son ultime sur la cible marquée : engage bot très létal.', 'ta feuille'],
  ['Kindred', 'Galio', 'macro', 1.2, 'Pick + suivi global', 'Kindred marque et chasse une cible, Galio arrive de n’importe où avec son ultime pour la sécuriser, et Kindred protège le fight avec son ultime.', 'ta feuille'],
  ['Yone', 'Sejuani', 'cc', 1.5, 'Glacier + Destin scellé', 'L’ultime de Sejuani étourdit la zone, Yone dash avec son ultime et projette tout le monde : engage en chaîne, first target.', 'ta feuille'],
  ['Rumble', 'Sejuani', 'cc', 1.4, 'Zone bloquée', 'Sejuani bloque leur équipe avec son ultime, Rumble pose Égaliseur dessus : énormes dégâts de zone sur des cibles immobiles.', 'ta feuille'],
  ['Rumble', 'Yone', 'cc', 1.3, 'Zone bloquée', 'Yone projette le groupe avec son ultime, Égaliseur de Rumble les brûle pendant qu’ils ne peuvent pas bouger.', 'ta feuille'],
  ['Sejuani', 'Leona', 'cc', 1.4, 'Engage en chaîne', 'Leona engage avec Éruption solaire, Sejuani enchaîne Glacier : leur équipe reste contrôlée plusieurs secondes.', 'ta feuille'],
  ['Yone', 'Leona', 'cc', 1.3, 'Engage en chaîne', 'Leona étourdit la zone avec son ultime, Yone entre derrière avec Destin scellé : chaîne de contrôles.', 'ta feuille'],
  // Combos connus
  ['Xayah', 'Rakan', 'lane', 1.6, 'Duo des amants', 'Rakan et Xayah se donnent des bonus mutuels : Rakan engage, Xayah suit avec ses plumes, et Rakan peut revenir vers elle de plus loin (W/E).', 'combo connu'],
  ['Kalista', 'Rell', 'ulti', 1.6, 'Pacte + Rell', 'Kalista lance Rell dans leur équipe avec Pacte (son ultime) : Rell atterrit et déclenche son engage (ultime/W) au milieu de la backline.', 'combo connu'],
  ['Kalista', 'Alistar', 'ulti', 1.5, 'Pacte + Concassage', 'Alistar est lancé par Pacte et atterrit avec Concassage (Q) : projection de toute la zone.', 'combo connu'],
  ['Kalista', 'Taric', 'ulti', 1.4, 'Pacte + invulnérabilité', 'Kalista lance Taric, son ultime rend les alliés invulnérables pendant l’engage.', 'combo connu'],
  ['Orianna', 'Malphite', 'ulti', 1.6, 'Force imparable + balle', 'Balle sur Malphite : Force imparable et Onde de choc tombent au même endroit, toute leur équipe est contrôlée.', 'combo connu'],
  ['Orianna', 'Hecarim', 'ulti', 1.5, 'Charge + balle', 'Hecarim charge dans la backline avec la balle d’Orianna : son ultime fait fuir, Onde de choc les ramène.', 'combo connu'],
  ['Orianna', 'Vi', 'ulti', 1.5, 'Verrou + balle', 'Vi verrouille le carry avec la balle sur elle : Onde de choc frappe le carry et ses protecteurs.', 'combo connu'],
  ['Orianna', 'Rakan', 'ulti', 1.5, 'Grande entrée + balle', 'Rakan plonge (W) avec la balle : projection et charme suivis de l’Onde de choc.', 'combo connu'],
  ['MasterYi', 'Taric', 'peel', 1.4, 'Yi invulnérable', 'Taric relie Yi (E) et le rend invulnérable avec son ultime pendant qu’il reset sur les kills.', 'combo connu'],
  ['Zeri', 'Lulu', 'peel', 1.4, 'Hyper-carry protégée', 'Lulu donne vitesse et bouclier à Zeri qui court autour du fight.', 'combo connu'],
  ['Zeri', 'Yuumi', 'peel', 1.3, 'Hyper-carry protégée', 'Yuumi rend Zeri très dure à tuer en late.', 'combo connu'],
  ['Twitch', 'Lulu', 'peel', 1.4, 'Embuscade boostée', 'Lulu boost Twitch (W) à la sortie de son invisibilité : il fond l’équipe adverse avec son ultime.', 'combo connu'],
  ['KogMaw', 'Lulu', 'peel', 1.5, 'Hyper-carry protégée', 'Lulu rend Kog’Maw intouchable : il tape de très loin avec Bio-arcane en sécurité.', 'combo connu'],
  ['Jhin', 'Zyra', 'cc', 1.2, 'Contrôles à distance', 'Les racines de Zyra préparent le W de Jhin (immobilisation) et son ultime.', 'combo connu'],
  ['Lucian', 'Nami', 'lane', 1.4, 'Trades explosifs', 'Le E de Nami sur Lucian ajoute des dégâts et ralentissements à chaque tir : trades très forts niveau 2-3.', 'combo connu'],
  ['Lucian', 'Braum', 'lane', 1.3, 'Passif de Braum', 'Les doubles tirs de Lucian appliquent vite le passif de Braum : étourdissement presque à chaque trade.', 'combo connu'],
  ['Ashe', 'Sejuani', 'cc', 1.2, 'Ralentissements = étourdissements', 'Les ralentissements d’Ashe déclenchent le passif de Sejuani (Permafrost) : étourdissements en chaîne.', 'combo connu'],
  ['Kennen', 'Sejuani', 'cc', 1.3, 'Engage de zone', 'Sejuani bloque le groupe, Kennen entre avec Maelström : toute leur équipe est étourdie.', 'combo connu'],
  ['Amumu', 'MissFortune', 'ulti', 1.5, 'Malédiction + Barrage', 'Amumu immobilise leur équipe avec son ultime, Miss Fortune canalise Barrage sans être interrompue.', 'combo connu'],
  ['Leona', 'MissFortune', 'ulti', 1.4, 'Éruption + Barrage', 'Leona étourdit la zone, Miss Fortune canalise Barrage sur des cibles immobiles.', 'combo connu']
];

// Champions qui portent bien la balle d'Orianna / qu'on suit avec Galio (plongeurs)
const BALL_CARRIERS = new Set(['MonkeyKing', 'JarvanIV', 'Nocturne', 'XinZhao', 'Ambessa', 'Vi', 'Malphite', 'Hecarim', 'Rakan', 'Diana',
  'Camille', 'Sejuani', 'Zac', 'Rell', 'Alistar', 'Nautilus', 'Leona', 'Skarner', 'Kennen', 'Irelia', 'LeeSin', 'Volibear', 'Warwick', 'Briar']);
const GALIO_TARGET = new Set(['Camille', 'Vi', 'Nocturne', 'JarvanIV', 'Ambessa', 'XinZhao', 'Hecarim', 'LeeSin', 'Diana', 'Irelia',
  'Rakan', 'Leona', 'Nautilus', 'Rell', 'Warwick', 'Briar', 'Skarner', 'Volibear', 'MonkeyKing', 'Kindred', 'Pantheon', 'TwistedFate']);
// Projections en l'air utilisables par Yasuo / Yone, avec le sort
const KNOCKUP = {
  Malphite: 'Force imparable (R)', Alistar: 'Concassage (Q)', Rakan: 'Grande entrée (W)', Rell: 'son W', MonkeyKing: 'Cyclone (R)',
  JarvanIV: 'Drapeau + Lance (E+Q)', Gragas: 'Coup de bide (E)', Nautilus: 'Charge des profondeurs (R)', Ornn: 'Appel du Dieu forgeron (R)',
  Zac: 'Bond élastique (E)', Vi: 'Assaut et batterie (R)', Janna: 'Tourbillon (Q)', LeeSin: 'Rage du dragon (R)', Kalista: 'Pacte (R)',
  Sejuani: 'Assaut arctique (Q)', Skarner: 'son ultime', Poppy: 'Garde-fou (R)', Yone: 'Destin scellé (R)', Yasuo: 'Tornade (Q3)',
  KSante: 'ses sorts', Ambessa: 'ses dashes', Aurora: 'son Q', Gnar: 'GNAR ! (R)', Tristana: 'Tir explosif (R) qui repousse', Thresh: 'Flagellation (E)'
};
const GLOBAL = { Shen: 'Rempart éternel', TwistedFate: 'Destinée', Galio: 'Héros en approche', Pantheon: 'Assaut céleste', Ryze: 'Distorsion', Nocturne: 'Paranoïa', Karthus: 'Requiem', Soraka: 'Souhait', Taliyah: 'Remparts tissés' };
const AOE = new Set(['Orianna', 'MissFortune', 'Kennen', 'Seraphine', 'Rumble', 'Neeko', 'Amumu', 'Galio', 'Sett', 'Hwei', 'Yasuo',
  'Yone', 'Annie', 'Brand', 'Fiddlesticks', 'Diana', 'Lillia', 'Sona', 'Azir', 'AurelionSol', 'Mel', 'Ziggs', 'Karthus']);
const KALISTA_SUPS = new Set(['Rell', 'Alistar', 'Taric', 'Nautilus', 'Leona', 'Thresh', 'Braum', 'Poppy', 'Rakan']);

const key = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
// ---- Interactions mécaniques (kits qui se déclenchent l'un l'autre) ----
// Champions qui enchaînent beaucoup d'attaques / d'effets à l'impact en peu de temps
const MULTI_HIT = { Belveth: 'ses attaques en rafale (E « Tourbillon »)', MasterYi: 'Frappe Alpha et ses attaques rapides', KogMaw: 'ses attaques bio-arcaniques', Kaisa: 'ses attaques rapides', Zeri: 'ses tirs rapides', Jinx: 'sa minigun', Twitch: 'ses attaques empoisonnées', Vayne: 'ses attaques rapides', Kalista: 'ses lances rapides', Kindred: 'ses attaques rapides', Xayah: 'ses plumes', Yunara: 'ses attaques rapides', Nilah: 'ses attaques et son Q', Jax: 'ses attaques (Riposte)', Fiora: 'ses attaques rapides', Katarina: 'son ultime Lotus mortel (applique les effets à l’impact)', Varus: 'ses attaques chargées', Sivir: 'son W qui rebondit', Aphelios: 'ses attaques', Gwen: 'ses coups de ciseaux', Viego: 'ses attaques', Briar: 'sa frénésie', Udyr: 'ses attaques', Warwick: 'ses attaques', Yasuo: 'ses Q et attaques', Yone: 'ses attaques', Tristana: 'ses attaques rapides' };
// Champions qui ralentissent de façon fiable (pour les combos « ralenti → immobilisé »)
const SLOWERS = { Ashe: 'chaque auto-attaque (Tir de givre)', Nasus: 'Dépérissement (W)', Lulu: 'Lance-étincelles (Q)', Zilean: 'Distorsion temporelle (E)', Sejuani: 'Courroux hivernal', Trundle: 'Pilier de glace', Nunu: 'boule de neige (W)', Varus: 'Corruption (E)', Ryze: 'Flux runique', Rumble: 'Électro-harpon (E)', Swain: 'Nevermove', Taliyah: 'Remparts tissés', Lissandra: 'Éclat de glace (Q)', Anivia: 'Gelure', Singed: 'Colle (W)', Cassiopeia: 'Miasme (W)', Karma: 'Flamme intérieure (Q)', Malphite: 'Fracas sismique', Zyra: 'Racines épineuses' };
function mechanics(x, y) {
  const out = [];
  if ((y.id === 'Braum') && MULTI_HIT[x.id]) out.push({ v: 1.4, kind: 'cc', title: 'Coups commotionnants', why: `Le passif de Braum se charge avec les attaques de ses alliés : ${x.name} pose les 4 marques très vite avec ${MULTI_HIT[x.id]}, la cible est étourdie presque à chaque engage.`, src: 'interaction de kits' });
  if ((y.id === 'Sejuani') && MULTI_HIT[x.id]) out.push({ v: 1.4, kind: 'cc', title: 'Gel permanent', why: `Le passif de Sejuani fait geler la cible avec les attaques des alliés proches : ${x.name} applique le Givre en un instant avec ${MULTI_HIT[x.id]}, et Sejuani déclenche l’étourdissement (E) en boucle.`, src: 'interaction de kits' });
  if (y.id === 'Seraphine' && SLOWERS[x.id] && x.id !== 'Seraphine') out.push({ v: 1.35, kind: 'cc', title: 'Ralenti → immobilisé', why: `${x.name} ralentit avec ${SLOWERS[x.id]} : le E de Séraphine (Coup de basse) enracine une cible déjà ralentie au lieu de la ralentir, et l’étourdit si elle est déjà immobilisée. Un seul E suffit à verrouiller la cible.`, src: 'interaction de kits' });
  if (y.id === 'Yuumi' && MULTI_HIT[x.id]) out.push({ v: 1.1, kind: 'peel', title: 'Yuumi sur un hyper-attaquant', why: `Yuumi s’attache à ${x.name} : soins et vitesse d’attaque pendant que ${MULTI_HIT[x.id]} déchire la cible, très difficile à tuer.`, src: 'interaction de kits' });
  if (y.id === 'Taric' && ['MasterYi', 'Ekko', 'Belveth', 'Kayn', 'Hecarim', 'JarvanIV', 'Vi', 'Nocturne'].includes(x.id)) out.push({ v: 1.2, kind: 'dive', title: 'Lien de Taric', why: `Taric se lie à ${x.name} (W) : son étourdissement part aussi de ${x.name}, et l’invulnérabilité (R) protège la plongée.`, src: 'interaction de kits' });
  return out;
}

const TABLE = new Map();
for (const [a, b, kind, v, title, why, src] of COMBOS) TABLE.set(key(a, b), { v, kind, title, why, src });

// Duo bot du guide (ADC + support)
const BOT = new Map();
for (const [adc, d] of Object.entries(COACH.adc)) {
  d.sup.forEach((s, i) => BOT.set(`${adc}|${s}`, { v: 1.4 - Math.min(i, 8) * 0.08, type: supPref(d.type), rank: i + 1 }));
}
// Duo jungle-support du guide : ne compte que si le champion est vraiment joué jungle
const JUNGLE = new Map();
for (const [jg, d] of Object.entries(COACH.jungle)) {
  d.sup.forEach((s, i) => JUNGLE.set(`${jg}|${s}`, { v: 0.9 - Math.min(i, 8) * 0.05, early: d.early, rank: i + 1 }));
}

// Rôle réel dans la draft (c.lane) quand on le connaît, sinon rôle principal du champion
const is = (c, r) => (c.lane ? c.lane === r : c.roles?.[0] === r);
// Synergie d'une paire (a, b = profils de champions) : la plus forte trouvée, avec son mécanisme.
// Les duos de lane (bot) et jungle-support ne comptent que si les champions jouent vraiment ces lanes.
export function pair(a, b) {
  if (a.id === b.id) return null;
  const hits = [];
  let t = TABLE.get(key(a.id, b.id));
  if (t && t.kind === 'lane' && !((is(a, 'A') && is(b, 'S')) || (is(a, 'S') && is(b, 'A')))) t = null;
  if (t && t.kind === 'jgl' && !((is(a, 'J') && is(b, 'S')) || (is(a, 'S') && is(b, 'J')))) t = null;
  if (t) hits.push(t);
  for (const [x, y] of [[a, b], [b, a]]) {
    hits.push(...mechanics(x, y));
    const bt = is(x, 'A') && is(y, 'S') ? BOT.get(`${x.id}|${y.id}`) : null;
    if (bt) hits.push({ v: bt.v, kind: 'lane', title: 'Duo bot conseillé', why: `${y.name} fait partie des ${bt.rank <= 5 ? 'meilleurs supports' : 'supports conseillés'} de ${x.name} (n°${bt.rank} de sa liste ; ${x.name} préfère en général un support ${bt.type}) : la lane gagne ses trades et contrôle la vague pour le drake.`, src: 'duo conseillé' });
    const jg = JUNGLE.get(`${x.id}|${y.id}`);
    if (jg && is(x, 'J') && is(y, 'S')) hits.push({ v: jg.v, kind: 'jgl', title: 'Duo jungle-support', why: `${y.name} est un des meilleurs supports pour ${x.name} (n°${jg.rank}) : roams, vision et ganks synchronisés autour des objectifs.`, src: 'duo conseillé' });
    if (x.id === 'Orianna' && BALL_CARRIERS.has(y.id) && !t) hits.push({ v: 1.2, kind: 'ulti', title: 'Balle d’Orianna', why: `Orianna pose sa balle sur ${y.name} qui plonge : Onde de choc part du milieu de leur équipe.`, src: 'règle' });
    if (x.id === 'Galio' && GALIO_TARGET.has(y.id) && !t) hits.push({ v: 1.1, kind: 'ulti', title: 'Atterrissage de Galio', why: `Galio atterrit sur ${y.name} quand il engage (Héros en approche) puis provoque : la cible ne peut plus s’échapper.`, src: 'règle' });
    if ((x.id === 'Yasuo' || x.id === 'Yone') && KNOCKUP[y.id] && !t) hits.push({ v: 1.3, kind: 'ulti', title: 'Projection + ultime', why: `${y.name} projette en l’air avec ${KNOCKUP[y.id]} : ${x.name} déclenche son ultime sur tous les ennemis touchés.`, src: 'règle' });
    if (x.id === 'Kalista' && KALISTA_SUPS.has(y.id) && is(x, 'A') && is(y, 'S') && !t) hits.push({ v: 1.2, kind: 'ulti', title: 'Pacte de Kalista', why: `Kalista lance ${y.name} dans leur équipe avec son ultime : engage depuis une distance imprévisible.`, src: 'règle' });
    if (GLOBAL[x.id] && y.s >= 3) hits.push({ v: 0.8, kind: 'macro', title: 'Ulti global + split', why: `${y.name} split en side lane, ${x.name} le rejoint avec ${GLOBAL[x.id]} : 2v1 ou 4v4 ailleurs. Moins rentable dans la méta actuelle où le split paie moins.`, src: 'règle' });
    if (is(y, 'A') && y.scale === 3 && is(x, 'S') && x.d >= 3 && x.f < 2 && !t) hits.push({ v: 0.9, kind: 'peel', title: 'Hyper-carry protégé', why: `${x.name} protège ${y.name} (boucliers, soins, désengage) jusqu’à son pic de puissance en late.`, src: 'règle' });
    if (x.e >= 3 && x.f >= 2 && AOE.has(y.id) && !t) hits.push({ v: 0.7, kind: 'cc', title: 'Engage + zone', why: `${x.name} engage et regroupe, ${y.name} enchaîne ses dégâts de zone sur des cibles contrôlées.`, src: 'règle' });
  }
  if (!hits.length) return null;
  hits.sort((x, y) => y.v - x.v);
  const best = hits[0];
  const others = hits.slice(1).filter((h) => h.title !== best.title).map((h) => h.title);
  return { ...best, extra: [...new Set(others)] };
}

// Toutes les paires synergiques d'une équipe
export function teamSynergy(team) {
  const pairs = [];
  for (let i = 0; i < team.length; i++)
    for (let j = i + 1; j < team.length; j++) {
      const p = pair(team[i], team[j]);
      if (p) pairs.push({ a: team[i], b: team[j], ...p });
    }
  pairs.sort((x, y) => y.v - x.v);
  // rendements décroissants : la 3e, 4e paire comptent moins
  const total = pairs.reduce((s, p, i) => s + p.v * (i < 2 ? 1 : 0.5), 0);
  return { total, pairs };
}

// Bonus de synergie qu'apporte un candidat à une équipe
export function synergyWith(cand, team) {
  let v = 0;
  const why = [], list = [];
  for (const m of team) {
    const p = pair(cand, m);
    if (p) { v += p.v; why.push(`${m.name} : ${p.title}`); list.push({ with: m, ...p }); }
  }
  list.sort((a, b) => b.v - a.v);
  return { v, why, list };
}
