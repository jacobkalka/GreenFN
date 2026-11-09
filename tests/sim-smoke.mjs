import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { checkPickups } from '../src/sim/actions.js';
import { BallState } from '../src/sim/ball.js';
import { Handling } from '../src/sim/athlete.js';
import * as THREE from 'three';

const bus = new EventBus();
const game = new Game(bus);
const a = game.addAthlete({ id: 'u', name: 'You', isUser: true });
a.place(0, 7, Math.PI);
game.giveBall(a);
let fumbles = 0, bounces = 0, catches = 0, scores = 0, rims = 0;
bus.on('dribble:fumble', () => fumbles++);
bus.on('dribble:catch', () => catches++);
bus.on('ball:impact', (e) => { if (e.dribble) bounces++; if (e.surface==='rim') rims++; });
bus.on('ball:score', () => scores++);
const dt = 1/120;
// move in a few directions while dribbling
const dirs = [[0,0,-1],[1,0,0],[-1,0,0],[0,0,1],[0.7,0,-0.7],[0,0,0]];
let t = 0;
for (const [x,y,z] of dirs) {
  for (let i = 0; i < 240; i++) {
    a.input.move.set(x,y,z);
    a.input.sprint = (i % 480) > 120;
    game.step(dt); t += dt;
    if (!Number.isFinite(game.ball.pos.x) || !Number.isFinite(a.pos.x)) { console.log('NaN!', t); process.exit(1); }
  }
  console.log(`dir ${[x,z]} pos=(${a.pos.x.toFixed(2)},${a.pos.z.toFixed(2)}) speed=${a.speedNow.toFixed(2)} ball=(${game.ball.pos.x.toFixed(2)},${game.ball.pos.y.toFixed(2)},${game.ball.pos.z.toFixed(2)}) state=${game.ball.state} handling=${a.handling} hand=${a.dribble.hand} footL=(${a.animator.gait.L.pos.x.toFixed(2)},${a.animator.gait.L.pos.z.toFixed(2)})`);
}
console.log({fumbles, bounces, catches});
// shoot: hold and release at the ideal time
a.input.move.set(0,0,0);
for (let i=0;i<60;i++) game.step(dt);
a.input.shoot = true; a.input.shootPressed = true;
let released = false;
for (let i = 0; i < 600; i++) {
  if (a.action && a.action.type === 'shot' && a.action.phase !== 'pickup' && !released) {
    if (a.action.t >= a.action.ideal - 1e-3) { a.input.shoot = false; a.input.shootReleased = true; released = true; }
  }
  game.step(dt);
  checkPickups(game, dt);
}
console.log('shot', game.ball.shot && { grade: game.ball.shot.grade.id, dist: game.ball.shot.dist.toFixed(2), value: game.ball.shot.value, contest: game.ball.shot.contest });
console.log({ scores, rims, ballState: game.ball.state, ballPos: game.ball.pos.toArray().map(v=>v.toFixed(2)), owner: game.ball.owner && game.ball.owner.id });
