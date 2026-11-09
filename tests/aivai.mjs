// Headless AI-vs-AI full games through the real rules/physics/moves/shot model.
import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { MatchRules } from '../src/sim/rules.js';
import { AIController, aiRatings } from '../src/sim/ai.js';
import { mulberry32 } from '../src/core/math.js';

export function playGame(levelA = 'pro', levelB = 'pro', seed = 1, maxMinutes = 20, verbose = false) {
  const bus = new EventBus();
  const game = new Game(bus);
  const rng = mulberry32(seed);
  game.rng = rng;
  const origRandom = Math.random;
  Math.random = rng; // determinism for any Math.random use in the sim
  const a = game.addAthlete({ id: 'A', name: 'A', ratings: aiRatings(levelA) });
  const b = game.addAthlete({ id: 'B', name: 'B', team: 1, ratings: aiRatings(levelB) });
  const ca = new AIController(levelA, rng);
  const cb = new AIController(levelB, rng);
  game.setController(a, ca);
  game.setController(b, cb);
  const rules = new MatchRules(game, { target: 11 });
  game.rules = rules;
  a.place(0, 8, Math.PI);
  b.place(0, 6.5, 0);
  const counts = {};
  bus.on('*', (type) => (counts[type] = (counts[type] || 0) + 1));
  const log = [];
  bus.on('rules:score', (e) => log.push(`${rules.gameTime.toFixed(1)}s ${e.athlete.id} +${e.value} (${e.shot.kind}${e.swish ? ', swish' : ''}, ${e.shot.grade ? e.shot.grade.id : ''}) ${rules.getScore(a)}-${rules.getScore(b)}`));
  bus.on('rules:event', (e) => log.push(`${rules.gameTime.toFixed(1)}s event ${e.type} ${e.who ? e.who.id : ''}`));
  rules.start(a);
  const dt = 1 / 120;
  let t = 0;
  let stuck = 0;
  let lastPos = a.pos.clone();
  while (rules.state !== 'over' && t < maxMinutes * 60) {
    game.step(dt);
    t += dt;
    if (!Number.isFinite(a.pos.x) || !Number.isFinite(game.ball.pos.x)) throw new Error('NaN at ' + t);
  }
  Math.random = origRandom;
  const sa = rules.stats.get(a);
  const sb = rules.stats.get(b);
  const fmt = (s) => `pts ${s.pts} FG ${s.fgm}/${s.fga} (${s.fga ? Math.round((100 * s.fgm) / s.fga) : 0}%) 2PT ${s.twoM}/${s.twoA} greens ${s.perfect}/${s.releases} stl ${s.steals} blk ${s.blocks} reb ${s.rebounds} to ${s.turnovers} dunks ${s.dunks} layups ${s.layupsMade}/${s.layups} moves ${s.movesTotal}`;
  return { winner: rules.winner && rules.winner.id, score: `${rules.getScore(a)}-${rules.getScore(b)}`, minutes: (rules.gameTime / 60).toFixed(1), A: fmt(sa), B: fmt(sb), counts, log, over: rules.state === 'over' };
}

if (process.argv[1] && process.argv[1].endsWith('aivai.mjs')) {
  const la = process.argv[2] || 'pro';
  const lb = process.argv[3] || 'pro';
  const n = Number(process.argv[4] || 3);
  for (let i = 0; i < n; i++) {
    const t0 = Date.now();
    const r = playGame(la, lb, 100 + i);
    console.log(`game ${i}: ${la} vs ${lb} -> winner ${r.winner} ${r.score} in ${r.minutes} min (over=${r.over}) [${Date.now() - t0} ms]`);
    console.log('  A:', r.A);
    console.log('  B:', r.B);
    if (i === 0) console.log('  log:', r.log.slice(0, 40).join('\n       '));
    const c = r.counts;
    console.log(`  events: moves ${c['move:start'] || 0}, steals ${c['steal'] || 0}/${c['steal:attempt'] || 0}, blocks ${c['block'] || 0}, fumbles ${c['dribble:fumble'] || 0}, bites ${c['ai:bite'] || 0}, ankles ${c['ankles'] || 0}, fakes ${c['shot:fake'] || 0}, dunks ${c['dunk'] || 0}`);
  }
}
