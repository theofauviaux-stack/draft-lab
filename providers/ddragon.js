// Data Dragon (source officielle Riot) : dernier patch + liste des champions.
const { get } = require('./http');

async function fetchDDragon() {
  const versions = await get('https://ddragon.leagueoflegends.com/api/versions.json');
  const version = versions[0];
  const [fr, en] = await Promise.all([
    get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/fr_FR/champion.json`),
    get(`https://ddragon.leagueoflegends.com/cdn/${version}/data/en_US/champion.json`).catch(() => null)
  ]);
  const champions = Object.values(fr.data).map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    nameEn: en?.data?.[c.id]?.name ?? c.name,
    tags: c.tags,
    info: c.info
  }));
  return { version, versions: versions.slice(0, 6), patch: version.split('.').slice(0, 2).join('.'), champions };
}

module.exports = { fetchDDragon };
