// Every dribble move executes, affects position/hand as designed and keeps the dribble alive.
import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { MOVE_IDS } from '../src/sim/moves.js';
import { Handling } from '../src/sim/athlete.js';

let failures = 0;
const results = [];
for (const id of MOVE_IDS) {
  for (const moving of [false, true]) {
    const bus = new EventBus();
    const game = new Game(bus);
    const a = game.addAthlete({ id: 'u', isUser: true });
    const d = game.addAthlete({ id: 'd' });
    a.place(0, 7.5, Math.PI);
    d.place(0, 5.0, 0);
    game.giveBall(a);
    let fumble = false;
    bus.on('dribble:fumble', () => (fumble = true));
    // start dribbling
    a.input.move.set(0, 0, moving ? -1 : 0);
    if (!moving) a.input.move.set(0.01, 0, 0);
    for (let i = 0; i < 90; i++) game.step(1 / 120);
    if (!moving) a.input.move.set(0, 0, 0);
    for (let i = 0; i < 30; i++) game.step(1 / 120);
    const hand0 = a.dribble.hand;
    const p0 = a.pos.clone();
    a.input.move1 = id;
    let started = false, ended = false, maxYaw = 0;
    let lastYaw = a.yaw;
    bus.on('move:start', () => (started = true));
    bus.on('move:end', () => (ended = true));
    for (let i = 0; i < 180; i++) {
      game.step(1 / 120);
      let dy = a.yaw - lastYaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); maxYaw += Math.abs(dy); lastYaw = a.yaw;
    }
    a.input.move.set(0, 0, 0);
    for (let i = 0; i < 60; i++) game.step(1 / 120);
    const moved = a.pos.distanceTo(p0);
    const ok = started && ended && !fumble && a.handling === Handling.DRIBBLE && game.ball.state === 'dribble';
    const switched = a.dribble.hand !== hand0;
    results.push(`${id.padEnd(9)} ${moving ? 'moving ' : 'standing'} start=${started} end=${ended} fumble=${fumble} hand ${hand0}->${a.dribble.hand}${switched ? ' (switch)' : ''} moved=${moved.toFixed(2)}m turned=${(maxYaw * 57.3).toFixed(0)}deg stamina=${a.stamina.toFixed(2)} ${ok ? 'OK' : 'FAIL'}`);
    if (!ok) failures++;
  }
}
console.log(results.join('\n'));
if (failures) { console.log(`${failures} failures`); process.exit(1); }
