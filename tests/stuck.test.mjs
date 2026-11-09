// A ball resting on top of the backboard becomes a dead ball (no soft-lock).
import { EventBus } from '../src/core/events.js';
import { Game } from '../src/sim/game.js';
import { MatchRules } from '../src/sim/rules.js';
import { BallState } from '../src/sim/ball.js';
import { HOOP, BALL } from '../src/sim/constants.js';
const bus = new EventBus();
const game = new Game(bus);
const a = game.addAthlete({ id: 'a' });
const b = game.addAthlete({ id: 'b' });
const rules = new MatchRules(game, { target: 11 });
game.rules = rules;
rules.start(a);
for (let i = 0; i < 200; i++) game.step(1 / 120);
// drop the ball onto the top of the backboard
game.releaseBall();
game.ball.state = BallState.FREE;
game.ball.lastTouch = a;
game.ball.pos.set(0.2, HOOP.boardTop + BALL.radius + 0.3, HOOP.boardFaceZ - 0.022);
game.ball.vel.set(0, 0, 0);
let reason = null;
bus.on('rules:state', (e) => { if (e.state === 'dead') reason = e.reason; });
for (let i = 0; i < 120 * 5 && !reason; i++) game.step(1 / 120);
console.log('ball y', game.ball.pos.y.toFixed(2), 'reason', reason);
if (reason !== 'Held ball') process.exit(1);
