// Application shell: renderer, simulation, view, input, audio, profile and UI. Owns the
// fixed-timestep loop and the mode flow (menu -> match / practice -> end screen).
import { EventBus } from './core/events.js';
import { Input } from './core/input.js';
import { Game } from './sim/game.js';
import { SIM_DT, HOOP } from './sim/constants.js';
import { MatchRules, PracticeRules } from './sim/rules.js';
import { AIController, aiRatings } from './sim/ai.js';
import { EmoteAction, ShowcaseController } from './sim/emotes.js';
import { Renderer } from './render/renderer.js';
import { GameView } from './render/gameView.js';
import { SKIN_TONES, HAIR_STYLES } from './render/characterView.js';
import { AudioManager, bindGameAudio } from './audio/audio.js';
import { Profile } from './meta/profile.js';
import { ITEM, lookFromProfile } from './meta/catalog.js';
import { UI } from './ui/ui.js';
import { pick } from './core/math.js';

const USER_RATINGS = {
  speed: 0.78,
  accel: 0.78,
  handle: 0.8,
  shotClose: 0.82,
  shotMid: 0.78,
  shotLong: 0.76,
  release: 0.78,
  defense: 0.76,
  steal: 0.72,
  block: 0.7,
  vertical: 0.75,
  stamina: 0.8,
  strength: 0.72,
};

const CPU_NAMES = ['NOVA', 'BLAZE', 'ONYX', 'VEX', 'JETT', 'KATO', 'ROOK', 'ZEKE', 'REMY', 'DASH', 'SAINT', 'ACE'];
const CPU_KITS = [
  { base: '#f2c94c', trim: '#111111', number: '#111111', shorts: '#141414', strim: '#f2c94c', shoes: ['#151515', '#f0f0f0', '#f2c94c'] },
  { base: '#a3122a', trim: '#ffffff', number: '#ffffff', shorts: '#a3122a', strim: '#ffffff', shoes: ['#f4f4f4', '#1b1b1b', '#a3122a'] },
  { base: '#f2f4f7', trim: '#1d3fbf', number: '#1d3fbf', shorts: '#f2f4f7', strim: '#1d3fbf', shoes: ['#1d3fbf', '#f2f2f2', '#ffffff'] },
  { base: '#0f5132', trim: '#e9d38a', number: '#e9d38a', shorts: '#0f5132', strim: '#e9d38a', shoes: ['#101010', '#e9d38a', '#e9d38a'] },
  { base: '#ff7a45', trim: '#1a1a1a', number: '#1a1a1a', shorts: '#1a1a1a', strim: '#ff7a45', shoes: ['#1a1a1a', '#ff7a45', '#ffffff'] },
  { base: '#6b2fa0', trim: '#f2c94c', number: '#f2c94c', shorts: '#6b2fa0', strim: '#f2c94c', shoes: ['#f4f4f4', '#6b2fa0', '#f2c94c'] },
];

class HumanController {
  constructor(app) {
    this.app = app;
    this.athlete = null;
  }
  update(dt) {
    const a = this.athlete;
    const app = this.app;
    const offense = a.hasBall() || !a.isDefending();
    app.input.sample(a.input, app.view.cameraRig.getYaw(), { offense }, dt);
    // celebrations bypass the dead-ball input lock
    if (a.input.emote && app.canEmote()) {
      const id = ITEM[app.profile.data.equipped.emote]?.data.emote || 'fist';
      a.setAction(new EmoteAction(a, id));
      app.emoteUsed = true;
    }
  }
}

export class App {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.uiRoot = uiRoot;
    this.events = new EventBus();
    this.profile = new Profile(this.events);
    const s = this.profile.settings;
    this.qualitySetting = s.graphics.quality;
    const q = this.qualitySetting === 'auto' ? this._autoQuality() : this.qualitySetting;
    this.renderer = new Renderer(canvas, q);
    this.input = new Input(window);
    this.audio = new AudioManager();
    this.game = new Game(this.events);
    this.view = new GameView(this.renderer, this.game, this.events, { quality: q });
    this.acc = 0;
    this.last = 0;
    this.running = false;
    this.timeScale = 1;
    this.frameTimes = new Float32Array(120);
    this.frameIdx = 0;
    this.fps = 60;
    this.mode = 'boot';
    this.paused = false;
    this.matchOpts = null;
    this.practiceOpts = null;
    this.lastUserScoreT = -10;
    this.emoteUsed = false;
    this.perfStreak = 0;
    this.maxPerfStreak = 0;
    this.maxDeficit = 0;
    this._setupAthletes();
    this.ui = new UI(this);
    this._bindEvents();
    this._bindKeys();
    this._bindPointer();
    this.applySettings();
    this.toMenu();
  }

  _autoQuality() {
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
    return mobile ? 'low' : 'high';
  }

  // ------------------------------------------------------------------------------------ setup
  _setupAthletes() {
    const g = this.game;
    this.user = g.addAthlete({ id: 'user', name: 'YOU', isUser: true, ratings: USER_RATINGS });
    this.cpu = g.addAthlete({ id: 'cpu', name: 'CPU', team: 1, ratings: aiRatings('pro') });
    this.humanCtl = new HumanController(this);
    this.aiCtl = new AIController('pro');
    this.showcaseCtl = new ShowcaseController();
    g.setController(this.user, this.humanCtl);
    g.setController(this.cpu, this.aiCtl);
    this.view.addAthlete(this.user, lookFromProfile(this.profile.data));
    this.view.addAthlete(this.cpu, this._cpuLook(0));
    this.audioOff = bindGameAudio(this.audio, this.events, () => this.user);
  }

  _cpuLook(seed) {
    let kit = CPU_KITS[seed % CPU_KITS.length];
    const userJersey = ITEM[this.profile.data.equipped.jersey]?.data.base;
    if (kit.base === userJersey) kit = CPU_KITS[(seed + 1) % CPU_KITS.length];
    return {
      skin: SKIN_TONES[(seed * 3 + 2) % SKIN_TONES.length],
      hair: HAIR_STYLES[(seed * 5 + 2) % HAIR_STYLES.length],
      hairColor: '#120c08',
      number: [0, 1, 3, 11, 13, 22, 23, 30, 33, 77][seed % 10],
      jersey: { base: kit.base, trim: kit.trim, number: kit.number, pattern: 'solid' },
      shorts: { base: kit.shorts, trim: kit.strim },
      shoes: { upper: kit.shoes[0], sole: kit.shoes[1], accent: kit.shoes[2] },
      headband: seed % 3 === 0 ? '#f2f4f7' : null,
      wristbands: seed % 2 === 0 ? kit.trim : null,
    };
  }

  applyLook() {
    this.view.setLook(this.user, lookFromProfile(this.profile.data));
    const eq = this.profile.data.equipped;
    this.view.ballView.setSkin(ITEM[eq.ball]?.data.skin || 'classic');
    this.view.arena.setTheme(ITEM[eq.court]?.data.theme || 'classic');
    this.view.ballView.setTrail(ITEM[eq.trail]?.data.color || null);
    this.user.jumpshot = ITEM[eq.jumpshot]?.data.style || 'classic';
  }

  /** Temporarily show a look (shop / locker previews) without saving. */
  previewLook(look, extra = {}) {
    this.view.setLook(this.user, look);
    if (extra.ball) this.view.ballView.setSkin(extra.ball);
    if (extra.court) this.view.arena.setTheme(extra.court);
    if (extra.trail !== undefined) this.view.ballView.setTrail(extra.trail);
  }

  applySettings() {
    const s = this.profile.settings;
    this.audio.setVolumes(s.audio);
    const cam = this.view.cameraRig;
    cam.setPreset(s.camera.preset);
    cam.settings.distance = s.camera.distance;
    cam.settings.height = s.camera.height;
    cam.settings.fov = s.camera.fov;
    cam.settings.smoothing = s.camera.smoothing;
    cam.settings.shake = s.camera.shake;
    this.game.userTimingMul = { relaxed: 0.75, normal: 1, pro: 1.3 }[s.gameplay.timing] || 1;
    if (s.graphics.quality !== this.qualitySetting) {
      this.qualitySetting = s.graphics.quality;
      this.setQuality(s.graphics.quality === 'auto' ? this._autoQuality() : s.graphics.quality);
    }
    if (this.ui && this.ui.hud) this.ui.hud.applySettings();
  }

  setQuality(q) {
    this.renderer.setQuality(q);
    const key = this.view.arena.key;
    const size = q === 'low' ? 1024 : 2048;
    if (key.shadow.mapSize.x !== size) {
      key.shadow.mapSize.set(size, size);
      if (key.shadow.map) {
        key.shadow.map.dispose();
        key.shadow.map = null;
      }
    }
  }

  // ------------------------------------------------------------------------------------ events
  _bindEvents() {
    const ev = this.events;
    const fx = this.view.effects;
    ev.on('shot:release', (e) => {
      const g = e.shot.grade;
      if (!g || e.shot.kind === 'dunk' || e.athlete !== this.user) return;
      const m = e.athlete.shotMeter;
      if (m && m.delta !== undefined) {
        this.profile.pushRelease(m.delta, g.id);
        this.ui.hud.renderReleases();
      }
      if (g.id === 'perfect') {
        this.perfStreak++;
        this.maxPerfStreak = Math.max(this.maxPerfStreak, this.perfStreak);
        const col = ITEM[this.profile.data.equipped.effect]?.data.color || '#3dff8a';
        const b = this.game.ball.pos;
        fx.burst(b.x, b.y, b.z, col, 46, 3.4, 0.7, 0.13, 1.5);
        this.audio.play('green', { vol: 0.75, bus: 'ui' });
        this.ui.hud.flash(col);
      } else {
        this.perfStreak = 0;
        this.audio.play('release', { vol: 0.5, bus: 'ui' });
      }
    });
    ev.on('ball:score', () => fx.burst(0, HOOP.rimY - 0.3, 0, '#ffffff', 26, 1.6, 0.6, 0.06, 2));
    ev.on('dunk', () => {
      fx.shockwave(0, 0.6, '#2ad4ff', 3.5);
      fx.burst(0, HOOP.rimY, 0, '#2ad4ff', 60, 4, 0.8, 0.12, 3);
      this.view.cameraRig.addShake(0.7);
      this.view.cameraRig.pulse(1.2);
    });
    ev.on('block', () => {
      const b = this.game.ball.pos;
      fx.burst(b.x, b.y, b.z, '#ffffff', 30, 3, 0.5, 0.08, 3);
      this.view.cameraRig.addShake(0.35);
    });
    ev.on('steal', () => {
      const b = this.game.ball.pos;
      fx.burst(b.x, b.y, b.z, '#2ad4ff', 18, 2, 0.4, 0.07, 3);
    });
    ev.on('ankles', (e) => {
      fx.shockwave(e.athlete.pos.x, e.athlete.pos.z, '#ffc94a', 2.2);
      this.view.cameraRig.addShake(0.25);
    });
    ev.on('rules:score', (e) => {
      if (e.athlete === this.user) {
        this.lastUserScoreT = this.game.time;
        this.emoteUsed = false;
        this.view.cameraRig.pulse(e.value === 2 ? 1 : 0.6);
        if (this.mode === 'practice') this.profile.questProgress('practiceMake', 1);
        if (this.mode === 'match' && Math.random() < 0.55) {
          const c = this.cpu;
          setTimeout(() => {
            if (this.mode === 'match' && !c.action && this.game.rules && this.game.rules.state === 'dead') c.setAction(new EmoteAction(c, 'hips'));
          }, 500);
        }
      } else if (this.mode === 'match' && Math.random() < 0.35) {
        const c = this.cpu;
        setTimeout(() => {
          if (this.mode === 'match' && !c.action && this.game.rules && this.game.rules.state === 'dead') c.setAction(new EmoteAction(c, pick(['fist', 'point', 'shrug', 'flex', 'chest'])));
        }, 450);
      }
      if (this.mode === 'match') {
        const r = this.game.rules;
        this.maxDeficit = Math.max(this.maxDeficit, r.getScore(this.cpu) - r.getScore(this.user));
      }
      this.audio.setCrowd(0.9);
      setTimeout(() => this.audio.setCrowd(0.4), 2500);
    });
    ev.on('rules:over', (e) => {
      const winner = e.winner;
      setTimeout(() => {
        if (this.mode !== 'match') return;
        const id = winner === this.user ? ITEM[this.profile.data.equipped.emote]?.data.emote || 'fist' : 'flex';
        winner.setAction(new EmoteAction(winner, id));
        if (winner === this.user) fx.confetti(0, 4, 5, ['#2ad4ff', '#3dff8a', '#ffffff', '#ffc94a'], 160);
      }, 500);
      setTimeout(() => this._endMatch(e), 2600);
    });
    // hide check-ball repositioning behind a quick fade; camera snaps while black
    ev.on('rules:preCheck', () => {
      if (this.mode === 'match') this.ui.fade(true);
    });
    ev.on('rules:state', (e) => {
      if (e.state === 'check' && this.mode === 'match') {
        this._primeCamera();
        setTimeout(() => this.ui.fade(false), 140);
      }
    });
    ev.on('achievement', (e) => this.ui.toast(`Achievement · ${e.achievement.name}`, 'gold'));
    ev.on('quest:complete', (e) => {
      for (const q of e.quests) this.ui.toast(`Quest complete · ${q.text}`, 'green');
    });
  }

  canEmote() {
    return this.mode === 'match' && !this.emoteUsed && this.game.time - this.lastUserScoreT < 2.2 && this.game.rules && this.game.rules.state === 'dead';
  }

  _bindKeys() {
    this.input.onKey = (e) => {
      this.audio.init(); // first gesture unlocks audio
      if (this.audio.ready && this.mode !== 'boot') this.audio.startAmbience();
      if (e.code === 'Escape' || e.code === 'KeyP') {
        if (this.mode === 'match' || this.mode === 'practice') {
          if (this.ui.isOverlayOpen()) this.ui.closeOverlay();
          else this.togglePause();
          return true;
        }
        if (this.mode === 'menu' || this.mode === 'end') {
          this.ui.back();
          return true;
        }
      }
      if (this.paused || this.mode === 'menu' || this.mode === 'end') return true;
      if (e.code === 'KeyC') {
        this.cycleCamera();
        return true;
      }
      if (e.code === 'KeyM') {
        this.toggleMute();
        return true;
      }
      if (e.code === 'KeyR' && this.mode === 'practice') {
        this.practiceReset();
        return true;
      }
      if (e.code === 'F3') {
        this.profile.settings.graphics.showFps = !this.profile.settings.graphics.showFps;
        this.profile.save();
        this.ui.hud.applySettings();
        return true;
      }
      return false;
    };
  }

  _bindPointer() {
    let dragging = false;
    let lastX = 0;
    this.canvas.addEventListener('pointerdown', (e) => {
      this.audio.init();
      if (this.mode !== 'match' && this.mode !== 'practice') return;
      dragging = true;
      lastX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      lastX = e.clientX;
      this.view.cameraRig.addOrbit(-dx * 0.004 * this.profile.settings.camera.smoothing);
    });
    const up = () => (dragging = false);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
    window.addEventListener('pointerdown', () => {
      this.audio.init();
      if (this.audio.ready) this.audio.startAmbience();
    });
  }

  cycleCamera() {
    const order = ['iso', 'high', 'close', 'broadcast'];
    const s = this.profile.settings.camera;
    s.preset = order[(order.indexOf(s.preset) + 1) % order.length];
    this.profile.save();
    this.view.cameraRig.setPreset(s.preset);
    this.ui.toast(`Camera · ${s.preset}`, 'cyan');
  }

  toggleMute() {
    const a = this.profile.settings.audio;
    a.muted = !a.muted;
    this.profile.save();
    this.audio.setVolumes(a);
    if (this.ui.hud) this.ui.hud.syncButtons();
    this.ui.toast(a.muted ? 'Sound off' : 'Sound on', 'cyan');
  }

  // ------------------------------------------------------------------------------------ modes
  _disposeRules() {
    if (this.game.rules && this.game.rules.dispose) this.game.rules.dispose();
    this.game.rules = null;
    this.game.pickupFilter = null;
  }

  _resetAthletes() {
    for (const a of this.game.athletes) {
      a.setAction(null);
      a.stamina = 1;
      a.offBalance = 0;
      a.stumble = 0;
      a.cooldowns.steal = 0;
      a.cooldowns.jump = 0;
      a.recentMoves.length = 0;
    }
  }

  toMenu() {
    this.paused = false;
    this.game.paused = false;
    this._disposeRules();
    this._resetAthletes();
    this.mode = 'menu';
    this.cpu.inPlay = false;
    this.view.chars.get(this.cpu).setVisible(false);
    this.view.setRingsVisible(false);
    this.game.setController(this.user, this.showcaseCtl);
    this.game.inputLocked = false;
    this.game.allowPickup = true;
    this.applyLook();
    this.user.place(0, 9.5, Math.PI);
    this.game.giveBall(this.user);
    this.game.ball.pos.set(0, 1.0, 9.2);
    this.game.ball.prevPos.copy(this.game.ball.pos);
    this.view.cameraRig.mode = 'menu';
    this.view.cameraRig.snap();
    this.ui.showMenu();
    this.audio.setCrowd(0.25);
  }

  openLocker() {
    this.view.cameraRig.mode = 'locker';
    this.view.cameraRig.snap();
  }

  closeLocker() {
    this.applyLook();
    this.view.cameraRig.mode = 'menu';
    this.view.cameraRig.snap();
  }

  startMatch(opts) {
    const s = this.profile.settings.gameplay;
    opts = Object.assign(
      { difficulty: s.difficulty, target: s.target, shotClock: s.shotClock, winBy2: s.winBy2, timeLimit: s.timeLimit, makeItTakeIt: s.makeItTakeIt },
      opts || {}
    );
    this.matchOpts = opts;
    this.paused = false;
    this.game.paused = false;
    this._disposeRules();
    this._resetAthletes();
    this.mode = 'match';
    this.applyLook();
    const seed = Math.floor(Math.random() * 1000);
    const cpu = this.cpu;
    cpu.inPlay = true;
    cpu.ratings = aiRatings(opts.difficulty);
    cpu.name = CPU_NAMES[seed % CPU_NAMES.length];
    cpu.jumpshot = pick(['classic', 'quick', 'high', 'sling']);
    this.view.setLook(cpu, this._cpuLook(seed));
    this.view.chars.get(cpu).setVisible(true);
    this.view.setRingsVisible(true);
    this.aiCtl = new AIController(opts.difficulty);
    this.game.setController(this.user, this.humanCtl);
    this.game.setController(cpu, this.aiCtl);
    const rules = new MatchRules(this.game, {
      target: opts.target,
      shotClock: opts.shotClock,
      winBy2: opts.winBy2,
      timeLimit: (opts.timeLimit || 0) * 60,
      makeItTakeIt: opts.makeItTakeIt,
    });
    this.game.rules = rules;
    this.perfStreak = 0;
    this.maxPerfStreak = 0;
    this.maxDeficit = 0;
    this.view.cameraRig.mode = 'game';
    rules.start(this.user);
    this._primeCamera();
    this.ui.showHUD('match');
    this.audio.init();
    this.audio.startAmbience();
    this.audio.setCrowd(0.4);
    this.input.clearAll();
  }

  startPractice(opts) {
    const s = this.profile.settings.practice;
    opts = Object.assign({ defender: s.defender, aiLevel: s.aiLevel, shotClock: s.shotClock, rebounder: s.rebounder }, opts || {});
    this.practiceOpts = opts;
    this.paused = false;
    this.game.paused = false;
    this._disposeRules();
    this._resetAthletes();
    this.mode = 'practice';
    this.applyLook();
    const cpu = this.cpu;
    cpu.inPlay = opts.defender !== 'off';
    this.view.chars.get(cpu).setVisible(cpu.inPlay);
    this.view.setRingsVisible(true);
    this.view.rings.get(cpu).ring.visible = cpu.inPlay;
    this.view.rings.get(cpu).glow.visible = cpu.inPlay;
    if (cpu.inPlay) {
      cpu.ratings = aiRatings(opts.aiLevel);
      cpu.name = 'DEFENDER';
      this.view.setLook(cpu, this._cpuLook(7));
      this.aiCtl = new AIController(opts.aiLevel);
      this.aiCtl.mode = opts.defender === 'stationary' ? 'stationary' : 'normal';
      this.game.setController(cpu, this.aiCtl);
    }
    this.game.setController(this.user, this.humanCtl);
    const rules = new PracticeRules(this.game, this.user, cpu.inPlay ? cpu : null, { shotClock: opts.shotClock, rebounder: opts.rebounder });
    this.game.rules = rules;
    this.game.pickupFilter = (a) => a === this.user;
    this.perfStreak = 0;
    this.view.cameraRig.mode = 'game';
    rules.start();
    this._primeCamera();
    this.ui.showHUD('practice');
    this.audio.init();
    this.audio.startAmbience();
    this.audio.setCrowd(0.2);
    this.input.clearAll();
  }

  /** Snap the game camera and compute its yaw now, so the first input ticks are camera-relative. */
  _primeCamera() {
    const cam = this.view.cameraRig;
    cam.snap();
    cam.update(1 / 60, this.game, this.user);
    this.input.ctrlYaw = undefined;
  }

  practiceReset() {
    const r = this.game.rules;
    if (!r || r.kind !== 'practice') return;
    const u = this.user;
    const x = Math.max(-7, Math.min(7, u.pos.x));
    const z = Math.max(0.6, Math.min(11.5, u.pos.z));
    r.reset(x, z);
    this._primeCamera();
  }

  togglePause() {
    if (this.paused) this.resume();
    else this.pause();
  }

  pause() {
    if (this.mode !== 'match' && this.mode !== 'practice') return;
    this.paused = true;
    this.game.paused = true;
    this.input.clearAll();
    this.ui.showPause();
  }

  resume() {
    this.paused = false;
    this.game.paused = false;
    this.input.clearAll();
    this.ui.hidePause();
  }

  restart() {
    if (this.mode === 'practice') this.startPractice(this.practiceOpts);
    else this.startMatch(this.matchOpts);
  }

  quitToMenu() {
    if (this.mode === 'practice') this._recordPractice();
    this.toMenu();
  }

  _recordPractice() {
    const r = this.game.rules;
    if (r && r.kind === 'practice') {
      const st = r.stats.get(this.user);
      this.profile.recordPractice(r.session.makes, r.session.attempts, st.perfectMade);
    }
  }

  _endMatch(e) {
    if (this.mode !== 'match') return;
    const r = this.game.rules;
    const us = r.stats.get(this.user);
    const them = r.stats.get(this.cpu);
    const won = e.winner === this.user;
    const info = {
      won,
      userScore: r.getScore(this.user),
      oppScore: r.getScore(this.cpu),
      difficulty: this.matchOpts.difficulty,
      maxDeficit: this.maxDeficit,
      perfectStreakMax: this.maxPerfStreak,
      duration: r.gameTime,
      oppName: this.cpu.name,
    };
    const summary = this.profile.recordMatch(us, them, info);
    this.mode = 'end';
    this.game.inputLocked = true;
    this.ui.showEnd({ info, us, them, summary, gameTime: r.gameTime });
  }

  // ------------------------------------------------------------------------------------ loop
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
    if (dt > 0.1) dt = 0.1;
    if (dt < 0) dt = 0;
    if (this.manual) {
      this.view.render(1, 0);
      this.ui.update(0);
      return;
    }
    const t0 = performance.now();
    if (!this.paused) {
      this.acc += dt * this.timeScale;
      let steps = 0;
      while (this.acc >= SIM_DT && steps < 12) {
        this.game.step(SIM_DT);
        this.acc -= SIM_DT;
        steps++;
      }
    }
    const alpha = Math.min(1, this.acc / SIM_DT);
    const cam = this.renderer.camera;
    this.audio.setListener(cam.position.x, cam.position.z, this.view.cameraRig.getYaw());
    this.view.render(alpha, this.paused ? 0 : dt);
    this.ui.update(dt);
    this.frameTimes[this.frameIdx++ % this.frameTimes.length] = performance.now() - t0;
    this.fps += (1 / Math.max(dt, 1e-3) - this.fps) * 0.05;
    this._qualityGovernor(dt);
  }

  _qualityGovernor(dt) {
    if (this.qualitySetting !== 'auto' || this.manual) return;
    this._govT = (this._govT || 0) + dt;
    this._govN = (this._govN || 0) + 1;
    this._govSum = (this._govSum || 0) + dt;
    if (this._govT > 4) {
      const avg = this._govSum / this._govN;
      if (avg > 1 / 42 && this.renderer.qualityId !== 'low') this.setQuality(this.renderer.qualityId === 'high' ? 'medium' : 'low');
      this._govT = this._govN = this._govSum = 0;
    }
  }

  /** Advance the simulation (and camera/effects) deterministically. Used by automated tests. */
  simulate(seconds, frameDt = 1 / 60) {
    this.manual = true;
    let t = 0;
    while (t < seconds - 1e-9) {
      this.acc += frameDt;
      while (this.acc >= SIM_DT) {
        if (!this.paused) this.game.step(SIM_DT);
        this.acc -= SIM_DT;
      }
      this.view.update(Math.min(1, this.acc / SIM_DT), frameDt);
      this.ui.update(frameDt);
      t += frameDt;
    }
  }
}
