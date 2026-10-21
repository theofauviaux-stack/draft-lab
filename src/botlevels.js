// Matchup bot par niveau : puissance de l'ADC et du support aux niveaux 1, 2, 3, 6 et au 1er objet.
// Notes de 0 (très faible) à 3 (très fort), estimées à partir des kits et du guide support.
// [niv1, niv2, niv3, niv6, 1er objet, note]
import { ADC_RANGE, rangeValue } from './coachdata.js';

const ADC = {
  Aphelios: [1, 1, 2, 2, 2, 'faible tant qu’il n’a pas ses bonnes armes, monte avec les objets'],
  Ashe: [2, 2, 2, 3, 2, 'ralentissement permanent, son ultime au niveau 6 est un engage à distance'],
  Caitlyn: [3, 3, 2, 2, 3, 'portée 650 : domine les niveaux 1-3 au harcèlement et prend les plaques'],
  Corki: [1, 2, 2, 2, 3, 'pic au Paquet spécial et au 1er objet'],
  Draven: [3, 3, 3, 3, 3, 'le plus gros all-in early grâce aux haches'],
  Ezreal: [1, 2, 2, 2, 2, 'lane sûre, peu de kill pressure avant son 1er objet'],
  Jhin: [2, 3, 3, 3, 3, '4e tir + racine (W) dès le niveau 2, ultime au 6 pour finir'],
  Jinx: [1, 1, 1, 2, 2, 'faible en early, monte avec les objets et les resets'],
  Kaisa: [1, 2, 2, 3, 2, 'ultime au niveau 6 pour plonger avec le support'],
  Kalista: [3, 3, 3, 3, 2, 'très forte niveaux 1-3, ultime avec son support au 6'],
  KogMaw: [1, 1, 1, 2, 2, 'très faible en early, à protéger'],
  Lucian: [3, 3, 3, 2, 3, 'trades explosifs niveaux 1-3, très fort avec un enchanteur'],
  MissFortune: [2, 3, 3, 3, 2, 'harcèlement avec le Q, ultime dévastateur au 6 avec un engage'],
  Nilah: [1, 2, 3, 3, 2, 'mêlée : veut l’all-in au niveau 3'],
  Samira: [2, 2, 3, 3, 3, 'all-in au niveau 3, ultime au 6 avec un support engage'],
  Senna: [2, 2, 2, 2, 2, 'harcèlement constant, scaling avec les âmes'],
  Sivir: [1, 2, 2, 2, 2, 'nettoyage de vague : prend la prio, peu de kill pressure'],
  Smolder: [1, 1, 1, 1, 2, 'scaling sur ses stacks, survit en early'],
  Tristana: [2, 2, 3, 3, 2, 'all-in avec le saut dès le niveau 2-3'],
  Twitch: [1, 2, 2, 3, 2, 'embuscades, ultime au 6'],
  Varus: [2, 3, 3, 3, 2, 'harcèlement au Q, ultime au 6 = engage'],
  Vayne: [1, 1, 2, 2, 2, 'faible à distance en early, survit jusqu’aux objets'],
  Xayah: [2, 2, 2, 3, 2, 'ultime au 6 qui esquive l’engage'],
  Yunara: [1, 2, 2, 2, 2, 'lane stable, scaling'],
  Zeri: [1, 1, 2, 2, 2, 'faible avant le 1er objet'],
  Ziggs: [2, 2, 2, 2, 2, 'harcèlement et destruction de tours'],
  Karthus: [1, 1, 2, 2, 2, 'faible en early en bot'],
  Mel: [2, 2, 3, 3, 2, 'harcèlement de mage, renvoie les projectiles']
};
const SUP = {
  Alistar: [1, 2, 3, 3, 2, 'combo W+Q dès le niveau 2', true],
  Bard: [1, 2, 2, 2, 2, 'roams, étourdissement contre un mur', false],
  Blitzcrank: [2, 3, 3, 3, 2, 'un hook = un kill dès le niveau 2', true],
  Brand: [2, 2, 3, 3, 3, 'harcèlement + burst au niveau 3', false],
  Braum: [2, 2, 2, 3, 2, 'passif très fort avec un ADC qui attaque vite', false],
  Janna: [1, 1, 1, 2, 1, 'désengage, peu de pression', false],
  Karma: [3, 3, 3, 3, 2, 'Q renforcé au niveau 1 : domine le début de lane', false],
  Leona: [2, 3, 3, 3, 2, 'engage Q+E au niveau 2, ultime au 6', true],
  Lulu: [2, 2, 2, 3, 2, 'trades courts, ultime au 6 contre l’all-in', false],
  Lux: [2, 2, 3, 3, 3, 'harcèlement + racine', false],
  Milio: [1, 1, 2, 2, 1, 'faible en early, retire les contrôles au 6', false],
  Morgana: [1, 2, 2, 2, 2, 'racine + bouclier anti-contrôle', false],
  Nami: [2, 2, 3, 3, 2, 'E sur l’ADC = trades gagnants', false],
  Nautilus: [2, 3, 3, 3, 2, 'all-in niveaux 2-3, ultime au 6', true],
  Neeko: [2, 2, 3, 3, 2, 'racine + burst, engage au 6', true],
  Pantheon: [3, 3, 3, 3, 2, 'très fort niveaux 1-3', true],
  Poppy: [2, 2, 3, 3, 2, 'anti-dash, mur', true],
  Pyke: [2, 3, 3, 3, 2, 'hook + exécution au 6', true],
  Rakan: [1, 2, 3, 3, 2, 'engage W au niveau 2-3', true],
  Rell: [2, 3, 3, 3, 2, 'engage dès le niveau 2', true],
  Renata: [1, 2, 2, 3, 2, 'ultime au 6 qui retourne un fight', false],
  Senna: [2, 2, 2, 2, 2, 'harcèlement constant', false],
  Seraphine: [2, 2, 2, 3, 2, 'harcèlement, ultime au 6', false],
  Sona: [1, 1, 2, 3, 2, 'faible en early, pic au 6', false],
  Soraka: [1, 1, 2, 2, 1, 'soins, faible face à l’all-in', false],
  TahmKench: [2, 3, 3, 3, 2, 'avale son ADC, étourdit au 3e passif', true],
  Taric: [1, 2, 3, 3, 2, 'étourdissement + invulnérabilité au 6', true],
  Thresh: [2, 3, 3, 3, 2, 'hook + lanterne dès le niveau 2', true],
  Velkoz: [2, 2, 3, 3, 3, 'harcèlement à longue portée', false],
  Xerath: [2, 2, 3, 3, 3, 'harcèlement à très longue portée', false],
  Yuumi: [0, 1, 1, 2, 1, 'très faible en early', false],
  Zilean: [0, 1, 2, 2, 1, 'faible en early, réanimation au 6', false],
  Zyra: [3, 3, 3, 3, 2, 'plantes : domine le niveau 1', false],
  Swain: [1, 2, 3, 3, 2, 'racine + sustain au 6', true],
  Maokai: [1, 2, 2, 2, 2, 'engage, peu de dégâts', true],
  Camille: [2, 2, 3, 3, 2, 'engage E au niveau 2-3', true]
};
// ADC qui poussent vite la vague (course au niveau 2)
const FAST_PUSH = new Set(['Sivir', 'Ziggs', 'Caitlyn', 'Jhin', 'MissFortune', 'Varus', 'Draven', 'Lucian', 'Kalista', 'Corki', 'Smolder', 'Mel']);

const fallback = (c, adc) => {
  const s = c.scale ?? 2;
  const base = s === 1 ? [3, 3, 3, 2, 2] : s === 3 ? [1, 1, 2, 2, 2] : [2, 2, 2, 3, 2];
  return [...base, 'profil estimé', adc ? false : c.e >= 2];
};
const prof = (c, adc) => (adc ? ADC[c.id] : SUP[c.id]) ?? fallback(c, adc);

const LEVELS = [
  { i: 0, name: 'Niveau 1', when: '1:30 – 1:50' },
  { i: 1, name: 'Niveau 2', when: 'fin de la 1re vague + 3 mêlées de la 2e' },
  { i: 2, name: 'Niveau 3', when: '~3:00' },
  { i: 3, name: 'Niveau 6', when: '~7:30 – 8:00' },
  { i: 4, name: '1er objet', when: '~10 – 12 min' }
];

export function botMatchup(mine, theirs) {
  const get = (r, role) => r.find((x) => x.role === role)?.c;
  const mA = get(mine, 'A'), mS = get(mine, 'S'), tA = get(theirs, 'A'), tS = get(theirs, 'S');
  if (!(mA || mS) || !(tA || tS)) return null;
  const duo = (a, s) => LEVELS.map((L) => ((a ? prof(a, true)[L.i] : 1.5) + (s ? prof(s, false)[L.i] : 1.5)));
  const md = duo(mA, mS), td = duo(tA, tS);
  const mEng = mS ? prof(mS, false)[6] : false, tEng = tS ? prof(tS, false)[6] : false;
  const rows = LEVELS.map((L, k) => {
    const diff = md[k] - td[k];
    const who = diff >= 1 ? 'mine' : diff <= -1 ? 'theirs' : 'even';
    let tip;
    if (k === 0) tip = who === 'mine' ? 'Trade dès le niveau 1 et prends le contrôle du buisson de la lane.'
      : who === 'theirs' ? 'Reste derrière la vague, laisse ton support warder le buisson, ne prends pas de trade.'
        : 'Niveau 1 équilibré : farm proprement et prépare la course au niveau 2.';
    if (k === 1) {
      const mPush = mA && FAST_PUSH.has(mA.id), tPush = tA && FAST_PUSH.has(tA.id);
      const race = mPush && !tPush ? 'mine' : tPush && !mPush ? 'theirs' : 'even';
      tip = race === 'mine' ? `Tu atteins le niveau 2 en premier (${mA.name} pousse vite) : ` : race === 'theirs' ? `Ils atteignent le niveau 2 en premier (${tA.name} pousse vite) : ` : 'Course au niveau 2 serrée : ';
      if (race !== 'theirs' && mEng && who !== 'theirs') tip += `${mS.name} peut engager dès que tu passes niveau 2.`;
      else if (race !== 'mine' && tEng) tip += `attention à l’engage de ${tS.name} au niveau 2 : recule d’un pas juste avant qu’ils passent niveau 2.`;
      else tip += who === 'mine' ? 'trade sur ton avance de niveau.' : who === 'theirs' ? 'ne reste pas à portée quand ils passent niveau 2.' : 'joue le timing de vague.';
    }
    if (k === 2) tip = who === 'mine' ? 'Fenêtre d’all-in : avec tous tes sorts tu gagnes le combat 2v2, cherche le kill avec le jungler.'
      : who === 'theirs' ? 'C’est leur fenêtre d’all-in : joue près de ta tour, garde flash pour leur engage.' : 'All-in au niveau 3 à éviter sauf erreur adverse : celui qui a le plus de PV gagne.';
    if (k === 3) {
      const ults = [mA, mS].filter(Boolean).map((c) => prof(c, c === mA)[5]).filter((t) => /ultime/.test(t));
      tip = who === 'mine' ? `Ton pic du niveau 6 : ${ults[0] ?? 'tes ultimes'} — force le fight bot et le drake.`
        : who === 'theirs' ? `Leur pic au niveau 6 (${[tA, tS].filter(Boolean).map((c) => c.name).join(' + ')} avec leurs ultimes) : reset juste avant leur niveau 6, joue sous ta tour et garde flash.`
          : 'Niveau 6 équilibré : le premier qui a son ultime avec vision sur le jungler gagne.';
    }
    if (k === 4) tip = who === 'mine' ? 'Ton duo prend l’avantage au 1er objet : trade dès que tu l’as, puis rotation pour le drake ou la tour.'
      : who === 'theirs' ? 'Leur duo est plus fort au 1er objet : rappelle-toi en même temps qu’eux, sinon tu te fais pousser sous tour.' : 'Pics d’objets proches : le duo qui reset au bon moment prend l’avantage.';
    return { ...LEVELS[k], mine: md[k], theirs: td[k], diff, who, tip };
  });
  const notes = [];
  if (mA && tA && rangeValue(mA.id) && rangeValue(tA.id)) {
    const a = rangeValue(mA.id), b = rangeValue(tA.id);
    notes.push(`Portée : ${mA.name} ${ADC_RANGE[mA.id]} vs ${tA.name} ${ADC_RANGE[tA.id]}${a > b ? ' → tu harcèles en auto-attaques dès qu’ils viennent farmer' : a < b ? ' → évite les échanges d’auto-attaques, farme avec tes outils de portée et laisse ton support initier les trades' : ''}.`);
  }
  for (const [c, adc, side] of [[mA, true, 'Toi'], [mS, false, 'Toi'], [tA, true, 'Eux'], [tS, false, 'Eux']]) {
    if (c) notes.push(`${side} — ${c.name} : ${prof(c, adc)[5]}.`);
  }
  // fenêtre globale
  const best = rows.reduce((a, b) => (b.diff > a.diff ? b : a)), worst = rows.reduce((a, b) => (b.diff < a.diff ? b : a));
  const summary = best.diff >= 1 ? `Ta meilleure fenêtre : ${best.name.toLowerCase()} (${best.when}).` : 'Pas de vraie fenêtre de kill pour ton duo : joue la vague et le scaling.';
  const danger = worst.diff <= -1 ? `Moment dangereux : ${worst.name.toLowerCase()} (${worst.when}).` : '';
  return { mA, mS, tA, tS, rows, notes, summary, danger };
}
