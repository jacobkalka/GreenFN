import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import * as THREE from 'three';
const bus = new EventBus();
const game = new Game(bus);
const a = game.addAthlete({ id: 'u', name: 'You', isUser: true });
a.place(0, 6, Math.PI);
game.giveBall(a);
let fumbles = 0, bounces = 0, catches = 0;
let maxCatchErr = 0;
bus.on('dribble:fumble', () => { fumbles++; console.log('FUMBLE at', game.time.toFixed(2), 'pos', a.pos.x.toFixed(2), a.pos.z.toFixed(2), 'vel', a.vel.x.toFixed(2), a.vel.z.toFixed(2)); });
bus.on('dribble:catch', () => { catches++; });
bus.on('ball:impact', (e) => { if (e.dribble) bounces++; });
const dt = 1/120;
// random direction changes every 0.3-1.2 s, staying near center
let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
let t = 0, next = 0; const dir = new THREE.Vector3();
let sprint = false;
let catchErrSum = 0, catchN = 0;
bus.on('dribble:catch', () => {
  const hp = a.animator.palmWorld[a.dribble.hand > 0 ? 'L' : 'R'];
  const e = hp.distanceTo(game.ball.pos);
  catchErrSum += e; catchN++; maxCatchErr = Math.max(maxCatchErr, e);
});
for (let i = 0; i < 120 * 60; i++) {
  if (t >= next) {
    const ang = rnd() * Math.PI * 2;
    const mag = rnd() < 0.15 ? 0 : 1;
    dir.set(Math.sin(ang) * mag, 0, Math.cos(ang) * mag);
    // pull back toward the center if far
    if (Math.hypot(a.pos.x, a.pos.z - 6) > 4) dir.set(-a.pos.x, 0, 6 - a.pos.z).normalize();
    sprint = rnd() < 0.4;
    next = t + 0.3 + rnd() * 0.9;
  }
  a.input.move.copy(dir); a.input.sprint = sprint;
  game.step(dt); t += dt;
  if (game.ball.state !== 'dribble') { console.log('not dribbling at', t.toFixed(2)); break; }
}
console.log({ fumbles, bounces, catches, avgCatchErr: (catchErrSum/catchN).toFixed(3), maxCatchErr: maxCatchErr.toFixed(3), simTime: t.toFixed(1) });
