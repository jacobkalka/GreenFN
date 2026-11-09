// npm test: runs the headless simulation test suite.
import { spawnSync } from 'node:child_process';
import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { GRADES } from '../src/sim/shooting.js';
import { mulberry32 } from '../src/core/math.js';
import { simulateShot, makeShooter } from './shotcal.mjs';
import { playGame } from './aivai.mjs';

let failed = 0;
const ok = (name, cond, info = '') => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${info ? '  — ' + info : ''}`);
  if (!cond) failed++;
};
const run = (file) => {
  const r = spawnSync(process.execPath, [file], { encoding: 'utf8' });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

// 1. every dribble move
let r = run('tests/moves.test.mjs');
ok('dribble moves execute, switch hands, keep the dribble', r.code === 0, r.out.trim().split('\n').length + ' cases');

// 2. dunks through the rim physics
r = run('tests/dunk.test.mjs');
ok('dunks finish through the rim', r.code === 0, r.out.trim());

// 3. stuck ball soft-lock guard
r = run('tests/stuck.test.mjs');
ok('ball stuck on the backboard becomes a held ball', r.code === 0, r.out.trim());

// 4. dribble robustness
r = run('tests/sim-dribble.mjs');
const fumbles = /fumbles: (\d+)/.exec(r.out);
ok('60 s of random direction changes without losing the dribble', fumbles && fumbles[1] === '0', fumbles ? `fumbles ${fumbles[1]}` : r.out.slice(0, 200));

// 5. shot model ordering (perfect > early > very early) at mid-range
{
  const bus = new EventBus();
  const game = new Game(bus);
  game.rng = mulberry32(7);
  const shooter = makeShooter();
  const rate = (g) => {
    let m = 0;
    for (let i = 0; i < 160; i++) if (simulateShot(game, shooter, 5, (i * 37) % 120 - 60, GRADES[g], 0).made) m++;
    return m / 160;
  };
  const p = rate('perfect');
  const e = rate('early');
  const v = rate('veryEarly');
  ok('release timing matters (perfect > slightly early > very early)', p > e && e > v && p > 0.85, `${(p * 100) | 0}% / ${(e * 100) | 0}% / ${(v * 100) | 0}%`);
}

// 6. full AI-vs-AI game completes through the rules
{
  const g = playGame('pro', 'pro', 4242, 20);
  ok('AI vs AI game reaches a winner', g.over, `${g.score} in ${g.minutes} min`);
}

console.log(failed ? `\n${failed} test(s) failed` : '\nall tests passed');
process.exit(failed ? 1 : 0);
