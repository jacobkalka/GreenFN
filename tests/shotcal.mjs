// Monte Carlo shot calibration through the real ball physics (rim/backboard/net).
import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { launchShot, GRADES } from '../src/sim/shooting.js';
import { mulberry32 } from '../src/core/math.js';
import { BallState } from '../src/sim/ball.js';

export function makeShooter(ratings = {}) {
  return { ratings: Object.assign({ shotClose: 0.8, shotMid: 0.75, shotLong: 0.72, release: 0.75 }, ratings), stamina: 1, pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 } };
}

export function simulateShot(game, shooter, dist, angleDeg, grade, contest, kind = 'jumper', relH = 2.55) {
  const ball = game.ball;
  const ang = (angleDeg * Math.PI) / 180;
  shooter.pos.x = Math.sin(ang) * dist;
  shooter.pos.z = Math.cos(ang) * dist;
  // release point slightly in front of the shooter toward the rim
  const k = (dist - 0.3) / dist;
  ball.pos.set(shooter.pos.x * k, relH, shooter.pos.z * k);
  ball.prevPos.copy(ball.pos);
  ball.state = BallState.HELD;
  let made = false;
  const off = game.events.on('ball:score', () => (made = true));
  const arc = ((kind === 'layup' ? 62 : 52) + Math.max(-3, Math.min(3, (5 - dist) * 0.6))) * Math.PI / 180;
  launchShot(game, shooter, { kind, grade, contest, moveSpeed: 0, arc, fromX: shooter.pos.x, fromZ: shooter.pos.z });
  for (let i = 0; i < 120 * 4; i++) {
    game.step(1 / 120);
    if (made) break;
    if (ball.pos.y < 0.5) break;
  }
  off();
  return { made, rim: ball.touchedRim, board: ball.touchedBoard };
}

if (process.argv[1] && process.argv[1].endsWith('shotcal.mjs')) {
  const bus = new EventBus();
  const game = new Game(bus);
  game.rng = mulberry32(1234);
  const shooter = makeShooter();
  const N = Number(process.argv[2] || 300);
  const dists = [2.0, 3.5, 5.0, 6.5, 7.6];
  const grades = ['perfect', 'early', 'veryEarly'];
  const contests = [0, 0.5, 0.9];
  console.log('dist  grade       c=0.0  c=0.5  c=0.9   (make %, swish% at c=0)');
  for (const d of dists) {
    for (const gname of grades) {
      const row = [];
      let swish = 0;
      for (const c of contests) {
        let m = 0;
        for (let i = 0; i < N; i++) {
          const r = simulateShot(game, shooter, d, (i * 37) % 120 - 60, GRADES[gname], c);
          if (r.made) { m++; if (c === 0 && !r.rim && !r.board) swish++; }
        }
        row.push(((100 * m) / N).toFixed(0).padStart(5));
      }
      console.log(`${d.toFixed(1)}  ${gname.padEnd(10)} ${row.join('  ')}    swish ${((100 * swish) / N).toFixed(0)}%`);
    }
  }
}
