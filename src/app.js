// Application shell: owns the renderer, simulation, view, input and the fixed-timestep loop.
import * as THREE from 'three';
import { EventBus } from './core/events.js';
import { Input } from './core/input.js';
import { Game } from './sim/game.js';
import { SIM_DT } from './sim/constants.js';
import { checkPickups } from './sim/actions.js';
import { Renderer } from './render/renderer.js';
import { GameView } from './render/gameView.js';

class HumanController {
  constructor(input, cameraRig) {
    this.input = input;
    this.cameraRig = cameraRig;
    this.athlete = null;
  }
  update(dt) {
    const a = this.athlete;
    const offense = a.hasBall() || a.game.offense === a;
    this.input.sample(a.input, this.cameraRig.getYaw(), { offense: a.hasBall() || !a.isDefending() }, dt);
  }
}

class IdleController {
  constructor() {
    this.athlete = null;
  }
  update() {
    this.athlete.input.move.set(0, 0, 0);
  }
}

export class App {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.events = new EventBus();
    this.renderer = new Renderer(canvas, 'high');
    this.input = new Input(window);
    this.game = new Game(this.events);
    this.view = new GameView(this.renderer, this.game, this.events, { quality: 'high' });
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.timeScale = 1;
    this.frameTimes = new Float32Array(120);
    this.frameIdx = 0;
    this._setupDev();
  }

  _setupDev() {
    const g = this.game;
    const user = g.addAthlete({ id: 'user', name: 'You', isUser: true });
    const cpu = g.addAthlete({ id: 'cpu', name: 'CPU', team: 1 });
    this.user = user;
    this.cpu = cpu;
    this.view.addAthlete(user, {});
    this.view.addAthlete(cpu, {
      skin: '#6b3d26',
      hair: 'afro',
      jersey: { base: '#f2c94c', trim: '#111111', number: '#111111', pattern: 'solid' },
      shorts: { base: '#141414', trim: '#f2c94c' },
      shoes: { upper: '#151515', sole: '#f0f0f0', accent: '#f2c94c' },
      number: 23,
    });
    this.userCtl = new HumanController(this.input, this.view.cameraRig);
    g.setController(user, this.userCtl);
    g.setController(cpu, new IdleController());
    user.place(0, 7.4, Math.PI);
    cpu.place(0, 5.6, 0);
    g.giveBall(user);
    this.view.cameraRig.snap();
  }

  start() {
    this.running = true;
    this.last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      this.frame(now);
    };
    requestAnimationFrame(loop);
  }

  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (this.manual) {
      // test mode: simulation advanced explicitly via simulate()
      this.view.render(1, 0);
      return;
    }
    if (dt > 0.1) dt = 0.1; // tab switches / hitches: never spiral
    if (dt < 0) dt = 0;
    const t0 = performance.now();
    this.acc += dt * this.timeScale;
    let steps = 0;
    while (this.acc >= SIM_DT && steps < 12) {
      this.step(SIM_DT);
      this.acc -= SIM_DT;
      steps++;
    }
    const alpha = Math.min(1, this.acc / SIM_DT);
    this.view.render(alpha, dt);
    this.frameTimes[this.frameIdx++ % this.frameTimes.length] = performance.now() - t0;
  }

  step(dt) {
    this.game.step(dt);
    checkPickups(this.game, dt);
  }

  /** Advance the simulation (and camera/effects) deterministically. Used by automated tests. */
  simulate(seconds, frameDt = 1 / 60) {
    this.manual = true;
    let t = 0;
    while (t < seconds - 1e-9) {
      this.acc += frameDt;
      while (this.acc >= SIM_DT) {
        this.step(SIM_DT);
        this.acc -= SIM_DT;
      }
      this.view.update(Math.min(1, this.acc / SIM_DT), frameDt);
      t += frameDt;
    }
  }
}
