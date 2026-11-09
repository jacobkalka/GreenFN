// Dunks and layups finish through the real rim physics.
import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { PracticeRules } from '../src/sim/rules.js';
let makes = 0, att = 0, dunks = 0;
for (let trial = 0; trial < 12; trial++) {
  const bus = new EventBus();
  const game = new Game(bus);
  const u = game.addAthlete({ id: 'u', isUser: true, ratings: { vertical: 0.75 } });
  const rules = new PracticeRules(game, u, null, { rebounder: false });
  game.rules = rules;
  const x = (trial % 4 - 1.5) * 0.5;
  rules.reset(x, 7.2);
  let scored = false;
  bus.on('ball:score', () => (scored = true));
  bus.on('dunk', () => dunks++);
  // sprint at the rim, then sprint + shoot
  for (let i = 0; i < 240 && u.distToRim() > 4.2; i++) {
    u.input.move.set(-u.pos.x, 0, -u.pos.z).normalize();
    u.input.sprint = true;
    game.step(1 / 120);
    u.input.clearEdges();
  }
  u.input.shoot = true;
  u.input.shootPressed = true;
  for (let i = 0; i < 360; i++) {
    u.input.sprint = true;
    u.input.move.set(-u.pos.x, 0, -u.pos.z).normalize();
    game.step(1 / 120);
    if (scored) break;
  }
  att++;
  if (scored) makes++;
}
console.log(`dunk attempts ${att}, dunks ${dunks}, makes ${makes}`);
if (makes < att * 0.75) process.exit(1);
