// Player profile: currency, inventory, equipment, XP/levels, lifetime stats, daily quests,
// milestones and achievements. Persisted to localStorage (versioned, with a backup copy).
import { ITEMS, ITEM, DEFAULT_EQUIPPED, slotOf } from './catalog.js';
import { mulberry32, hashString } from '../core/math.js';

const KEY = 'greenfn.profile.v1';
const BACKUP = 'greenfn.profile.v1.bak';
export const SAVE_VERSION = 1;

export const DEFAULT_SETTINGS = {
  audio: { master: 0.8, sfx: 0.9, ambience: 0.55, ui: 0.7, muted: false },
  camera: { preset: 'iso', distance: 1, height: 1, fov: 0, smoothing: 1, shake: true },
  gameplay: { difficulty: 'pro', target: 11, winBy2: false, shotClock: true, timeLimit: 0, makeItTakeIt: true, meter: true, hints: true, timing: 'normal' },
  graphics: { quality: 'auto', showFps: false },
  practice: { defender: 'off', aiLevel: 'pro', shotClock: false, rebounder: true },
};

export function lifetimeStats() {
  return {
    gamesPlayed: 0,
    wins: 0,
    losses: 0,
    pointsFor: 0,
    pointsAgainst: 0,
    fgm: 0,
    fga: 0,
    twoM: 0,
    twoA: 0,
    perfect: 0,
    perfectMade: 0,
    releases: 0,
    steals: 0,
    blocks: 0,
    rebounds: 0,
    turnovers: 0,
    dunks: 0,
    layupsMade: 0,
    swishes: 0,
    ankles: 0,
    moves: {},
    movesTotal: 0,
    currentStreak: 0,
    bestStreak: 0,
    biggestWin: 0,
    practiceMakes: 0,
    practiceAttempts: 0,
    winsByDiff: { rookie: 0, pro: 0, allstar: 0, legend: 0 },
    playTime: 0,
  };
}

// ------------------------------------------------------------------------------------ quests
export const QUEST_POOL = [
  { id: 'make', text: 'Make {n} shots in 1v1 games', metric: 'make', range: [8, 14], coins: 120, xp: 140 },
  { id: 'win', text: 'Win {n} games', metric: 'win', range: [1, 3], coins: 160, xp: 200 },
  { id: 'moves', text: 'Perform {n} dribble moves', metric: 'move', range: [15, 30], coins: 100, xp: 120 },
  { id: 'twos', text: 'Score {n} two-pointers', metric: 'make2', range: [3, 6], coins: 140, xp: 160 },
  { id: 'greens', text: 'Make {n} perfect-release shots', metric: 'green', range: [3, 6], coins: 150, xp: 170 },
  { id: 'steals', text: 'Get {n} steals', metric: 'steal', range: [2, 4], coins: 130, xp: 150 },
  { id: 'blocks', text: 'Block {n} shots', metric: 'block', range: [1, 3], coins: 130, xp: 150 },
  { id: 'rebounds', text: 'Grab {n} rebounds', metric: 'rebound', range: [5, 10], coins: 110, xp: 130 },
  { id: 'layups', text: 'Finish {n} layups or dunks', metric: 'rim', range: [4, 8], coins: 120, xp: 140 },
  { id: 'play', text: 'Play {n} games', metric: 'play', range: [2, 3], coins: 100, xp: 120 },
  { id: 'crosses', text: 'Hit {n} crossovers', metric: 'move_cross', range: [6, 12], coins: 90, xp: 110 },
  { id: 'practice', text: 'Make {n} shots in Practice', metric: 'practiceMake', range: [15, 25], coins: 80, xp: 100 },
];

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function generateQuests(day) {
  const rnd = mulberry32(hashString('greenfn-quests-' + day));
  const pool = QUEST_POOL.slice();
  const out = [];
  while (out.length < 3 && pool.length) {
    const i = Math.floor(rnd() * pool.length);
    const q = pool.splice(i, 1)[0];
    const n = q.range[0] + Math.floor(rnd() * (q.range[1] - q.range[0] + 1));
    out.push({ id: q.id, text: q.text.replace('{n}', n), metric: q.metric, target: n, progress: 0, coins: q.coins, xp: q.xp, claimed: false });
  }
  return out;
}

// ------------------------------------------------------------------------------------ milestones
export const MILESTONES = [
  { id: 'wins', name: 'Winner', stat: (s) => s.wins, tiers: [1, 5, 15, 40, 100], coins: [100, 200, 400, 800, 1500] },
  { id: 'makes', name: 'Bucket Getter', stat: (s) => s.fgm, tiers: [10, 50, 150, 400, 1000], coins: [80, 160, 320, 640, 1200] },
  { id: 'greens', name: 'Green Light', stat: (s) => s.perfectMade, tiers: [5, 25, 100, 250, 500], coins: [100, 220, 450, 900, 1600] },
  { id: 'moves', name: 'Handles', stat: (s) => s.movesTotal, tiers: [50, 250, 1000, 2500], coins: [80, 200, 450, 900] },
  { id: 'defense', name: 'Lockdown', stat: (s) => s.steals + s.blocks, tiers: [10, 40, 120, 300], coins: [100, 220, 450, 900] },
  { id: 'games', name: 'Gym Rat', stat: (s) => s.gamesPlayed, tiers: [3, 10, 30, 75, 150], coins: [60, 150, 350, 700, 1300] },
];

// ------------------------------------------------------------------------------------ achievements
export const ACHIEVEMENTS = [
  { id: 'first_win', name: 'First W', desc: 'Win your first 1v1 game.', coins: 150 },
  { id: 'shutout', name: 'Shutout', desc: 'Win a game without allowing a point.', coins: 400 },
  { id: 'comeback', name: 'Comeback Kid', desc: 'Win after trailing by 5 or more.', coins: 300 },
  { id: 'green_machine', name: 'Green Machine', desc: 'Make 3 perfect releases in a row in one game.', coins: 300, unlock: 'jersey_green' },
  { id: 'ankle_breaker', name: 'Ankle Breaker', desc: 'Make a defender lose their footing.', coins: 250, unlock: 'emote_ice' },
  { id: 'sniper', name: 'Sniper', desc: 'Make 5 two-pointers in one game.', coins: 300 },
  { id: 'lockdown', name: 'Lockdown', desc: 'Get 3 steals in one game.', coins: 250 },
  { id: 'rim_protector', name: 'Rim Protector', desc: 'Block 2 shots in one game.', coins: 250 },
  { id: 'poster', name: 'Poster', desc: 'Throw down a dunk in a game.', coins: 200 },
  { id: 'swish_city', name: 'Swish City', desc: 'Make 4 swishes in one game.', coins: 250 },
  { id: 'streak3', name: 'Heating Up', desc: 'Win 3 games in a row.', coins: 300 },
  { id: 'streak5', name: 'On Fire', desc: 'Win 5 games in a row.', coins: 600, unlock: 'shoes_green' },
  { id: 'allstar_win', name: 'All-Star Level', desc: 'Beat an All-Star CPU.', coins: 400 },
  { id: 'legend_slayer', name: 'Legend Slayer', desc: 'Beat a Legend CPU.', coins: 800, unlock: 'finish_gold' },
  { id: 'gym_rat', name: 'Gym Rat', desc: 'Make 50 shots in Practice.', coins: 150 },
];

// ------------------------------------------------------------------------------------ levels
export function xpForLevel(level) {
  return 250 + level * 110;
}
export const LEVEL_REWARDS = {
  2: { coins: 150 },
  3: { coins: 200 },
  4: { coins: 220 },
  5: { coins: 300 },
  6: { coins: 260 },
  7: { coins: 280 },
  8: { coins: 350 },
  9: { coins: 300 },
  10: { coins: 500 },
  12: { coins: 400, item: 'ball_chrome' },
  15: { coins: 600, item: 'trail_green' },
  20: { coins: 1000 },
};
export function levelReward(level) {
  return LEVEL_REWARDS[level] || { coins: 150 + level * 15 };
}

export const DIFF_MULT = { rookie: 0.8, pro: 1, allstar: 1.35, legend: 1.8 };

function defaultProfile() {
  const owned = {};
  for (const it of ITEMS) if (it.unlock === 'default') owned[it.id] = true;
  return {
    v: SAVE_VERSION,
    createdAt: Date.now(),
    name: 'YOU',
    xp: 0,
    level: 1,
    coins: 300,
    owned,
    equipped: Object.assign({}, DEFAULT_EQUIPPED),
    look: { skin: '#a86b48', hair: 'short', hairColor: '#17110d', number: 7 },
    stats: lifetimeStats(),
    history: [],
    quests: { day: '', list: [] },
    milestones: {},
    achievements: {},
    settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)),
    tutorialSeen: false,
    releaseHistory: [],
  };
}

function deepMerge(base, over) {
  if (!over || typeof over !== 'object') return base;
  for (const k of Object.keys(base)) {
    if (!(k in over)) continue;
    const b = base[k];
    const o = over[k];
    if (b && typeof b === 'object' && !Array.isArray(b) && o && typeof o === 'object' && !Array.isArray(o)) base[k] = deepMerge(b, o);
    else if (o !== undefined && (typeof o === typeof b || b === null)) base[k] = o;
  }
  // keep extra keys (e.g. per-move counts)
  for (const k of Object.keys(over)) if (!(k in base)) base[k] = over[k];
  return base;
}

export class Profile {
  constructor(events) {
    this.events = events;
    this.data = defaultProfile();
    this._saveTimer = null;
    this.storageOk = true;
    this.load();
    this.refreshQuests();
  }

  // ---------------------------------------------------------------------- persistence
  load() {
    let raw = null;
    try {
      raw = localStorage.getItem(KEY);
      if (!raw) raw = localStorage.getItem(BACKUP);
    } catch (e) {
      this.storageOk = false;
    }
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      this.data = deepMerge(defaultProfile(), migrate(parsed));
    } catch (e) {
      // corrupted main save: try the backup
      try {
        const b = localStorage.getItem(BACKUP);
        if (b) this.data = deepMerge(defaultProfile(), migrate(JSON.parse(b)));
      } catch (e2) {
        /* fall back to defaults */
      }
    }
    // never lose default items, equipped items must be owned
    for (const it of ITEMS) if (it.unlock === 'default') this.data.owned[it.id] = true;
    for (const slot of Object.keys(this.data.equipped)) {
      const id = this.data.equipped[slot];
      if (id && !this.data.owned[id]) this.data.equipped[slot] = DEFAULT_EQUIPPED[slot] ?? null;
    }
  }

  save(immediate = false) {
    if (immediate) return this._write();
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this._write(), 250);
  }

  _write() {
    try {
      const s = JSON.stringify(this.data);
      const prev = localStorage.getItem(KEY);
      if (prev) localStorage.setItem(BACKUP, prev);
      localStorage.setItem(KEY, s);
      this.storageOk = true;
    } catch (e) {
      this.storageOk = false;
    }
  }

  reset() {
    this.data = defaultProfile();
    this.refreshQuests();
    this.save(true);
    this.events && this.events.emit('profile:changed', {});
  }

  get settings() {
    return this.data.settings;
  }

  // ---------------------------------------------------------------------- currency / items
  owns(id) {
    return !!this.data.owned[id];
  }

  canBuy(id) {
    const it = ITEM[id];
    if (!it || this.owns(id)) return { ok: false, reason: 'owned' };
    if (it.unlock === 'achievement') return { ok: false, reason: 'achievement' };
    if (it.unlock === 'level') return { ok: false, reason: 'level' };
    if (this.data.level < (it.level || 1)) return { ok: false, reason: 'level' };
    if (this.data.coins < it.price) return { ok: false, reason: 'coins' };
    return { ok: true };
  }

  buy(id) {
    const c = this.canBuy(id);
    if (!c.ok) return c;
    const it = ITEM[id];
    this.data.coins -= it.price;
    this.data.owned[id] = true;
    this.save(true);
    this.events && this.events.emit('profile:changed', { bought: id });
    return { ok: true };
  }

  grantItem(id) {
    if (!ITEM[id] || this.owns(id)) return false;
    this.data.owned[id] = true;
    this.save();
    return true;
  }

  equip(id) {
    const it = ITEM[id];
    if (!it || !this.owns(id)) return false;
    const slot = slotOf(it);
    this.data.equipped[slot] = id;
    this.save();
    this.events && this.events.emit('profile:changed', { equipped: id });
    return true;
  }

  unequip(slot) {
    if (!(slot in this.data.equipped)) return;
    this.data.equipped[slot] = DEFAULT_EQUIPPED[slot] ?? null;
    this.save();
    this.events && this.events.emit('profile:changed', {});
  }

  addCoins(n) {
    this.data.coins = Math.max(0, Math.round(this.data.coins + n));
  }

  /** Adds XP, processes level ups. Returns array of {level, reward}. */
  addXP(n) {
    const ups = [];
    this.data.xp += Math.round(n);
    while (this.data.xp >= xpForLevel(this.data.level)) {
      this.data.xp -= xpForLevel(this.data.level);
      this.data.level++;
      const r = levelReward(this.data.level);
      this.addCoins(r.coins || 0);
      if (r.item) this.grantItem(r.item);
      ups.push({ level: this.data.level, reward: r });
    }
    return ups;
  }

  // ---------------------------------------------------------------------- quests
  refreshQuests() {
    const day = todayKey();
    if (this.data.quests.day !== day) {
      this.data.quests = { day, list: generateQuests(day) };
      this.save();
    }
  }

  questProgress(metric, n = 1) {
    this.refreshQuests();
    const done = [];
    for (const q of this.data.quests.list) {
      if (q.metric !== metric || q.progress >= q.target) continue;
      q.progress = Math.min(q.target, q.progress + n);
      if (q.progress >= q.target) done.push(q);
    }
    if (done.length) this.events && this.events.emit('quest:complete', { quests: done });
    return done;
  }

  claimQuest(i) {
    const q = this.data.quests.list[i];
    if (!q || q.claimed || q.progress < q.target) return null;
    q.claimed = true;
    this.addCoins(q.coins);
    const ups = this.addXP(q.xp);
    this.save(true);
    this.events && this.events.emit('profile:changed', { quest: q });
    return { coins: q.coins, xp: q.xp, levelUps: ups };
  }

  msUntilNewQuests() {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    return next - now;
  }

  // ---------------------------------------------------------------------- milestones / achievements
  milestoneState(m) {
    const v = m.stat(this.data.stats);
    const claimed = this.data.milestones[m.id] || 0; // tiers claimed
    return { value: v, claimed, nextTier: m.tiers[claimed], done: claimed >= m.tiers.length, claimable: claimed < m.tiers.length && v >= m.tiers[claimed] };
  }

  claimMilestone(id) {
    const m = MILESTONES.find((x) => x.id === id);
    if (!m) return null;
    const st = this.milestoneState(m);
    if (!st.claimable) return null;
    const coins = m.coins[st.claimed];
    this.data.milestones[id] = st.claimed + 1;
    this.addCoins(coins);
    this.save(true);
    this.events && this.events.emit('profile:changed', {});
    return { coins };
  }

  unlockAchievement(id) {
    if (this.data.achievements[id]) return null;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return null;
    this.data.achievements[id] = Date.now();
    this.addCoins(a.coins);
    if (a.unlock) this.grantItem(a.unlock);
    this.save();
    this.events && this.events.emit('achievement', { achievement: a });
    return a;
  }

  // ---------------------------------------------------------------------- matches
  /**
   * Record a finished 1v1 game. Returns a reward summary for the end screen.
   * s: user's game stats, opp: opponent stats, info: { won, userScore, oppScore, difficulty, maxDeficit, perfectStreakMax, duration }
   */
  recordMatch(s, opp, info) {
    const L = this.data.stats;
    const before = { level: this.data.level, xp: this.data.xp, coins: this.data.coins };
    L.gamesPlayed++;
    L.pointsFor += info.userScore;
    L.pointsAgainst += info.oppScore;
    L.fgm += s.fgm;
    L.fga += s.fga;
    L.twoM += s.twoM;
    L.twoA += s.twoA;
    L.perfect += s.perfect;
    L.perfectMade += s.perfectMade;
    L.releases += s.releases;
    L.steals += s.steals;
    L.blocks += s.blocks;
    L.rebounds += s.rebounds;
    L.turnovers += s.turnovers;
    L.dunks += s.dunks;
    L.layupsMade += s.layupsMade;
    L.swishes += s.swishes;
    L.ankles += s.ankles;
    L.movesTotal += s.movesTotal;
    L.playTime += info.duration || 0;
    for (const [k, v] of Object.entries(s.moves)) L.moves[k] = (L.moves[k] || 0) + v;
    if (info.won) {
      L.wins++;
      L.currentStreak++;
      L.bestStreak = Math.max(L.bestStreak, L.currentStreak);
      L.biggestWin = Math.max(L.biggestWin, info.userScore - info.oppScore);
      L.winsByDiff[info.difficulty] = (L.winsByDiff[info.difficulty] || 0) + 1;
    } else {
      L.losses++;
      L.currentStreak = 0;
    }
    // rewards
    const mult = DIFF_MULT[info.difficulty] || 1;
    const xpParts = [
      ['Game played', 60],
      [info.won ? 'Victory' : 'Effort', info.won ? 90 : 20],
      ['Points', info.userScore * 5],
      ['Perfect releases', s.perfectMade * 12],
      ['Defense', (s.steals + s.blocks) * 10],
    ];
    if (info.won && L.currentStreak > 1) xpParts.push(['Win streak', Math.min(5, L.currentStreak) * 15]);
    let xp = 0;
    for (const p of xpParts) xp += p[1];
    xp = Math.round(xp * mult);
    const coins = Math.round(((info.won ? 70 : 25) + info.userScore * 2 + s.perfectMade * 3) * mult);
    this.addCoins(coins);
    const levelUps = this.addXP(xp);
    // quests
    const questsDone = [];
    const qp = (m, n) => {
      if (n > 0) questsDone.push(...this.questProgress(m, n));
    };
    qp('play', 1);
    if (info.won) qp('win', 1);
    qp('make', s.fgm);
    qp('make2', s.twoM);
    qp('green', s.perfectMade);
    qp('steal', s.steals);
    qp('block', s.blocks);
    qp('rebound', s.rebounds);
    qp('rim', s.layupsMade + s.dunks);
    qp('move', s.movesTotal);
    qp('move_cross', s.moves.cross || 0);
    // achievements
    const ach = [];
    const un = (id) => {
      const a = this.unlockAchievement(id);
      if (a) ach.push(a);
    };
    if (info.won) un('first_win');
    if (info.won && info.oppScore === 0) un('shutout');
    if (info.won && info.maxDeficit >= 5) un('comeback');
    if (info.perfectStreakMax >= 3) un('green_machine');
    if (s.ankles > 0) un('ankle_breaker');
    if (s.twoM >= 5) un('sniper');
    if (s.steals >= 3) un('lockdown');
    if (s.blocks >= 2) un('rim_protector');
    if (s.dunks > 0) un('poster');
    if (s.swishes >= 4) un('swish_city');
    if (L.currentStreak >= 3) un('streak3');
    if (L.currentStreak >= 5) un('streak5');
    if (info.won && (info.difficulty === 'allstar' || info.difficulty === 'legend')) un('allstar_win');
    if (info.won && info.difficulty === 'legend') un('legend_slayer');
    this.data.history.unshift({
      t: Date.now(),
      won: info.won,
      us: info.userScore,
      them: info.oppScore,
      diff: info.difficulty,
      opp: info.oppName,
      fgm: s.fgm,
      fga: s.fga,
      perfect: s.perfectMade,
    });
    this.data.history.length = Math.min(this.data.history.length, 20);
    this.save(true);
    this.events && this.events.emit('profile:changed', {});
    return { xp, xpParts, coins, levelUps, questsDone, achievements: ach, before, after: { level: this.data.level, xp: this.data.xp, coins: this.data.coins } };
  }

  recordPractice(makes, attempts, greens) {
    const L = this.data.stats;
    L.practiceMakes += makes;
    L.practiceAttempts += attempts;
    const done = this.questProgress('practiceMake', makes);
    if (L.practiceMakes >= 50) this.unlockAchievement('gym_rat');
    this.save();
    return done;
  }

  pushRelease(delta, grade) {
    const h = this.data.releaseHistory;
    h.push([Math.round(delta * 1000), grade]);
    if (h.length > 20) h.shift();
    this.save();
  }

  favoriteMove() {
    const m = this.data.stats.moves;
    let best = null;
    let n = 0;
    for (const [k, v] of Object.entries(m)) if (v > n) {
      n = v;
      best = k;
    }
    return best ? { id: best, count: n } : null;
  }
}

function migrate(d) {
  if (!d || typeof d !== 'object') return {};
  // v0 -> v1 placeholder: future schema changes go here
  if (!d.v) d.v = 1;
  return d;
}
