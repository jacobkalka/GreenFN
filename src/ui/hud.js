// In-game HUD: scoreboard, clocks, release tracker, stamina, contextual hints, shot meter that
// follows the player, release feedback, announcements and the controls overlay.
import * as THREE from 'three';
import { el, esc, fmt, ICON } from './dom.js';
import { AI_LEVELS } from '../sim/ai.js';
import { Handling } from '../sim/athlete.js';
import { BallState } from '../sim/ball.js';
import { controlsTable } from './ui.js';

const _v = new THREE.Vector3();

export class HUD {
  constructor(app, ui) {
    this.app = app;
    this.ui = ui;
    this.mode = 'match';
    this.el = el(`<div id="hud" class="screen">
      <div class="hud-tl"><div class="mode-tag"><span class="mt"></span><span class="gclock num"></span></div></div>
      <div class="scoreboard">
        <div class="sb-team user sb-l"><span class="nm"><span class="poss"></span><span class="n1">YOU</span></span><span class="pts num p1">0</span></div>
        <div class="sb-mid"><div class="sb-clock num">24</div><div class="sb-target">TO 11</div></div>
        <div class="sb-team sb-r"><span class="nm"><span class="poss"></span><span class="n2">CPU</span></span><span class="pts num p2">0</span></div>
      </div>
      <div class="hud-tr interactive">
        <button class="icon-btn" data-act="camera" title="Camera (C)">${ICON.camera}</button>
        <button class="icon-btn snd" data-act="mute" title="Sound (M)">${ICON.sound}</button>
        <button class="icon-btn" data-act="pause" title="Pause (Esc)">${ICON.pause}</button>
      </div>
      <div class="release-panel"><div class="hd"><span>Release timing</span><span class="rc num">0/20</span></div><div class="release-plot"><div class="win"></div></div><div class="ax"><span>Early</span><span>Late</span></div><div class="sub">Hold <span class="kbd" style="height:18px;min-width:18px;font-size:11px">Space</span>, release at the top.</div></div>
      <div class="practice-panel hidden"><div class="eyebrow" style="margin-bottom:6px">Session</div>
        <div class="row"><span>Makes</span><b class="pm num">0/0</b></div>
        <div class="row"><span>Percentage</span><b class="pp num">—</b></div>
        <div class="row"><span>Streak</span><b class="ps num">0</b></div>
        <div class="row"><span>Best streak</span><b class="pb num">0</b></div>
        <div class="row"><span>Greens</span><b class="pg num">0</b></div>
        <div class="row" style="margin-top:8px"><span><span class="kbd" style="height:18px;min-width:18px;font-size:11px">R</span> reset ball</span></div>
      </div>
      <div class="stamina"><div class="hd"><span>Stamina</span><span class="sv num">100</span></div><div class="bar"><i style="width:100%"></i></div></div>
      <div class="hints"></div>
      <div class="meter"><div class="zone"></div><div class="fill"></div></div>
      <div class="fb-layer"></div>
      <div class="announce"></div>
      <div class="flash"></div>
      <div class="fps hidden"></div>
      <div class="screen overlay controls-ov"><div class="panel-screen" style="position:absolute;inset:0;background:rgba(3,4,6,.94)"><div class="panel-head"><button class="icon-btn" data-act="close-controls">${ICON.close}</button><h2>Controls</h2></div><div class="panel-body">${controlsTable()}</div></div></div>
    </div>`);
    const q = (s) => this.el.querySelector(s);
    this.$ = {
      mt: q('.mt'),
      gclock: q('.gclock'),
      n1: q('.n1'),
      n2: q('.n2'),
      p1: q('.p1'),
      p2: q('.p2'),
      t1: q('.sb-team.sb-l'),
      t2: q('.sb-team.sb-r'),
      clock: q('.sb-clock'),
      target: q('.sb-target'),
      snd: q('.snd'),
      rel: q('.release-panel'),
      plot: q('.release-plot'),
      rc: q('.rc'),
      prac: q('.practice-panel'),
      pm: q('.pm'),
      pp: q('.pp'),
      ps: q('.ps'),
      pb: q('.pb'),
      pg: q('.pg'),
      stam: q('.stamina'),
      stamBar: q('.stamina .bar i'),
      sv: q('.sv'),
      hints: q('.hints'),
      meter: q('.meter'),
      fill: q('.meter .fill'),
      zone: q('.meter .zone'),
      fb: q('.fb-layer'),
      ann: q('.announce'),
      flash: q('.flash'),
      fps: q('.fps'),
      controls: q('.controls-ov'),
      sb: q('.scoreboard'),
    };
    this.controlsOpen = false;
    this.meterHold = 0;
    this.lastHintKey = '';
    this.lastScores = [0, 0];
    this.meterShown = false;
    this._bind();
  }

  setMode(mode) {
    this.mode = mode;
    const practice = mode === 'practice';
    this.$.prac.classList.toggle('hidden', !practice);
    this.$.sb.classList.toggle('hidden', practice && !this.app.practiceOpts?.shotClock);
    this.$.p1.textContent = '0';
    this.$.p2.textContent = '0';
    this.lastScores = [0, 0];
    this.$.fb.innerHTML = '';
    this.$.ann.innerHTML = '';
    this.lastHintKey = '';
    this.renderReleases();
    this.applySettings();
    this.syncButtons();
  }

  applySettings() {
    const s = this.app.profile.settings;
    this.$.fps.classList.toggle('hidden', !s.graphics.showFps);
    this.$.hints.classList.toggle('hidden', !s.gameplay.hints);
  }

  syncButtons() {
    const muted = this.app.profile.settings.audio.muted;
    this.$.snd.innerHTML = muted ? ICON.mute : ICON.sound;
    this.$.snd.classList.toggle('active', !muted);
  }

  toggleControls(on) {
    this.controlsOpen = on;
    this.$.controls.classList.toggle('show', on);
  }

  flash(color) {
    const f = this.$.flash;
    f.style.background = `radial-gradient(circle at 50% 60%, ${color}33, transparent 60%)`;
    f.classList.remove('on');
    void f.offsetWidth;
    f.classList.add('on');
  }

  announce(text, sub = '', color = '') {
    const a = el(`<div class="a" style="${color ? 'color:' + color : ''}">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`);
    this.$.ann.innerHTML = '';
    this.$.ann.appendChild(a);
    setTimeout(() => a.remove(), 1700);
  }

  feedback(text, color, sub = '') {
    const u = this.app.user;
    const p = this._project(u.pos.x, u.pos.y + 2.45, u.pos.z);
    const f = el(`<div class="feedback" style="left:${p.x}px;top:${p.y}px;color:${color}">${esc(text)}${sub ? `<small>${esc(sub)}</small>` : ''}</div>`);
    this.$.fb.appendChild(f);
    setTimeout(() => f.remove(), 1150);
  }

  _project(x, y, z) {
    const cam = this.app.renderer.camera;
    _v.set(x, y, z).project(cam);
    return { x: ((_v.x + 1) / 2) * window.innerWidth, y: ((1 - _v.y) / 2) * window.innerHeight, behind: _v.z > 1 };
  }

  _bind() {
    const ev = this.app.events;
    const app = this.app;
    const isUser = (a) => a === app.user;
    ev.on('shot:release', (e) => {
      if (!this._active()) return;
      if (isUser(e.athlete)) {
        const g = e.shot.grade;
        if (!g || e.shot.kind === 'dunk') return;
        const color = g.id === 'perfect' ? 'var(--green)' : g.id === 'early' || g.id === 'late' ? 'var(--gold)' : 'var(--red)';
        const ms = Math.round((app.user.shotMeter?.delta || 0) * 1000);
        this.feedback(g.label, color, g.id === 'perfect' ? '' : `${ms > 0 ? '+' : ''}${ms} ms`);
        this.meterHold = 0.7;
        this.renderReleases();
      }
    });
    ev.on('rules:state', (e) => {
      if (!this._active() || this.mode !== 'match') return;
      if (e.state === 'check') {
        const yours = e.offense === app.user;
        this.announce('Check', yours ? 'Your ball' : `${app.cpu.name}'s ball`, yours ? 'var(--accent)' : '');
      } else if (e.state === 'dead' && e.reason && e.reason !== 'Score') {
        this.announce(e.reason === 'Ball not cleared' ? 'No basket' : e.reason, e.reason === 'Ball not cleared' ? 'Clear the ball first' : e.next === app.user ? 'Your ball' : 'Turnover', 'var(--red)');
      }
    });
    ev.on('rules:score', (e) => {
      if (!this._active()) return;
      const r = app.game.rules;
      if (this.mode === 'practice') {
        if (e.swish) this.feedback('Swish', '#fff');
        return;
      }
      const who = isUser(e.athlete) ? 'You' : e.athlete.name;
      let text = `+${e.value}`;
      let sub = who;
      if (e.how === 'goaltend') sub = `${who} · goaltending`;
      else if (e.shot && e.shot.kind === 'dunk') text = 'Slam';
      else if (e.swish) sub = `${who} · swish`;
      this.announce(text, sub, isUser(e.athlete) ? 'var(--accent)' : '#fff');
      // game point
      if (r && r.state !== 'over') {
        const a = r.getScore(app.user);
        const b = r.getScore(app.cpu);
        if (Math.max(a, b) >= r.target - 2 && Math.max(a, b) < r.target) setTimeout(() => this._active() && this.announce('Game point', a > b ? 'You' : app.cpu.name, 'var(--gold)'), 1100);
      }
    });
    ev.on('rules:event', (e) => {
      if (!this._active()) return;
      if (e.type === 'steal') this.announce(isUser(e.who) ? 'Steal' : 'Stolen', isUser(e.who) ? 'Clear it out' : e.who.name, isUser(e.who) ? 'var(--accent)' : 'var(--red)');
      if (e.type === 'block') this.announce(isUser(e.who) ? 'Rejected' : 'Blocked', isUser(e.who) ? 'You' : e.who.name, isUser(e.who) ? 'var(--accent)' : 'var(--red)');
    });
    ev.on('rules:possession', (e) => {
      if (!this._active() || this.mode !== 'match') return;
      if (isUser(e.offense) && e.clear) this.ui.toast('Clear the ball beyond the arc', 'cyan');
    });
    ev.on('rules:cleared', (e) => {
      if (this._active() && isUser(e.athlete)) this.ui.toast('Cleared', 'green');
    });
    ev.on('ankles', (e) => {
      if (this._active()) this.announce('Ankles', isUser(e.athlete) ? 'You lost your footing' : 'Defender down', 'var(--gold)');
    });
    ev.on('rules:suddenDeath', () => this._active() && this.announce('Next bucket wins', '', 'var(--gold)'));
    ev.on('rules:over', (e) => {
      if (!this._active()) return;
      const won = isUser(e.winner);
      this.announce(won ? 'You win' : `${e.winner.name} wins`, 'Game', won ? 'var(--accent)' : '#fff');
    });
    ev.on('practice:miss', () => {
      if (this._active()) this.renderPractice();
    });
  }

  _active() {
    return this.el.classList.contains('show');
  }

  renderReleases() {
    const hist = this.app.profile.data.releaseHistory;
    const plot = this.$.plot;
    plot.querySelectorAll('i').forEach((n) => n.remove());
    const w = 0.14; // seconds each side shown
    hist.forEach(([ms, grade], i) => {
      const x = 50 + (Math.max(-w, Math.min(w, ms / 1000)) / w) * 50;
      const y = 8 + ((i * 37) % 30);
      const d = document.createElement('i');
      if (grade === 'perfect') d.className = 'g';
      if (i === hist.length - 1) d.classList.add('last');
      d.style.left = `${x}%`;
      d.style.top = `${y}px`;
      d.style.opacity = String(0.35 + (0.65 * (i + 1)) / hist.length);
      plot.appendChild(d);
    });
    // window band ≈ perfect window for a mid-range shot
    const win = 0.036 / w;
    plot.querySelector('.win').style.width = `${win * 100}%`;
    this.$.rc.textContent = `${hist.length}/20`;
  }

  renderPractice() {
    const r = this.app.game.rules;
    if (!r || r.kind !== 'practice') return;
    const s = r.session;
    const st = r.stats.get(this.app.user);
    this.$.pm.textContent = `${s.makes}/${s.attempts}`;
    this.$.pp.textContent = fmt.pct(s.makes, s.attempts);
    this.$.ps.textContent = s.streak;
    this.$.pb.textContent = s.best;
    this.$.pg.textContent = st.perfectMade;
  }

  _hints() {
    const app = this.app;
    const u = app.user;
    const r = app.game.rules;
    let key = '';
    let html = '';
    const h = (k, label) => `<span class="h">${k.map((x) => `<span class="kbd">${x}</span>`).join('')}${label}</span>`;
    if (app.canEmote && app.canEmote()) {
      key = 'emote';
      html = `<span class="ctx">Bucket</span>${h(['T'], 'celebrate')}`;
    } else if (u.hasBall()) {
      if (u.handling === Handling.TRIPLE) {
        key = 'triple';
        html = `<span class="ctx">Triple threat</span>${h(['WASD'], 'attack')}${h(['Space'], 'shoot · tap to fake')}${h(['J'], 'jab cross')}${h(['H'], 'burst')}`;
      } else if (u.handling === Handling.PICKED) {
        key = 'picked';
        html = `<span class="ctx">Picked up</span>${h(['Space'], 'shoot · tap to fake')}`;
      } else {
        key = 'offense';
        html = `<div class="hrow"><span class="ctx">Offense</span>${h(['WASD'], 'move')}${h(['Shift'], 'sprint')}${h(['Space'], 'hold shoot · tap fake')}</div><div class="hrow moves">${h(['J'], 'cross')}${h(['K'], 'btw legs')}${h(['L'], 'behind')}${h(['U'], 'spin')}${h(['I'], 'hesi')}${h(['O'], 'stepback')}${h(['H'], 'burst')}${h(['N'], 'pace')}</div>`;
      }
      if (r && r.needsClear && r.needsClear(u)) {
        key += '-clear';
        html = `<span class="ctx" style="color:var(--gold)">Clear it</span>${h(['WASD'], 'take it beyond the arc')}${h(['Shift'], 'sprint')}`;
      }
    } else if (u.isDefending()) {
      key = 'defense';
      html = `<span class="ctx">Defense</span>${h(['WASD'], 'slide')}${h(['Shift'], 'sprint')}${h(['J'], 'steal')}${h(['Space'], 'contest / block')}`;
    } else if (r && (r.state === 'dead' || r.state === 'check')) {
      key = 'dead';
      html = `<span class="ctx">${r.state === 'check' ? 'Check ball' : 'Dead ball'}</span>${h(['Esc'], 'pause')}${h(['C'], 'camera')}`;
    } else if (app.game.ball.state === BallState.FREE) {
      key = 'loose';
      html = `<span class="ctx">Loose ball</span>${h(['WASD'], 'go get it')}${h(['Shift'], 'sprint')}${h(['Space'], 'jump')}`;
    } else {
      key = 'wait';
      html = `<span class="ctx">Ready</span>${h(['Esc'], 'pause')}${h(['C'], 'camera')}`;
    }
    if (this.mode === 'practice') {
      key += '-p';
      html += h(['R'], 'reset');
    }
    if (key !== this.lastHintKey) {
      this.lastHintKey = key;
      this.$.hints.innerHTML = html;
    }
  }

  update(dt) {
    const app = this.app;
    const r = app.game.rules;
    const u = app.user;
    const cpu = app.cpu;
    if (!r) return;
    // ---- scoreboard / clocks
    if (this.mode === 'match') {
      const a = r.getScore(u);
      const b = r.getScore(cpu);
      if (a !== this.lastScores[0]) {
        this.$.p1.textContent = a;
        this.$.p1.classList.remove('sb-bump');
        void this.$.p1.offsetWidth;
        this.$.p1.classList.add('sb-bump');
      }
      if (b !== this.lastScores[1]) {
        this.$.p2.textContent = b;
        this.$.p2.classList.remove('sb-bump');
        void this.$.p2.offsetWidth;
        this.$.p2.classList.add('sb-bump');
      }
      this.lastScores[0] = a;
      this.lastScores[1] = b;
      this.$.n1.textContent = app.profile.data.name;
      this.$.n2.textContent = cpu.name;
      this.$.target.textContent = `TO ${r.target}`;
      this.$.t1.classList.toggle('has', r.offense === u);
      this.$.t2.classList.toggle('has', r.offense === cpu);
      const sc = r.shotClockOn ? Math.ceil(r.shotClock) : '—';
      this.$.clock.textContent = sc;
      this.$.clock.classList.toggle('warn', r.shotClockOn && r.shotClock <= 5);
      this.$.mt.textContent = `1v1 · ${AI_LEVELS[app.matchOpts.difficulty].name}`;
      this.$.gclock.textContent = r.timeLimit ? fmt.clock(Math.max(0, r.timeLimit - r.gameTime)) : fmt.clock(r.gameTime);
    } else {
      this.$.mt.textContent = 'Practice';
      this.$.gclock.textContent = '';
      if (r.shotClockOn) {
        this.$.clock.textContent = Math.ceil(r.shotClock);
        this.$.clock.classList.toggle('warn', r.shotClock <= 5);
        this.$.n1.textContent = 'YOU';
        this.$.n2.textContent = '';
        this.$.p1.textContent = r.getScore(u);
        this.$.p2.textContent = '';
      }
      this.renderPractice();
    }
    // ---- stamina
    const st = Math.round(u.stamina * 100);
    this.$.stamBar.style.width = `${st}%`;
    this.$.sv.textContent = st;
    this.$.stam.classList.toggle('low', u.stamina < 0.3);
    // ---- hints
    if (app.profile.settings.gameplay.hints) this._hints();
    // ---- shot meter
    this._meter(dt);
    // ---- fps
    if (app.profile.settings.graphics.showFps) {
      const ft = app.frameTimes.reduce((x, y) => x + y, 0) / app.frameTimes.length;
      this.$.fps.textContent = `${Math.round(app.fps)} FPS · ${ft.toFixed(1)} ms · ${app.renderer.qualityId}`;
    }
  }

  _meter(dt) {
    const app = this.app;
    const u = app.user;
    const m = u.shotMeter;
    const show = app.profile.settings.gameplay.meter && m && (m.active || this.meterHold > 0) && m.ideal > 0;
    this.meterHold = Math.max(0, this.meterHold - dt);
    const el = this.$.meter;
    if (!show) {
      if (this.meterShown) {
        el.classList.remove('show');
        this.meterShown = false;
      }
      return;
    }
    if (!this.meterShown) {
      el.className = 'meter';
      this.meterShown = true;
    }
    el.classList.add('show');
    const full = m.ideal * 1.32;
    const t = m.released ? m.releaseT : m.t;
    const k = Math.max(0, Math.min(1, t / full));
    this.$.fill.style.height = `calc(${k * 100}% - 4px)`;
    const z0 = (m.ideal - m.w) / full;
    const z1 = (m.ideal + m.w) / full;
    this.$.zone.style.bottom = `${z0 * 100}%`;
    this.$.zone.style.height = `${(z1 - z0) * 100}%`;
    if (m.released && m.grade) {
      el.classList.remove('green', 'early', 'late', 'veryEarly', 'veryLate');
      el.classList.add(m.grade.id === 'perfect' ? 'green' : m.grade.id);
    }
    // follow the player on screen (to the right of the body)
    const p = this._project(u.pos.x, u.pos.y + 1.3, u.pos.z);
    el.style.left = `${p.x + 70}px`;
    el.style.top = `${p.y - 70}px`;
  }
}
