const LEAGUES = [
  { id: 39, name: 'Premier League', country: 'England' },
  { id: 140, name: 'La Liga', country: 'Spain' },
  { id: 78, name: 'Bundesliga', country: 'Germany' },
  { id: 135, name: 'Serie A', country: 'Italy' },
  { id: 61, name: 'Ligue 1', country: 'France' },
  { id: 2, name: 'Champions League', country: 'Europe' }
];

const DAY = 86400000;

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

async function api(path) {
  const key = process.env.API_FOOTBALL_KEY;

  if (!key) {
    throw new Error('API_FOOTBALL_KEY is missing in Vercel.');
  }

  const url = `https://v3.football.api-sports.io/${path}`;

  const res = await fetch(url, {
    headers: { 'x-apisports-key': key }
  });

  const body = await res.json().catch(() => ({}));

  if (!res.ok || (body.errors && Object.keys(body.errors).length)) {
    throw new Error(
      `API-Football error: ${JSON.stringify(body.errors || body.message || res.status)}`
    );
  }

  return body.response || [];
}

function validScore(f) {
  return ['FT', 'AET', 'PEN'].includes(f.fixture?.status?.short) &&
    Number.isFinite(f.goals?.home) &&
    Number.isFinite(f.goals?.away);
}

function poisson(lambda, k) {
  if (k < 0) return 0;

  let p = Math.exp(-lambda);

  for (let i = 1; i <= k; i++) {
    p *= lambda / i;
  }

  return p;
}

function outcomeProb(homeLambda, awayLambda) {
  let home = 0;
  let draw = 0;
  let away = 0;
  let total = 0;

  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const ph = poisson(homeLambda, i);
      const pa = poisson(awayLambda, j);
      const p = ph * pa;

      total += p;

      if (i > j) home += p;
      else if (i === j) draw += p;
      else away += p;
    }
  }

  return [
    home / total * 100,
    draw / total * 100,
    away / total * 100
  ];
}

function makeModel(history) {
  const teams = new Map();
  let totalHome = 0;
  let totalAway = 0;
  let count = 0;

  function getTeam(name) {
    if (!teams.has(name)) {
      teams.set(name, {
        homeGF: 0, homeGA: 0, homeN: 0,
        awayGF: 0, awayGA: 0, awayN: 0,
        gf: 0, ga: 0, games: 0
      });
    }

    return teams.get(name);
  }

  for (const f of history.filter(validScore)) {
    const homeName = f.teams?.home?.name;
    const awayName = f.teams?.away?.name;
    const hg = f.goals.home;
    const ag = f.goals.away;

    if (!homeName || !awayName) continue;

    const h = getTeam(homeName);
    const a = getTeam(awayName);

    h.homeGF += hg;
    h.homeGA += ag;
    h.homeN++;
    h.gf += hg;
    h.ga += ag;
    h.games++;

    a.awayGF += ag;
    a.awayGA += hg;
    a.awayN++;
    a.gf += ag;
    a.ga += hg;
    a.games++;

    totalHome += hg;
    totalAway += ag;
    count++;
  }

  return {
    teams,
    avgHome: count ? totalHome / count : 1.45,
    avgAway: count ? totalAway / count : 1.15,
    historyCount: count
  };
}

function predict(f, model) {
  const homeName = f.teams?.home?.name;
  const awayName = f.teams?.away?.name;

  const h = model.teams.get(homeName);
  const a = model.teams.get(awayName);

  if (!h || !a || h.games < 3 || a.games < 3) {
    return {
      available: false,
      reason: 'Insufficient matching historical results',
      sample: {
        home: h?.games || 0,
        away: a?.games || 0
      }
    };
  }

  const hGF = h.homeN ? h.homeGF / h.homeN : h.gf / h.games;
  const hGA = h.homeN ? h.homeGA / h.homeN : h.ga / h.games;
  const aGF = a.awayN ? a.awayGF / a.awayN : a.gf / a.games;
  const aGA = a.awayN ? a.awayGA / a.awayN : a.ga / a.games;

  const attackH = Math.max(0.45, Math.min(1.8, hGF / model.avgHome));
  const defendA = Math.max(0.45, Math.min(1.8, aGA / model.avgHome));
  const attackA = Math.max(0.45, Math.min(1.8, aGF / model.avgAway));
  const defendH = Math.max(0.45, Math.min(1.8, hGA / model.avgAway));

  const expectedHome = Math.max(
    0.2, Math.min(4, model.avgHome * attackH * defendA)
  );

  const expectedAway = Math.max(
    0.2, Math.min(4, model.avgAway * attackA * defendH)
  );

  const p = outcomeProb(expectedHome, expectedAway);

  return {
    available: true,
    home: +p[0].toFixed(1),
    draw: +p[1].toFixed(1),
    away: +p[2].toFixed(1),
    expectedGoals: {
      home: +expectedHome.toFixed(2),
      away: +expectedAway.toFixed(2)
    },
    sample: { home: h.games, away: a.games },
    model: 'Historical goals / Poisson baseline'
  };
}

export default async function handler(req, res) {
  res.setHeader(
    'Cache-Control',
    's-maxage=1800, stale-while-revalidate=3600'
  );

  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Use GET' });
    return;
  }

  try {
    const now = new Date();
    const from = dateStr(now);
    const to = dateStr(new Date(now.getTime() + 7 * DAY));

    const results = await Promise.all(
      LEAGUES.map(async league => {
        const fixturePath = new URLSearchParams({
          league: String(league.id),
          from,
          to,
          timezone: 'Africa/Windhoek'
        });

        const historyPath = new URLSearchParams({
          league: String(league.id),
          season: '2024',
          status: 'FT'
        });

        const [fixtures, history] = await Promise.all([
          api(`fixtures?${fixturePath.toString()}`),
          api(`fixtures?${historyPath.toString()}`)
        ]);

        const model = makeModel(history);

        return fixtures.map(f => ({
          id: f.fixture?.id,
          date: f.fixture?.date,
          status: f.fixture?.status?.short,
          league: league.name,
          country: league.country,
          home: f.teams?.home?.name,
          away: f.teams?.away?.name,
          homeLogo: f.teams?.home?.logo,
          awayLogo: f.teams?.away?.logo,
          prediction: predict(f, model),
          historyMatches: model.historyCount
        }));
      })
    );

    const matches = results
      .flat()
      .filter(m => m.id && m.home && m.away)
      .sort((a, b) => new Date(a.date) - new Date(b.date));

    res.status(200).json({
      ok: true,
      generatedAt: new Date().toISOString(),
      range: { from, to },
      leagues: LEAGUES.map(l => l.name),
      matches,
      note: 'Predictions require sufficient matching historical results. They are estimates, not guarantees.'
    });
  } catch (e) {
    res.status(502).json({
      ok: false,
      error: e.message,
      help: 'Check API_FOOTBALL_KEY in Vercel. Free-plan restrictions and league coverage may limit historical data.'
    });
  }
}
