// Profils de composition par champion (pentagone des compos).
// Format : IdDataDragon Rôles Engage Split Catch Poke Protect Frontline Dégâts Scaling
//   Rôles : T=Top J=Jungle M=Mid A=ADC S=Support (le premier est le principal)
//   Engage / Split / Catch / Poke / Protect / Frontline : 0 à 3
//   Dégâts : P=physique, M=magique, X=mixte
//   Scaling : 1 = fort en early, 2 = pic en mid game, 3 = scaling late game
// Les champions absents (nouveaux champions) sont estimés via leurs tags Riot.
const RAW = `
Aatrox T 2 1 0 1 0 2 P 2
Ahri M 1 0 3 1 1 0 M 2
Akali MT 1 1 2 0 0 0 M 2
Akshan MA 0 2 2 1 0 0 P 2
Alistar SJ 3 0 1 0 2 3 M 1
Ambessa TJ 2 2 1 0 0 2 P 2
Amumu JS 3 0 1 0 0 3 M 2
Anivia M 0 0 1 2 3 0 M 3
Annie MS 2 0 2 0 0 0 M 2
Aphelios A 1 0 0 1 1 0 P 3
Ashe AS 2 0 2 2 1 0 P 2
AurelionSol M 0 0 0 2 1 0 M 3
Aurora MT 1 1 1 1 2 0 M 2
Azir M 1 0 0 2 3 0 M 3
Bard S 1 0 3 1 2 0 M 2
Belveth J 1 2 0 0 0 1 P 3
Blitzcrank S 1 0 3 0 0 1 M 1
Brand SM 1 0 0 2 0 0 M 2
Braum S 0 0 0 0 3 2 M 2
Briar J 2 0 1 0 0 1 P 1
Caitlyn A 0 0 1 3 1 0 P 2
Camille T 2 3 2 0 0 1 P 2
Cassiopeia MT 1 0 0 1 1 0 M 3
Chogath TM 1 0 1 1 1 3 M 3
Corki MA 0 0 0 3 0 0 X 2
Darius T 1 2 0 0 0 2 P 1
Diana JM 3 0 1 0 0 1 M 2
DrMundo TJ 0 1 0 0 1 3 M 3
Draven A 1 0 0 0 0 0 P 1
Ekko JM 2 1 2 0 1 0 M 2
Elise J 1 0 3 0 0 0 M 1
Evelynn J 0 0 3 0 0 0 M 2
Ezreal A 0 0 0 3 1 0 X 2
Fiddlesticks J 3 0 1 0 0 0 M 2
Fiora T 1 3 0 0 0 1 P 3
Fizz M 1 0 2 0 1 0 M 2
Galio MS 3 0 1 0 2 2 M 2
Gangplank T 0 2 0 2 0 1 P 3
Garen T 1 2 1 0 0 2 P 2
Gnar T 2 1 0 1 1 2 P 2
Gragas JTS 2 0 1 1 2 2 M 2
Graves J 1 1 0 0 0 1 P 2
Gwen TJ 1 2 0 0 0 1 M 3
Hecarim J 3 0 1 0 0 2 P 2
Heimerdinger MST 0 1 0 2 2 0 M 1
Hwei MS 1 0 1 3 2 0 M 2
Illaoi T 0 2 0 0 1 2 P 2
Irelia TM 2 2 0 0 0 1 P 2
Ivern J 0 0 0 0 2 0 M 2
Janna S 0 0 0 0 3 0 M 2
JarvanIV J 3 0 1 0 0 2 P 1
Jax TJ 2 3 0 0 0 1 X 3
Jayce TM 0 1 0 3 0 0 P 1
Jhin A 0 0 2 2 1 0 P 2
Jinx A 0 0 0 1 2 0 P 3
Kaisa A 2 0 1 0 0 0 X 3
Kalista A 2 0 0 0 1 0 P 1
Karma SM 0 0 0 2 2 0 M 2
Karthus JM 0 0 0 1 1 0 M 3
Kassadin M 1 1 1 0 0 0 M 3
Katarina M 1 0 1 0 0 0 M 2
Kayle TM 0 1 0 0 1 0 M 3
Kayn J 2 0 1 0 0 1 P 2
Kennen T 3 1 0 0 0 1 M 2
Khazix J 0 0 3 0 0 0 P 2
Kindred J 0 0 1 1 1 0 P 3
Kled T 3 1 0 0 0 2 P 1
KogMaw A 0 0 0 1 2 0 X 3
KSante T 2 1 1 0 2 3 P 2
Leblanc M 0 0 3 1 0 0 M 1
LeeSin J 2 0 2 0 1 1 P 1
Leona S 3 0 1 0 0 3 M 1
Lillia J 2 0 0 0 1 1 M 2
Lissandra M 3 0 1 0 2 1 M 2
Lucian AM 1 0 0 0 0 0 P 1
Lulu S 0 0 0 1 3 0 M 2
Lux SM 0 0 2 3 1 0 M 2
Malphite TS 3 0 0 0 0 3 M 2
Malzahar M 0 0 2 1 1 0 M 2
Maokai SJT 2 0 1 0 2 3 M 2
MasterYi J 0 2 0 0 0 0 P 3
Mel M 0 0 1 3 2 0 M 2
Milio S 0 0 0 0 3 0 M 2
MissFortune A 1 0 0 2 0 0 P 2
MonkeyKing TJ 3 1 0 0 0 2 P 2
Mordekaiser T 1 1 1 0 0 2 M 2
Morgana S 0 0 2 1 3 0 M 2
Naafiri M 0 1 3 0 0 0 P 1
Nami S 1 0 1 1 2 0 M 2
Nasus T 0 3 0 0 0 2 P 3
Nautilus S 3 0 2 0 1 3 M 1
Neeko MS 3 0 1 1 0 0 M 2
Nidalee J 0 0 1 3 0 0 M 1
Nilah A 2 0 0 0 0 0 P 3
Nocturne J 3 0 2 0 0 1 P 2
Nunu J 2 0 1 0 1 2 M 2
Olaf TJ 1 1 0 0 0 2 P 1
Orianna M 2 0 0 1 2 0 M 3
Ornn T 3 0 0 0 1 3 M 3
Pantheon TJSM 2 0 2 1 0 1 P 1
Poppy TJS 2 0 0 0 3 3 P 2
Pyke S 1 0 3 0 0 0 P 1
Qiyana MJ 2 0 2 0 0 0 P 1
Quinn T 0 3 1 1 0 0 P 2
Rakan S 3 0 1 0 1 1 M 2
Rammus J 3 0 1 0 0 3 M 2
RekSai J 2 0 2 0 0 1 P 1
Rell S 3 0 1 0 0 3 M 1
Renata S 0 0 0 1 3 0 M 2
Renekton T 2 1 0 0 0 2 P 1
Rengar JT 0 0 3 0 0 0 P 2
Riven T 2 2 0 0 0 1 P 2
Rumble TM 1 0 0 0 2 1 M 2
Ryze MT 0 2 0 1 0 0 M 3
Samira A 2 0 0 0 0 0 P 2
Sejuani J 3 0 0 0 1 3 M 2
Senna SA 0 0 1 2 1 0 P 3
Seraphine SM 1 0 0 2 2 0 M 2
Sett TS 2 1 0 0 1 2 P 2
Shaco JS 0 1 3 0 0 0 P 1
Shen T 2 2 0 0 2 2 M 2
Shyvana J 1 1 0 0 0 2 M 3
Singed T 1 2 0 0 1 2 M 3
Sion T 3 2 0 0 0 3 P 3
Sivir A 1 0 0 1 1 0 P 2
Skarner JT 3 0 2 0 0 3 P 2
Smolder A 0 0 0 2 0 0 X 3
Sona S 1 0 0 1 2 0 M 3
Soraka S 0 0 0 0 3 0 M 2
Swain SM 1 0 1 0 2 2 M 3
Sylas MJ 1 0 1 0 0 1 M 2
Syndra M 0 0 2 2 1 0 M 2
TahmKench ST 0 1 0 0 3 3 M 2
Taliyah JM 1 0 2 1 2 0 M 2
Talon MJ 0 1 3 0 0 0 P 1
Taric S 1 0 0 0 3 2 M 2
Teemo T 0 2 0 1 0 0 M 2
Thresh S 1 0 3 0 2 1 M 2
Tristana AM 1 1 0 0 0 0 P 3
Trundle JT 1 3 0 0 0 2 P 2
Tryndamere T 1 3 0 0 0 1 P 3
TwistedFate M 0 2 3 0 0 0 M 2
Twitch A 1 0 1 0 0 0 P 3
Udyr J 1 1 0 0 0 2 X 2
Urgot T 1 1 0 0 1 2 P 2
Varus A 1 0 1 3 0 0 X 2
Vayne AT 0 1 0 0 1 0 P 3
Veigar M 0 0 1 1 2 0 M 3
Velkoz SM 0 0 1 3 0 0 M 2
Vex M 2 0 1 0 2 0 M 2
Vi J 3 0 2 0 0 1 P 2
Viego J 1 0 1 0 0 1 P 2
Viktor M 0 0 0 2 2 0 M 3
Vladimir MT 1 1 0 0 0 0 M 3
Volibear TJ 2 1 1 0 0 2 X 1
Warwick JT 2 0 2 0 0 2 X 1
Xayah A 0 0 0 0 2 0 P 2
Xerath MS 0 0 1 3 1 0 M 2
XinZhao J 2 0 1 0 0 1 P 1
Yasuo MT 2 1 0 0 1 0 P 2
Yone MT 2 1 0 0 0 0 X 3
Yorick T 0 3 0 0 0 1 P 2
Yunara A 0 0 0 1 1 0 P 3
Yuumi S 0 0 0 0 2 0 M 3
Zaahen T 2 2 0 0 0 2 P 2
Zac J 3 0 1 0 1 3 M 2
Zed M 0 1 3 0 0 0 P 2
Zeri A 1 0 0 1 0 0 P 3
Ziggs MA 0 1 0 3 2 0 M 2
Zilean SM 0 0 0 1 3 0 M 3
Zoe M 0 0 3 3 0 0 M 2
Zyra S 0 0 1 2 2 0 M 2
`;

export const DB = {};
for (const line of RAW.trim().split('\n')) {
  const [id, roles, e, s, c, p, d, f, dmg, scale] = line.trim().split(/\s+/);
  DB[id] = { roles: roles.split(''), e: +e, s: +s, c: +c, p: +p, d: +d, f: +f, dmg, scale: +scale };
}

const clamp = (v) => Math.max(0, Math.min(3, v));

// Estimation pour un champion inconnu de la base (ex. sortie récente).
function guess(ch) {
  let e = 0, s = 0, c = 0, p = 0, d = 0, f = 0, scale = 2;
  const roles = [];
  for (const t of ch.tags ?? []) {
    if (t === 'Tank') { e += 2; f += 3; roles.push('T'); }
    if (t === 'Fighter') { e += 1; s += 1; f += 1; roles.push('T'); }
    if (t === 'Mage') { p += 2; d += 1; roles.push('M'); }
    if (t === 'Marksman') { p += 1; d += 1; scale = 3; roles.push('A'); }
    if (t === 'Support') { d += 2; roles.push('S'); }
    if (t === 'Assassin') { c += 2; roles.push('M'); }
  }
  const dmg = (ch.info?.magic ?? 0) > (ch.info?.attack ?? 0) ? 'M' : 'P';
  return {
    roles: [...new Set(roles.length ? roles : ['M'])],
    e: clamp(e), s: clamp(s), c: clamp(c), p: clamp(p), d: clamp(d), f: clamp(f), dmg, scale, guessed: true
  };
}

export function profileFor(champ) {
  return { ...(DB[champ.id] ?? guess(champ)) };
}
