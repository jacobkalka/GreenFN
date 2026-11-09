// UI manager: main menu dashboard, panels (play/practice setup, locker, shop, quests, progression,
// stats, settings), pause menu, end-of-game screen, toasts. Plain DOM, event delegation.
import { el, esc, fmt, ICON, LOGO_MARK } from './dom.js';
import { HUD } from './hud.js';
import { ITEMS, ITEM, CATEGORIES, RARITY, slotOf, lookFromProfile } from '../meta/catalog.js';
import { MILESTONES, ACHIEVEMENTS, xpForLevel, levelReward, DIFF_MULT, DEFAULT_SETTINGS } from '../meta/profile.js';
import { AI_LEVELS } from '../sim/ai.js';
import { JUMPSHOTS } from '../sim/shooting.js';
import { MOVE_LABELS, MOVE_KEY_LABEL } from '../core/input.js';
import { SKIN_TONES, HAIR_STYLES } from '../render/characterView.js';
import { EmoteAction } from '../sim/emotes.js';

const DIFF_INFO = {
  rookie: { pips: 1, desc: 'Slow reactions. Bites on fakes. Learn the timing.' },
  pro: { pips: 2, desc: 'Solid defender, takes good shots. A fair fight.' },
  allstar: { pips: 3, desc: 'Quick hands, tight closeouts, punishes bad shots.' },
  legend: { pips: 4, desc: 'Elite timing and discipline. Earn every bucket.' },
};

const HAIR_COLORS = ['#17110d', '#3b2416', '#6b4428', '#b8925a', '#d8d2c8', '#c0392b'];

export class UI {
  constructor(app) {
    this.app = app;
    this.profile = app.profile;
    this.root = app.uiRoot;
    this.stack = [];
    this.root.innerHTML = '';
    this.menuEl = el(`<div id="menu" class="screen"></div>`);
    this.panelEl = el(`<div id="panel" class="screen panel-screen"></div>`);
    this.pauseEl = el(`<div id="pause" class="screen overlay"></div>`);
    this.endEl = el(`<div id="end" class="screen overlay"></div>`);
    this.toasts = el(`<div class="toast-stack"></div>`);
    this.fadeEl = el(`<div class="fade"></div>`);
    this.hud = new HUD(app, this);
    this.root.append(this.menuEl, this.hud.el, this.panelEl, this.pauseEl, this.endEl, this.toasts, this.fadeEl);
    this.page = null;
    this.tab = {};
    this.sel = {};
    this._bindDelegates();
    app.events.on('profile:changed', () => {
      if (this.menuEl.classList.contains('show')) this.renderMenu();
    });
  }

  sound(name) {
    this.app.audio.init();
    this.app.audio.play(name, { bus: 'ui', vol: name === 'uiHover' ? 0.35 : 0.8, cooldown: 0.04 });
  }

  _bindDelegates() {
    const onClick = (e) => {
      const t = e.target.closest('[data-act]');
      if (!t) return;
      e.preventDefault();
      const act = t.dataset.act;
      const arg = t.dataset.arg;
      this.handle(act, arg, t);
    };
    for (const r of [this.menuEl, this.panelEl, this.pauseEl, this.endEl, this.hud.el]) {
      r.addEventListener('click', onClick);
      r.addEventListener('mouseover', (e) => {
        const t = e.target.closest('.btn, .nav button, .diff, .item, .strip-card, .tab');
        if (t && t !== this._lastHover) {
          this._lastHover = t;
          this.sound('uiHover');
        }
      });
      r.addEventListener('input', (e) => {
        const t = e.target;
        if (t.dataset.set) this._setSetting(t.dataset.set, t.type === 'range' ? Number(t.value) : t.value);
        if (t.dataset.num !== undefined) {
          const n = Math.max(0, Math.min(99, parseInt(t.value || '0', 10) || 0));
          this.profile.data.look.number = n;
          this.profile.save();
          this.app.applyLook();
        }
      });
    }
  }

  // --------------------------------------------------------------------------------- navigation
  _show(elm) {
    for (const s of [this.menuEl, this.panelEl, this.hud.el]) s.classList.toggle('show', s === elm);
  }

  showMenu() {
    this.fade(false);
    this.stack = [];
    this.page = null;
    this.endEl.classList.remove('show');
    this.pauseEl.classList.remove('show');
    this.renderMenu();
    this._show(this.menuEl);
  }

  showHUD(mode) {
    this.fade(false);
    this.stack = [];
    this.endEl.classList.remove('show');
    this.pauseEl.classList.remove('show');
    this.hud.setMode(mode);
    this._show(this.hud.el);
    if (!this.profile.data.tutorialSeen) this.showQuickStart();
  }

  showQuickStart() {
    const app = this.app;
    app.paused = true;
    app.game.paused = true;
    const k = (x) => `<span class="kbd">${x}</span>`;
    this.pauseEl.innerHTML = `<div class="pause-box" style="width:min(560px,92vw)">
      <div class="eyebrow">Quick start</div>
      <h2 style="font-size:46px;margin-bottom:6px">How to hoop</h2>
      <div class="card" style="padding:16px 18px;line-height:1.9;font-size:15px;color:#c8d0da">
        <div>${k('W')}${k('A')}${k('S')}${k('D')} move · ${k('Shift')} sprint</div>
        <div>Hold ${k('Space')} to shoot — <b style="color:var(--green)">release at the top of your jump</b>, when the meter hits the green zone.</div>
        <div>Tap ${k('Space')} to pump fake · drive + ${k('Space')} for a layup · sprint + ${k('Space')} on an open lane to dunk.</div>
        <div>${k('J')}${k('K')}${k('L')}${k('U')}${k('I')}${k('O')}${k('H')}${k('N')} dribble moves — chain them to break your defender.</div>
        <div>Defense: ${k('J')} steal · ${k('Space')} contest, block, rebound.</div>
        <div style="color:var(--muted);font-size:13.5px">Inside the arc = 1 point, beyond = 2. Clear the ball after a rebound or steal. ${k('Esc')} shows all controls.</div>
      </div>
      <button class="btn primary" data-act="qs-done" style="margin-top:6px">Let's go</button>
    </div>`;
    this.pauseEl.classList.add('show');
  }

  open(page) {
    this.sound('uiClick');
    if (this.page) this.stack.push(this.page);
    this.page = page;
    this.panelEl.classList.toggle('side', page === 'locker' || page === 'shop');
    this.panelEl.id = page === 'locker' || page === 'shop' ? page : 'panel';
    if (page === 'locker' || page === 'shop') this.app.openLocker();
    this.renderPanel();
    this._show(this.panelEl);
  }

  back() {
    if (this.endEl.classList.contains('show')) return;
    if (!this.page) return;
    this.sound('uiBack');
    const wasSide = this.page === 'locker' || this.page === 'shop';
    const prev = this.stack.pop() || null;
    this.page = prev;
    if (wasSide && !(prev === 'locker' || prev === 'shop')) this.app.closeLocker();
    if (prev) {
      this.panelEl.id = prev === 'locker' || prev === 'shop' ? prev : 'panel';
      if (prev === 'locker' || prev === 'shop') this.app.openLocker();
      this.renderPanel();
    } else {
      this.renderMenu();
      this._show(this.menuEl);
    }
  }

  isOverlayOpen() {
    return this.hud.controlsOpen;
  }
  closeOverlay() {
    this.hud.toggleControls(false);
  }

  toast(text, kind = '') {
    const t = el(`<div class="toast ${kind}">${esc(text)}</div>`);
    this.toasts.appendChild(t);
    setTimeout(() => t.remove(), 2700);
  }

  fade(on) {
    this.fadeEl.classList.toggle('on', on);
  }

  update(dt) {
    if (this.hud.el.classList.contains('show')) this.hud.update(dt);
  }

  // --------------------------------------------------------------------------------- actions
  handle(act, arg, t) {
    const app = this.app;
    const P = this.profile;
    switch (act) {
      case 'open':
        this.open(arg);
        break;
      case 'back':
        this.back();
        break;
      case 'quick-play':
        this.sound('uiClick');
        app.startMatch();
        break;
      case 'start-match': {
        this.sound('purchase');
        const g = P.settings.gameplay;
        app.startMatch({ difficulty: g.difficulty, target: g.target, shotClock: g.shotClock, winBy2: g.winBy2, timeLimit: g.timeLimit, makeItTakeIt: g.makeItTakeIt });
        break;
      }
      case 'start-practice':
        this.sound('purchase');
        app.startPractice();
        break;
      case 'diff':
        P.settings.gameplay.difficulty = arg;
        P.save();
        this.sound('uiClick');
        this.renderPanel();
        break;
      case 'seg': {
        const [path, val] = arg.split('=');
        this._setSetting(path, isNaN(Number(val)) ? val : Number(val));
        this.sound('uiClick');
        this.renderPanel();
        break;
      }
      case 'toggle': {
        const cur = this._getSetting(arg);
        this._setSetting(arg, !cur);
        this.sound('uiClick');
        this.renderPanel();
        break;
      }
      case 'tab':
        this.tab[this.page] = arg;
        this.sound('uiClick');
        this.renderPanel();
        break;
      case 'item':
        this._selectItem(arg);
        break;
      case 'equip':
        if (P.equip(arg)) {
          this.sound('uiClick');
          app.applyLook();
          this._afterEquip(arg);
        }
        this.renderPanel();
        break;
      case 'unequip':
        P.unequip(arg);
        app.applyLook();
        this.renderPanel();
        break;
      case 'buy': {
        const r = P.buy(arg);
        if (r.ok) {
          this.sound('purchase');
          this.toast(`Unlocked · ${ITEM[arg].name}`, 'gold');
          P.equip(arg);
          app.applyLook();
          this._afterEquip(arg);
        } else {
          this.sound('error');
          this.toast(r.reason === 'coins' ? 'Not enough coins' : r.reason === 'level' ? `Reach level ${ITEM[arg].level}` : 'Unavailable');
        }
        this.renderPanel();
        break;
      }
      case 'look': {
        const [k, v] = arg.split('=');
        P.data.look[k] = v;
        P.save();
        this.sound('uiClick');
        app.applyLook();
        this.renderPanel();
        break;
      }
      case 'claim-quest': {
        const r = P.claimQuest(Number(arg));
        if (r) {
          this.sound('purchase');
          this.toast(`+${r.coins} coins · +${r.xp} XP`, 'gold');
          for (const u of r.levelUps) this._levelUpToast(u);
        }
        this.renderPanel();
        break;
      }
      case 'claim-ms': {
        const r = P.claimMilestone(arg);
        if (r) {
          this.sound('purchase');
          this.toast(`+${r.coins} coins`, 'gold');
        }
        this.renderPanel();
        break;
      }
      case 'reset-progress':
        if (t.dataset.confirm === '1') {
          P.reset();
          app.applyLook();
          app.applySettings();
          this.toast('Progress reset', 'cyan');
          this.renderPanel();
        } else {
          t.dataset.confirm = '1';
          t.textContent = 'Tap again to confirm';
        }
        break;
      case 'reset-settings':
        P.data.settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
        P.save();
        app.applySettings();
        this.renderPanel();
        break;
      // pause / hud / end
      case 'pause':
        app.pause();
        break;
      case 'resume':
        this.sound('uiClick');
        app.resume();
        break;
      case 'qs-done':
        this.sound('uiClick');
        this.profile.data.tutorialSeen = true;
        this.profile.save();
        app.resume();
        break;
      case 'restart':
        this.sound('uiClick');
        this.pauseEl.classList.remove('show');
        app.restart();
        break;
      case 'quit':
        this.sound('uiBack');
        this.pauseEl.classList.remove('show');
        app.quitToMenu();
        break;
      case 'pause-settings':
        this.pauseEl.classList.remove('show');
        this.page = null;
        this.stack = [];
        this.page = 'settings';
        this.panelEl.id = 'panel';
        this.renderPanel();
        this._show(this.panelEl);
        this._returnToPause = true;
        break;
      case 'controls':
        this.hud.toggleControls(true);
        break;
      case 'close-controls':
        this.hud.toggleControls(false);
        break;
      case 'camera':
        app.cycleCamera();
        break;
      case 'mute':
        app.toggleMute();
        break;
      case 'rematch':
        this.sound('purchase');
        this.endEl.classList.remove('show');
        app.startMatch(app.matchOpts);
        break;
      case 'menu':
        this.sound('uiBack');
        this.endEl.classList.remove('show');
        app.toMenu();
        break;
    }
  }

  _afterEquip(id) {
    const it = ITEM[id];
    if (!it) return;
    if (it.cat === 'emote') {
      const u = this.app.user;
      u.setAction(new EmoteAction(u, it.data.emote));
    }
  }

  _levelUpToast(u) {
    this.app.audio.play('levelup', { bus: 'ui', vol: 0.7 });
    this.toast(`Level ${u.level} reached · +${u.reward.coins} coins`, 'cyan');
  }

  _getSetting(path) {
    const [a, b] = path.split('.');
    return this.profile.settings[a][b];
  }

  _setSetting(path, val) {
    const [a, b] = path.split('.');
    this.profile.settings[a][b] = val;
    this.profile.save();
    this.app.applySettings();
  }

  // --------------------------------------------------------------------------------- main menu
  renderMenu() {
    const P = this.profile.data;
    const need = xpForLevel(P.level);
    const st = P.stats;
    const last = P.history[0];
    const quests = P.quests.list
      .map((q) => {
        const done = q.progress >= q.target;
        return `<div class="mini-quest ${done ? 'done' : ''}"><span>${esc(q.text)}</span><span class="num">${q.progress}/${q.target}</span><div class="bar"><i style="width:${(100 * q.progress) / q.target}%"></i></div></div>`;
      })
      .join('');
    const claimable = P.quests.list.filter((q) => q.progress >= q.target && !q.claimed).length;
    this.menuEl.innerHTML = `
      <div class="topbar">
        <div class="brand">${LOGO_MARK}<span>GREEN<b>FN</b></span></div>
        <div class="spacer"></div>
        <div class="lvl">
          <div class="badge">${P.level}</div>
          <div class="meta"><div class="row"><span>Level ${P.level}</span><span class="num">${fmt.int(P.xp)} / ${fmt.int(need)} XP</span></div><div class="bar"><i style="width:${(100 * P.xp) / need}%"></i></div></div>
        </div>
        <div class="coin num">${fmt.int(P.coins)}</div>
      </div>
      <div class="menu-main">
        <div class="menu-hero">
          <div class="tag">1v1 · Under the lights</div>
          <h1>Green<em>FN</em></h1>
          <p>First to 11. Ones and twos. Make it, take it. Break ankles, time your release, and own the court.</p>
        </div>
        <div class="menu-play">
          <button class="btn primary" data-act="open" data-arg="play">Play 1v1</button>
          <button class="btn ghost" data-act="open" data-arg="practice">Practice</button>
        </div>
        <nav class="nav">
          <button data-act="open" data-arg="locker">Locker <span class="sub">Customize your player</span></button>
          <button data-act="open" data-arg="shop">Shop <span class="sub">Spend coins on cosmetics</span></button>
          <button data-act="open" data-arg="quests">Quests ${claimable ? '<span class="dot"></span>' : ''}<span class="sub">Daily quests, milestones, achievements</span></button>
          <button data-act="open" data-arg="progress">Progression <span class="sub">Levels and rewards</span></button>
          <button data-act="open" data-arg="stats">Statistics <span class="sub">Your career numbers</span></button>
          <button data-act="open" data-arg="settings">Settings <span class="sub">Audio, camera, gameplay, graphics</span></button>
        </nav>
      </div>
      <div class="menu-strip">
        <div class="card strip-card" data-act="open" data-arg="quests"><div class="eyebrow">Daily quests ${claimable ? '· <span class="accent">' + claimable + ' to claim</span>' : ''}</div>${quests}</div>
        <div class="card strip-card" data-act="open" data-arg="stats"><div class="eyebrow">Record</div><div class="big-stat num">${st.wins}<small>W</small> ${st.losses}<small>L</small></div><div class="strip-sub">${st.gamesPlayed ? fmt.pct(st.wins, st.gamesPlayed) + ' win rate' : 'Play your first game'}</div></div>
        <div class="card strip-card" data-act="open" data-arg="stats"><div class="eyebrow">Streak</div><div class="big-stat num">${st.currentStreak}<small>W</small></div><div class="strip-sub">Best ${st.bestStreak}</div></div>
        <div class="card strip-card" data-act="open" data-arg="stats"><div class="eyebrow">Last game</div>${
          last
            ? `<div class="big-stat num"><span class="${last.won ? 'w' : 'l'}">${last.won ? 'W' : 'L'}</span> ${last.us}-${last.them}</div><div class="strip-sub">vs ${esc(last.opp || 'CPU')} · ${esc(AI_LEVELS[last.diff]?.name || '')}</div>`
            : '<div class="big-stat">—</div><div class="strip-sub">No games yet</div>'
        }</div>
      </div>`;
  }

  // --------------------------------------------------------------------------------- panels
  _head(title, extra = '') {
    return `<div class="panel-head"><button class="icon-btn" data-act="back" title="Back (Esc)">${ICON.back}</button><h2>${title}</h2><div class="spacer"></div>${extra}<div class="coin num">${fmt.int(this.profile.data.coins)}</div></div>`;
  }

  renderPanel() {
    const p = this.page;
    const fn = {
      play: () => this._play(),
      practice: () => this._practice(),
      settings: () => this._settings(),
      quests: () => this._quests(),
      progress: () => this._progress(),
      stats: () => this._stats(),
      locker: () => this._locker(),
      shop: () => this._shop(),
    }[p];
    if (!fn) return;
    const scroll = this.panelEl.querySelector('.panel-body')?.scrollTop || 0;
    this.panelEl.innerHTML = fn();
    const body = this.panelEl.querySelector('.panel-body');
    if (body && this._lastPage === p) body.scrollTop = scroll;
    this._lastPage = p;
    if (p === 'settings' && this._returnToPause) {
      this.panelEl.querySelector('[data-act="back"]').dataset.act = 'settings-done';
      this.panelEl.querySelector('[data-act="settings-done"]').addEventListener('click', () => {
        this._returnToPause = false;
        this.page = null;
        this._show(this.hud.el);
        this.showPause();
      });
    }
  }

  _seg(path, options, cur) {
    return `<div class="seg">${options.map(([v, l]) => `<button class="${String(cur) === String(v) ? 'on' : ''}" data-act="seg" data-arg="${path}=${v}">${l}</button>`).join('')}</div>`;
  }
  _toggle(path, on) {
    return `<button class="toggle ${on ? 'on' : ''}" data-act="toggle" data-arg="${path}" aria-pressed="${on}"></button>`;
  }
  _opt(label, desc, control) {
    return `<div class="card opt"><div><div class="label">${label}</div>${desc ? `<div class="desc">${desc}</div>` : ''}</div>${control}</div>`;
  }

  _play() {
    const g = this.profile.settings.gameplay;
    const diffs = Object.keys(AI_LEVELS)
      .map((id) => {
        const L = AI_LEVELS[id];
        const D = DIFF_INFO[id];
        return `<button class="diff ${g.difficulty === id ? 'on' : ''}" data-act="diff" data-arg="${id}">
          <div class="pips">${[1, 2, 3, 4].map((i) => `<i class="${i <= D.pips ? 'f' : ''}"></i>`).join('')}</div>
          <h3>${L.name}</h3><p>${D.desc}</p><div class="mult">${DIFF_MULT[id]}× rewards</div></button>`;
      })
      .join('');
    const P = this.profile.data;
    return `${this._head('Play 1v1')}
      <div class="panel-body">
        <div class="card matchup">
          <div class="side"><div class="eyebrow">You</div><div class="n">${esc(P.name)}</div><div class="s">Level ${P.level} · #${P.look.number}</div></div>
          <div class="vs">VS</div>
          <div class="side"><div class="eyebrow">Opponent</div><div class="n">${AI_LEVELS[g.difficulty].name} CPU</div><div class="s">First to ${g.target}${g.winBy2 ? ', win by 2' : ''} · ${g.shotClock ? '24s shot clock' : 'no shot clock'}</div></div>
        </div>
        <div class="section-title"><span class="eyebrow">Difficulty</span></div>
        <div class="diff-grid">${diffs}</div>
        <div class="section-title"><span class="eyebrow">Rules</span></div>
        <div class="opt-grid">
          ${this._opt('Game to', 'Ones inside the arc, twos outside', this._seg('gameplay.target', [[7, '7'], [11, '11'], [15, '15'], [21, '21']], g.target))}
          ${this._opt('Shot clock', '24 seconds per possession', this._toggle('gameplay.shotClock', g.shotClock))}
          ${this._opt('Make it, take it', 'Scorer keeps the ball', this._toggle('gameplay.makeItTakeIt', g.makeItTakeIt))}
          ${this._opt('Win by 2', 'Must lead by two to win', this._toggle('gameplay.winBy2', g.winBy2))}
          ${this._opt('Time limit', 'Leader wins when time expires', this._seg('gameplay.timeLimit', [[0, 'Off'], [5, '5m'], [10, '10m']], g.timeLimit))}
          ${this._opt('Shot timing', 'Perfect-release window size', this._seg('gameplay.timing', [['relaxed', 'Relaxed'], ['normal', 'Std'], ['pro', 'Pro']], g.timing))}
        </div>
        <div class="setup-foot"><button class="btn primary" data-act="start-match">Start game</button><button class="btn" data-act="back">Back</button></div>
      </div>`;
  }

  _practice() {
    const s = this.profile.settings.practice;
    return `${this._head('Practice')}
      <div class="panel-body">
        <p style="color:var(--muted);max-width:620px;margin:0 0 22px;line-height:1.55">Free gym time. Work on your handle, chain combos, find your release and test every spot on the floor. A rebounder feeds you the ball after every shot. Press <span class="kbd">R</span> to reset with the ball where you stand.</p>
        <div class="section-title"><span class="eyebrow">Defender</span></div>
        <div class="opt-grid">
          ${this._opt('Defender', 'Practice against a body', this._seg('practice.defender', [['off', 'Off'], ['stationary', 'Stand'], ['ai', 'Live']], s.defender))}
          ${this._opt('Live defender level', 'Only for a live defender', this._seg('practice.aiLevel', Object.keys(AI_LEVELS).map((k) => [k, AI_LEVELS[k].name.replace('All-Star', 'All-Star')]), s.aiLevel))}
          ${this._opt('Rebounder', 'Passes the ball back after shots', this._toggle('practice.rebounder', s.rebounder))}
          ${this._opt('Shot clock', 'Practice beating the clock', this._toggle('practice.shotClock', s.shotClock))}
        </div>
        <div class="setup-foot"><button class="btn primary" data-act="start-practice">Enter the gym</button><button class="btn" data-act="back">Back</button></div>
      </div>`;
  }

  _settings() {
    const S = this.profile.settings;
    const tab = this.tab.settings || 'audio';
    const tabs = ['audio', 'camera', 'gameplay', 'graphics', 'controls', 'data']
      .map((t) => `<button class="tab ${tab === t ? 'on' : ''}" data-act="tab" data-arg="${t}">${t}</button>`)
      .join('');
    const slider = (path, min, max, step, v) => `<input type="range" min="${min}" max="${max}" step="${step}" value="${v}" data-set="${path}">`;
    let body = '';
    if (tab === 'audio') {
      body = `<div class="opt-grid">
        ${this._opt('Mute all', 'Shortcut: M', this._toggle('audio.muted', S.audio.muted))}
        ${this._opt('Master', '', slider('audio.master', 0, 1, 0.01, S.audio.master))}
        ${this._opt('Effects', 'Ball, rim, sneakers', slider('audio.sfx', 0, 1, 0.01, S.audio.sfx))}
        ${this._opt('Crowd', 'Arena ambience', slider('audio.ambience', 0, 1, 0.01, S.audio.ambience))}
        ${this._opt('Interface', 'Menus and meter', slider('audio.ui', 0, 1, 0.01, S.audio.ui))}
      </div>`;
    } else if (tab === 'camera') {
      body = `<div class="opt-grid">
        ${this._opt('Perspective', 'Shortcut in game: C', this._seg('camera.preset', [['iso', 'Iso'], ['high', 'High'], ['close', 'Close'], ['broadcast', 'Side']], S.camera.preset))}
        ${this._opt('Distance', '', slider('camera.distance', 0.75, 1.4, 0.01, S.camera.distance))}
        ${this._opt('Height', '', slider('camera.height', 0.7, 1.4, 0.01, S.camera.height))}
        ${this._opt('Field of view', '', slider('camera.fov', -10, 12, 1, S.camera.fov))}
        ${this._opt('Follow sensitivity', 'Camera responsiveness + drag orbit speed', slider('camera.smoothing', 0.5, 2, 0.01, S.camera.smoothing))}
        ${this._opt('Impact shake', 'Subtle shake on dunks and rim hits', this._toggle('camera.shake', S.camera.shake))}
      </div><p style="color:var(--dim);font-size:13px">Drag on the court with the mouse to orbit; the camera eases back automatically.</p>`;
    } else if (tab === 'gameplay') {
      body = `<div class="opt-grid">
        ${this._opt('Default difficulty', '', this._seg('gameplay.difficulty', Object.keys(AI_LEVELS).map((k) => [k, AI_LEVELS[k].name]), S.gameplay.difficulty))}
        ${this._opt('Shot meter', 'Show the release meter', this._toggle('gameplay.meter', S.gameplay.meter))}
        ${this._opt('Control hints', 'Contextual key hints', this._toggle('gameplay.hints', S.gameplay.hints))}
        ${this._opt('Shot timing', 'Perfect-release window size', this._seg('gameplay.timing', [['relaxed', 'Relaxed'], ['normal', 'Standard'], ['pro', 'Pro']], S.gameplay.timing))}
      </div>`;
    } else if (tab === 'graphics') {
      body = `<div class="opt-grid">
        ${this._opt('Quality', 'Auto lowers quality if the frame rate drops', this._seg('graphics.quality', [['auto', 'Auto'], ['low', 'Low'], ['medium', 'Med'], ['high', 'High']], S.graphics.quality))}
        ${this._opt('Show FPS', 'Shortcut: F3', this._toggle('graphics.showFps', S.graphics.showFps))}
      </div>`;
    } else if (tab === 'controls') {
      body = controlsTable();
    } else if (tab === 'data') {
      body = `<p style="color:var(--muted);max-width:560px;line-height:1.55">Progress, purchases and settings are saved in this browser (local storage). ${this.profile.storageOk ? '' : '<b class="l">Storage is unavailable in this browser session — progress will not persist.</b>'}</p>
        <div class="setup-foot"><button class="btn" data-act="reset-settings">Reset settings</button><button class="btn" data-act="reset-progress" style="border-color:rgba(255,77,94,.5);color:#ff7a86">Reset all progress</button></div>`;
    }
    return `${this._head('Settings')}<div class="panel-body"><div class="tabs">${tabs}</div>${body}</div>`;
  }

  _quests() {
    const P = this.profile;
    P.refreshQuests();
    const D = P.data;
    const ms = P.msUntilNewQuests();
    const quests = D.quests.list
      .map((q, i) => {
        const done = q.progress >= q.target;
        const btn = q.claimed ? `<span class="chip on">${ICON.check.replace('<svg', '<svg width="14" height="14"')} Claimed</span>` : done ? `<button class="btn primary small" data-act="claim-quest" data-arg="${i}">${ICON.gift.replace('<svg', '<svg width="16" height="16"')} Claim</button>` : `<span class="chip">${q.progress}/${q.target}</span>`;
        return `<div class="card quest ${done ? 'done' : ''}"><div class="qi">${done ? '✓' : i + 1}</div><div><h4>${esc(q.text)}</h4><div class="rw"><span class="coin" style="font-size:14px">${q.coins}</span> · ${q.xp} XP</div><div class="bar"><i style="width:${(100 * q.progress) / q.target}%"></i></div></div>${btn}</div>`;
      })
      .join('');
    const milestones = MILESTONES.map((m) => {
      const st = P.milestoneState(m);
      const next = st.done ? m.tiers[m.tiers.length - 1] : st.nextTier;
      const pct = Math.min(100, (100 * st.value) / next);
      const btn = st.done ? '<span class="chip on">Complete</span>' : st.claimable ? `<button class="btn primary small" data-act="claim-ms" data-arg="${m.id}">Claim ${m.coins[st.claimed]}</button>` : `<span class="chip">Tier ${st.claimed + 1}/${m.tiers.length}</span>`;
      return `<div class="card quest"><div class="qi">${ICON.medal.replace('<svg', '<svg width="24" height="24"')}</div><div><h4>${m.name} · ${fmt.int(st.value)} / ${fmt.int(next)}</h4><div class="rw">Next reward: <span class="coin" style="font-size:14px">${st.done ? '—' : m.coins[st.claimed]}</span></div><div class="bar"><i style="width:${pct}%"></i></div></div>${btn}</div>`;
    }).join('');
    const ach = ACHIEVEMENTS.map((a) => {
      const on = !!D.achievements[a.id];
      const reward = a.unlock ? ` · unlocks ${esc(ITEM[a.unlock].name)}` : '';
      return `<div class="card ach ${on ? 'on' : ''}"><div class="medal">${on ? ICON.trophy.replace('<svg', '<svg width="20" height="20"') : ICON.lock.replace('<svg', '<svg width="18" height="18"')}</div><div><h5>${esc(a.name)}</h5><p>${esc(a.desc)} <span style="color:var(--gold)">+${a.coins}</span>${reward}</p></div></div>`;
    }).join('');
    const got = Object.keys(D.achievements).length;
    return `${this._head('Quests')}<div class="panel-body">
      <div class="section-title"><span class="eyebrow">Daily quests · new in ${fmt.dur(ms)}</span></div>${quests}
      <div class="section-title" style="margin-top:28px"><span class="eyebrow">Milestones</span></div>${milestones}
      <div class="section-title" style="margin-top:28px"><span class="eyebrow">Achievements · ${got}/${ACHIEVEMENTS.length}</span></div><div class="ach-grid">${ach}</div>
    </div>`;
  }

  _progress() {
    const D = this.profile.data;
    const need = xpForLevel(D.level);
    let track = '';
    for (let lv = 2; lv <= 20; lv++) {
      const r = levelReward(lv);
      const items = ITEMS.filter((i) => i.unlock === 'shop' && i.level === lv).length;
      const reward = `<span class="coin" style="font-size:14px">${r.coins}</span>${r.item ? `<br>${esc(ITEM[r.item].name)}` : items ? `<br>${items} shop unlock${items > 1 ? 's' : ''}` : ''}`;
      track += `<div class="card lv ${lv <= D.level ? 'got' : ''} ${lv === D.level + 1 ? 'cur' : ''}"><div class="eyebrow">Level</div><div class="n">${lv}</div><div class="r">${reward}</div></div>`;
    }
    const nextItems = ITEMS.filter((i) => i.unlock === 'shop' && i.level === D.level + 1);
    return `${this._head('Progression')}<div class="panel-body">
      <div class="card" style="padding:22px 24px;margin-bottom:22px;display:flex;gap:26px;align-items:center">
        <div class="lvl"><div class="badge" style="width:74px;height:74px;font-size:36px">${D.level}</div></div>
        <div style="flex:1"><div class="eyebrow" style="margin-bottom:8px">Level ${D.level} → ${D.level + 1}</div><div class="bar" style="height:10px"><i style="width:${(100 * D.xp) / need}%"></i></div><div style="margin-top:8px;color:var(--muted);font-size:14px" class="num">${fmt.int(D.xp)} / ${fmt.int(need)} XP · earn XP by playing 1v1 games and completing quests</div></div>
      </div>
      <div class="section-title"><span class="eyebrow">Level rewards</span></div><div class="track">${track}</div>
      <div class="section-title" style="margin-top:24px"><span class="eyebrow">Unlocks at level ${D.level + 1}</span></div>
      <p style="color:var(--muted)">${nextItems.length ? nextItems.map((i) => `${esc(i.name)} <span style="color:var(--dim)">(${esc(CATEGORIES.find((c) => c.id === i.cat)?.name || i.cat)})</span>`).join(' · ') : 'Coins and bragging rights.'}</p>
      <div class="section-title" style="margin-top:24px"><span class="eyebrow">How rewards work</span></div>
      <p style="color:var(--muted);line-height:1.6;max-width:720px">Every game pays XP and coins: more for wins, points, perfect releases and defensive plays, multiplied by difficulty (Rookie 0.8× up to Legend 1.8×). Win streaks add bonus XP. Coins buy cosmetics in the Shop; nothing you buy changes your ratings.</p>
    </div>`;
  }

  _stats() {
    const D = this.profile.data;
    const s = D.stats;
    const fav = this.profile.favoriteMove();
    const tile = (label, v, sub = '') => `<div class="card stat-tile"><div class="eyebrow">${label}</div><div class="v num">${v}</div>${sub ? `<div class="s">${sub}</div>` : ''}</div>`;
    const avg = (a) => (s.gamesPlayed ? (a / s.gamesPlayed).toFixed(1) : '0');
    const rows = D.history
      .map(
        (h) =>
          `<tr><td>${new Date(h.t).toLocaleDateString()}</td><td class="${h.won ? 'w' : 'l'}">${h.won ? 'W' : 'L'}</td><td class="num">${h.us}-${h.them}</td><td>${esc(h.opp || 'CPU')}</td><td>${esc(AI_LEVELS[h.diff]?.name || '')}</td><td class="num">${h.fgm}/${h.fga}</td><td class="num">${h.perfect}</td></tr>`
      )
      .join('');
    return `${this._head('Statistics')}<div class="panel-body">
      <div class="stat-grid">
        ${tile('Record', `${s.wins}-${s.losses}`, `${fmt.pct(s.wins, s.gamesPlayed)} win rate`)}
        ${tile('Games played', s.gamesPlayed, `${fmt.clock(s.playTime)} on court`)}
        ${tile('Win streak', s.currentStreak, `Best ${s.bestStreak}`)}
        ${tile('Points', fmt.int(s.pointsFor), `${avg(s.pointsFor)} per game`)}
        ${tile('Shooting', fmt.pct(s.fgm, s.fga), `${s.fgm}/${s.fga} field goals`)}
        ${tile('Two-pointers', fmt.pct(s.twoM, s.twoA), `${s.twoM}/${s.twoA}`)}
        ${tile('Perfect releases', s.perfect, `${fmt.pct(s.perfect, s.releases)} of releases · ${s.perfectMade} made`)}
        ${tile('Favorite move', fav ? MOVE_LABELS[fav.id] : '—', fav ? `${fav.count} times` : 'Use your handle')}
        ${tile('Dribble moves', fmt.int(s.movesTotal), `${s.ankles} ankle breakers`)}
        ${tile('Rebounds', s.rebounds, `${avg(s.rebounds)} per game`)}
        ${tile('Steals', s.steals, `${s.blocks} blocks`)}
        ${tile('Finishes', s.layupsMade + s.dunks, `${s.dunks} dunks · ${s.swishes} swishes`)}
        ${tile('Biggest win', s.biggestWin ? '+' + s.biggestWin : '—', '')}
        ${tile('Practice', `${s.practiceMakes}/${s.practiceAttempts}`, fmt.pct(s.practiceMakes, s.practiceAttempts) + ' in the gym')}
      </div>
      <div class="section-title"><span class="eyebrow">Recent games</span></div>
      ${rows ? `<table class="hist"><tr><th>Date</th><th>Res</th><th>Score</th><th>Opponent</th><th>Level</th><th>FG</th><th>Greens</th></tr>${rows}</table>` : '<p style="color:var(--muted)">No games yet — your history shows up here.</p>'}
    </div>`;
  }

  // --------------------------------------------------------------------------------- locker / shop
  _itemCard(it, mode) {
    const P = this.profile;
    const owned = P.owns(it.id);
    const eq = P.data.equipped[slotOf(it)] === it.id;
    const sel = this.sel[this.page] === it.id;
    const r = RARITY[it.rarity];
    let swatch;
    if (it.swatch) swatch = `<div class="swatch">${it.swatch.map((c) => `<span style="background:${c}"></span>`).join('')}</div>`;
    else swatch = `<div class="swatch icon">${esc(it.cat === 'jumpshot' ? 'JS' : it.cat === 'emote' ? '☺' : '•')}</div>`;
    let price = '';
    if (mode === 'shop') {
      if (owned) price = `<span>${eq ? 'Equipped' : 'Owned'}</span>`;
      else if (it.unlock === 'achievement') price = `<span>Achievement</span>`;
      else if (it.unlock === 'level') price = `<span>Level ${it.level}</span>`;
      else price = `<span class="coin">${fmt.int(it.price)}</span>${P.data.level < it.level ? `<span>Lv ${it.level}</span>` : ''}`;
    } else price = owned ? `<span>${eq ? '' : 'Owned'}</span>` : `<span>${ICON.lock.replace('<svg', '<svg width="14" height="14"')}</span>`;
    return `<button class="item ${sel ? 'sel' : ''} ${eq ? 'equipped' : ''} ${!owned && mode === 'locker' ? 'locked' : ''}" data-act="item" data-arg="${it.id}">${swatch}<div class="nm">${esc(it.name)}</div><div class="rr" style="color:${r.color}">${r.name}</div><div class="pr">${price}</div></button>`;
  }

  _selectItem(id) {
    this.sel[this.page] = id;
    this.sound('uiClick');
    const it = ITEM[id];
    // live preview on the 3D player
    const P = this.profile.data;
    const eq = Object.assign({}, P.equipped, { [slotOf(it)]: id });
    const look = lookFromProfile({ equipped: eq, look: P.look });
    this.app.previewLook(look, {
      ball: it.cat === 'ball' ? it.data.skin : ITEM[P.equipped.ball]?.data.skin,
      court: it.cat === 'court' ? it.data.theme : ITEM[P.equipped.court]?.data.theme,
      trail: it.cat === 'trail' ? it.data.color : ITEM[P.equipped.trail]?.data.color || null,
    });
    if (it.cat === 'emote') {
      const u = this.app.user;
      u.setAction(new EmoteAction(u, it.data.emote));
    }
    this.renderPanel();
  }

  _detail(mode) {
    const id = this.sel[this.page];
    const it = ITEM[id];
    if (!it) return `<div class="card detail"><div class="info"><p>Select an item to preview it on your player.</p></div></div>`;
    const P = this.profile;
    const owned = P.owns(id);
    const slot = slotOf(it);
    const eq = P.data.equipped[slot] === id;
    let action = '';
    if (owned) action = eq ? (it.cat === 'accessory' ? `<button class="btn" data-act="unequip" data-arg="${slot}">Remove</button>` : `<span class="chip on">Equipped</span>`) : `<button class="btn primary" data-act="equip" data-arg="${id}">Equip</button>`;
    else if (it.unlock === 'achievement') {
      const a = ACHIEVEMENTS.find((x) => x.unlock === id);
      action = `<span class="chip">Earn: ${esc(a ? a.name : 'achievement')}</span>`;
    } else if (it.unlock === 'level') action = `<span class="chip">Free at level ${it.level}</span>`;
    else if (mode === 'locker') action = `<button class="btn ghost" data-act="open" data-arg="shop">Get in shop</button>`;
    else {
      const c = P.canBuy(id);
      action = `<button class="btn primary" data-act="buy" data-arg="${id}" ${c.ok ? '' : 'disabled'}>Buy · ${fmt.int(it.price)}</button>${!c.ok && c.reason === 'level' ? `<span class="chip">Level ${it.level}</span>` : ''}${!c.ok && c.reason === 'coins' ? `<span class="chip">Need ${fmt.int(it.price - P.data.coins)} more</span>` : ''}`;
    }
    const desc = it.desc || (it.cat === 'jumpshot' ? JUMPSHOTS[it.data.style]?.name : '') || `${RARITY[it.rarity].name} ${CATEGORIES.find((c) => c.id === it.cat)?.name.replace(/s$/, '') || ''}. Cosmetic only.`;
    return `<div class="card detail"><div class="info"><div class="eyebrow" style="color:${RARITY[it.rarity].color}">${RARITY[it.rarity].name}</div><h3>${esc(it.name)}</h3><p>${esc(desc)}</p></div>${action}</div>`;
  }

  _locker() {
    const tab = this.tab.locker || 'appearance';
    const tabs = [['appearance', 'Player'], ...CATEGORIES.map((c) => [c.id, c.name])]
      .map(([id, n]) => `<button class="tab ${tab === id ? 'on' : ''}" data-act="tab" data-arg="${id}">${n}</button>`)
      .join('');
    let body = '';
    if (tab === 'appearance') {
      const L = this.profile.data.look;
      body = `<div class="section-title"><span class="eyebrow">Skin tone</span></div><div class="swatches">${SKIN_TONES.map((c) => `<button class="sw ${L.skin === c ? 'on' : ''}" style="background:${c}" data-act="look" data-arg="skin=${c}"></button>`).join('')}</div>
        <div class="section-title" style="margin-top:20px"><span class="eyebrow">Hair</span></div><div class="seg">${HAIR_STYLES.map((h) => `<button class="${L.hair === h ? 'on' : ''}" data-act="look" data-arg="hair=${h}">${h}</button>`).join('')}</div>
        <div class="section-title" style="margin-top:20px"><span class="eyebrow">Hair color</span></div><div class="swatches">${HAIR_COLORS.map((c) => `<button class="sw ${L.hairColor === c ? 'on' : ''}" style="background:${c}" data-act="look" data-arg="hairColor=${c}"></button>`).join('')}</div>
        <div class="section-title" style="margin-top:20px"><span class="eyebrow">Jersey number</span></div><input class="num-input" type="number" min="0" max="99" value="${L.number}" data-num>`;
    } else {
      const items = ITEMS.filter((i) => i.cat === tab);
      body = `<div class="item-grid">${items.map((i) => this._itemCard(i, 'locker')).join('')}</div>${this._detail('locker')}`;
    }
    return `${this._head('Locker')}<div class="panel-body"><div class="tabs">${tabs}</div>${body}</div>`;
  }

  _shop() {
    const tab = this.tab.shop || 'featured';
    const tabs = [['featured', 'Featured'], ...CATEGORIES.map((c) => [c.id, c.name])]
      .map(([id, n]) => `<button class="tab ${tab === id ? 'on' : ''}" data-act="tab" data-arg="${id}">${n}</button>`)
      .join('');
    let items;
    if (tab === 'featured') {
      // rotate a daily featured set of purchasable items
      const pool = ITEMS.filter((i) => i.unlock === 'shop');
      const day = Math.floor(Date.now() / 86400000);
      items = [];
      for (let k = 0; k < 8; k++) items.push(pool[(day * 7 + k * 5) % pool.length]);
      items = [...new Set(items)];
    } else items = ITEMS.filter((i) => i.cat === tab);
    return `${this._head('Shop')}<div class="panel-body"><div class="tabs">${tabs}</div><div class="item-grid">${items.map((i) => this._itemCard(i, 'shop')).join('')}</div>${this._detail('shop')}</div>`;
  }

  // --------------------------------------------------------------------------------- pause / end
  showPause() {
    const app = this.app;
    const isPractice = app.mode === 'practice';
    this.pauseEl.innerHTML = `<div class="pause-box">
      <div class="eyebrow">${isPractice ? 'Practice' : '1v1 · ' + AI_LEVELS[app.matchOpts.difficulty].name}</div>
      <h2>Paused</h2>
      <button class="btn primary" data-act="resume">Resume</button>
      <button class="btn" data-act="restart">${isPractice ? 'Restart practice' : 'Restart game'}</button>
      <button class="btn" data-act="controls">Controls</button>
      <button class="btn" data-act="pause-settings">Settings</button>
      <button class="btn" data-act="quit">Quit to menu</button>
    </div>`;
    this.pauseEl.classList.add('show');
  }

  hidePause() {
    this.pauseEl.classList.remove('show');
    this.hud.toggleControls(false);
  }

  showEnd(d) {
    this.fade(false);
    const { info, us, them, summary } = d;
    const app = this.app;
    const won = info.won;
    const row = (label, a, b, fmtFn = (x) => x) => {
      const av = fmtFn(a);
      const bv = fmtFn(b);
      return `<tr><td>${label}</td><td class="${typeof a === 'number' && a > b ? 'best' : ''}">${av}</td><td class="${typeof b === 'number' && b > a ? 'best' : ''}">${bv}</td></tr>`;
    };
    const fg = (s) => `${s.fgm}/${s.fga}`;
    const xpRows = summary.xpParts.map(([k, v]) => `<div class="xp-row"><span>${k}</span><b>+${Math.round(v * (DIFF_MULT[info.difficulty] || 1))}</b></div>`).join('');
    const unlocks = [
      ...summary.levelUps.map((u) => `<span class="chip on">Level ${u.level}${u.reward.item ? ' · ' + esc(ITEM[u.reward.item].name) : ''}</span>`),
      ...summary.achievements.map((a) => `<span class="chip" style="color:var(--gold);border-color:rgba(255,201,74,.5)">${esc(a.name)} +${a.coins}</span>`),
      ...summary.questsDone.map((q) => `<span class="chip" style="color:var(--green);border-color:rgba(61,255,138,.45)">Quest: ${esc(q.text)}</span>`),
    ].join('');
    const P = this.profile.data;
    const need = xpForLevel(P.level);
    this.endEl.innerHTML = `<div class="end">
      <div class="end-hero">
        <div><div class="eyebrow">${AI_LEVELS[info.difficulty].name} · first to ${app.matchOpts.target} · ${fmt.clock(d.gameTime)}</div><div class="res ${won ? 'win' : ''}">${won ? 'Victory' : 'Defeat'}</div></div>
        <div class="final num">${info.userScore}<span>–</span>${info.oppScore}</div>
      </div>
      <div class="card" style="padding:14px 18px">
        <table class="box-table">
          <tr><th></th><th>You</th><th>${esc(info.oppName)}</th></tr>
          ${row('Points', us.pts, them.pts)}
          ${row('Field goals', us.fgm, them.fgm, (x) => x)}
          ${`<tr><td>FG%</td><td>${fmt.pct(us.fgm, us.fga)} <span style="color:var(--dim)">(${fg(us)})</span></td><td>${fmt.pct(them.fgm, them.fga)} <span style="color:var(--dim)">(${fg(them)})</span></td></tr>`}
          ${`<tr><td>Two-pointers</td><td>${us.twoM}/${us.twoA}</td><td>${them.twoM}/${them.twoA}</td></tr>`}
          ${row('Perfect releases', us.perfect, them.perfect)}
          ${row('Rebounds', us.rebounds, them.rebounds)}
          ${row('Steals', us.steals, them.steals)}
          ${row('Blocks', us.blocks, them.blocks)}
          ${row('Turnovers', us.turnovers, them.turnovers)}
          ${row('Dribble moves', us.movesTotal, them.movesTotal)}
          ${row('Dunks', us.dunks, them.dunks)}
        </table>
      </div>
      <div class="card reward">
        <div class="eyebrow">Rewards</div>
        <div class="tot"><span class="big num" id="xpCount">+0 XP</span><span class="coin num" id="coinCount">+0</span></div>
        ${xpRows}
        <div style="margin-top:14px" class="eyebrow">Level ${P.level}</div>
        <div class="bar" style="height:8px;margin-top:8px"><i id="xpBar" style="width:${summary.levelUps.length ? 0 : (100 * summary.before.xp) / xpForLevel(summary.before.level)}%"></i></div>
        <div class="unlocks">${unlocks || '<span style="color:var(--dim);font-size:13px">Keep grinding — quests and level rewards unlock cosmetics.</span>'}</div>
      </div>
      <div class="end-foot"><button class="btn" data-act="menu">Main menu</button><button class="btn primary" data-act="rematch">Rematch</button></div>
    </div>`;
    this._show(null);
    this.endEl.classList.add('show');
    // animate counters
    const xpEl = this.endEl.querySelector('#xpCount');
    const coinEl = this.endEl.querySelector('#coinCount');
    const bar = this.endEl.querySelector('#xpBar');
    const t0 = performance.now();
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / 1200);
      const e = 1 - Math.pow(1 - k, 3);
      xpEl.textContent = `+${Math.round(summary.xp * e)} XP`;
      coinEl.textContent = `+${Math.round(summary.coins * e)}`;
      if (k < 1) requestAnimationFrame(tick);
      else bar.style.width = `${(100 * P.xp) / need}%`;
    };
    requestAnimationFrame(tick);
    for (const u of summary.levelUps) setTimeout(() => this._levelUpToast(u), 1300);
    this.sound(won ? 'levelup' : 'uiBack');
  }
}

export function controlsTable() {
  const moves = Object.keys(MOVE_LABELS)
    .map((id) => `<div class="card opt"><div class="label">${MOVE_LABELS[id]}</div><span class="kbd">${MOVE_KEY_LABEL[id]}</span></div>`)
    .join('');
  const k = (label, keys) => `<div class="card opt"><div class="label">${label}</div><div style="display:flex;gap:6px">${keys.map((x) => `<span class="kbd">${x}</span>`).join('')}</div></div>`;
  return `<div class="section-title"><span class="eyebrow">Offense</span></div><div class="opt-grid">
      ${k('Move', ['W', 'A', 'S', 'D'])}${k('Sprint', ['Shift'])}${k('Shoot (hold, release at the top)', ['Space'])}${k('Pump fake (tap)', ['Space'])}${k('Layup / dunk (drive + shoot, sprint to dunk)', ['Shift', 'Space'])}${k('Celebrate after a bucket', ['T'])}
    </div>
    <div class="section-title"><span class="eyebrow">Dribble moves (chain them!)</span></div><div class="opt-grid">${moves}</div>
    <div class="section-title"><span class="eyebrow">Defense</span></div><div class="opt-grid">
      ${k('Slide / move', ['W', 'A', 'S', 'D'])}${k('Sprint (turn and run)', ['Shift'])}${k('Steal', ['J'])}${k('Jump · contest · rebound', ['Space'])}
    </div>
    <div class="section-title"><span class="eyebrow">General</span></div><div class="opt-grid">
      ${k('Pause', ['Esc'])}${k('Camera view', ['C'])}${k('Mute', ['M'])}${k('Practice reset', ['R'])}${k('FPS counter', ['F3'])}
    </div>
    <div class="section-title"><span class="eyebrow">Gamepad</span></div><div class="opt-grid">
      ${k('Move · sprint', ['L-Stick', 'RT'])}${k('Shoot / jump', ['A'])}${k('Hesi · spin · stepback', ['X', 'B', 'Y'])}${k('Right-stick flicks', ['Cross', 'Btl', 'Burst'])}${k('Behind back · pace', ['LB', 'LT'])}${k('Steal (defense)', ['X'])}
    </div>`;
}
