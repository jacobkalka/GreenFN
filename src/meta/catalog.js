// Cosmetic catalog. Everything is cosmetic: no item changes ratings or shot odds.
// unlock: 'default' (owned from the start), 'shop' (buy with coins, may need a level),
// 'level' (free at a level), 'achievement' (earned by an achievement).

export const CATEGORIES = [
  { id: 'jersey', name: 'Jerseys', slot: 'jersey' },
  { id: 'shorts', name: 'Shorts', slot: 'shorts' },
  { id: 'shoes', name: 'Shoes', slot: 'shoes' },
  { id: 'ball', name: 'Ball Skins', slot: 'ball' },
  { id: 'accessory', name: 'Accessories', slot: null },
  { id: 'finish', name: 'Body Finish', slot: 'finish' },
  { id: 'jumpshot', name: 'Jump Shots', slot: 'jumpshot' },
  { id: 'emote', name: 'Celebrations', slot: 'emote' },
  { id: 'effect', name: 'Release FX', slot: 'effect' },
  { id: 'trail', name: 'Ball Trails', slot: 'trail' },
  { id: 'court', name: 'Courts', slot: 'court' },
];

export const RARITY = {
  common: { name: 'Common', color: '#9aa4b2' },
  rare: { name: 'Rare', color: '#2ad4ff' },
  epic: { name: 'Epic', color: '#b277ff' },
  legendary: { name: 'Legendary', color: '#ffc94a' },
};

const J = (id, name, rarity, price, level, base, trim, number, pattern = 'solid', unlock = 'shop') => ({
  id: 'jersey_' + id,
  cat: 'jersey',
  name,
  rarity,
  price,
  level,
  unlock,
  data: { base, trim, number, pattern },
  swatch: [base, trim],
});
const S = (id, name, rarity, price, level, base, trim, unlock = 'shop') => ({
  id: 'shorts_' + id,
  cat: 'shorts',
  name,
  rarity,
  price,
  level,
  unlock,
  data: { base, trim },
  swatch: [base, trim],
});
const SH = (id, name, rarity, price, level, upper, sole, accent, unlock = 'shop') => ({
  id: 'shoes_' + id,
  cat: 'shoes',
  name,
  rarity,
  price,
  level,
  unlock,
  data: { upper, sole, accent },
  swatch: [upper, accent],
});

export const ITEMS = [
  // ------------------------------------------------------------------ jerseys
  J('midnight', 'Midnight', 'common', 0, 1, '#0f1726', '#2ad4ff', '#ffffff', 'solid', 'default'),
  J('home', 'Home White', 'common', 0, 1, '#f2f4f7', '#0f1726', '#0f1726', 'solid', 'default'),
  J('crimson', 'Crimson', 'common', 220, 1, '#a3122a', '#ffffff', '#ffffff'),
  J('royal', 'Royal', 'common', 220, 1, '#1d3fbf', '#ffffff', '#ffffff'),
  J('gold', 'Gold Rush', 'rare', 450, 2, '#f2c94c', '#111111', '#111111'),
  J('forest', 'Forest', 'rare', 450, 3, '#0f5132', '#e9d38a', '#e9d38a'),
  J('ice', 'Glacier', 'rare', 520, 3, '#d8ecf7', '#1b5e86', '#1b5e86'),
  J('volt', 'Volt', 'epic', 900, 4, '#c8ff2e', '#0a0a0a', '#0a0a0a'),
  J('carbon', 'Carbon', 'epic', 950, 5, '#1b1d22', '#3a3f48', '#2ad4ff', 'stripes'),
  J('halftone', 'Halftone', 'epic', 1100, 6, '#e9edf2', '#1a1d22', '#1a1d22', 'halftone'),
  J('sunset', 'Sunset Fade', 'legendary', 1900, 8, '#ff7a45', '#6b2fa0', '#ffffff', 'fade'),
  J('cyber', 'Cyber Split', 'legendary', 2200, 10, '#0a0a12', '#ff4fd8', '#ffffff', 'split'),
  J('green', 'Green Light', 'legendary', 0, 1, '#0d3b24', '#3dff8a', '#3dff8a', 'stripes', 'achievement'),
  // ------------------------------------------------------------------ shorts
  S('midnight', 'Midnight', 'common', 0, 1, '#0f1726', '#2ad4ff', 'default'),
  S('home', 'Home White', 'common', 0, 1, '#f2f4f7', '#0f1726', 'default'),
  S('black', 'Black', 'common', 160, 1, '#111214', '#e8e8e8'),
  S('crimson', 'Crimson', 'common', 180, 1, '#a3122a', '#ffffff'),
  S('royal', 'Royal', 'common', 180, 1, '#1d3fbf', '#ffffff'),
  S('gold', 'Gold Rush', 'rare', 380, 2, '#f2c94c', '#111111'),
  S('forest', 'Forest', 'rare', 380, 3, '#0f5132', '#e9d38a'),
  S('volt', 'Volt', 'epic', 760, 4, '#c8ff2e', '#0a0a0a'),
  S('cyber', 'Cyber', 'legendary', 1500, 10, '#0a0a12', '#ff4fd8'),
  // ------------------------------------------------------------------ shoes
  SH('court', 'Court Classic', 'common', 0, 1, '#f2f4f7', '#e9ecef', '#2ad4ff', 'default'),
  SH('blackout', 'Blackout', 'common', 260, 1, '#141518', '#1c1d21', '#3a3d44'),
  SH('infrared', 'Infrared', 'rare', 520, 2, '#f4f4f4', '#202020', '#ff3b3b'),
  SH('royal', 'Royal Hi', 'rare', 520, 3, '#1d3fbf', '#f2f2f2', '#ffffff'),
  SH('volt', 'Volt Runner', 'epic', 980, 4, '#0d0f12', '#c8ff2e', '#c8ff2e'),
  SH('ice', 'Ice Sole', 'epic', 1050, 5, '#e8f4fb', '#9fd3f0', '#1b5e86'),
  SH('gold', 'Gold Standard', 'legendary', 2000, 8, '#1a1a1a', '#d9a740', '#d9a740'),
  SH('green', 'Green Machine', 'legendary', 0, 1, '#0d1a12', '#3dff8a', '#3dff8a', 'achievement'),
  // ------------------------------------------------------------------ ball skins
  { id: 'ball_classic', cat: 'ball', name: 'Classic', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { skin: 'classic' }, swatch: ['#c45622', '#18120f'] },
  { id: 'ball_street', cat: 'ball', name: 'Street Worn', rarity: 'common', price: 200, level: 1, unlock: 'shop', data: { skin: 'street' }, swatch: ['#964e28', '#28201a'] },
  { id: 'ball_tricolor', cat: 'ball', name: 'Tricolor', rarity: 'rare', price: 480, level: 2, unlock: 'shop', data: { skin: 'tricolor' }, swatch: ['#ce2830', '#f0f0f0'] },
  { id: 'ball_midnight', cat: 'ball', name: 'Midnight', rarity: 'rare', price: 560, level: 3, unlock: 'shop', data: { skin: 'midnight' }, swatch: ['#181c24', '#2ad4ff'] },
  { id: 'ball_ice', cat: 'ball', name: 'Ice', rarity: 'epic', price: 900, level: 4, unlock: 'shop', data: { skin: 'ice' }, swatch: ['#d6ecf8', '#2878aa'] },
  { id: 'ball_volt', cat: 'ball', name: 'Volt', rarity: 'epic', price: 900, level: 5, unlock: 'shop', data: { skin: 'volt' }, swatch: ['#bef028', '#141e14'] },
  { id: 'ball_gold', cat: 'ball', name: 'Gold Rush', rarity: 'legendary', price: 1800, level: 7, unlock: 'shop', data: { skin: 'gold' }, swatch: ['#d4a038', '#3c280a'] },
  { id: 'ball_chrome', cat: 'ball', name: 'Chrome', rarity: 'legendary', price: 0, level: 12, unlock: 'level', data: { skin: 'chrome' }, swatch: ['#cdd4dc', '#1e2024'] },
  // ------------------------------------------------------------------ accessories
  { id: 'acc_headband_white', cat: 'accessory', slot: 'headband', name: 'Headband · White', rarity: 'common', price: 120, level: 1, unlock: 'shop', data: { color: '#f2f4f7' }, swatch: ['#f2f4f7'] },
  { id: 'acc_headband_black', cat: 'accessory', slot: 'headband', name: 'Headband · Black', rarity: 'common', price: 120, level: 1, unlock: 'shop', data: { color: '#141414' }, swatch: ['#141414'] },
  { id: 'acc_headband_cyan', cat: 'accessory', slot: 'headband', name: 'Headband · Electric', rarity: 'rare', price: 300, level: 2, unlock: 'shop', data: { color: '#2ad4ff' }, swatch: ['#2ad4ff'] },
  { id: 'acc_headband_red', cat: 'accessory', slot: 'headband', name: 'Headband · Red', rarity: 'rare', price: 300, level: 3, unlock: 'shop', data: { color: '#d8202f' }, swatch: ['#d8202f'] },
  { id: 'acc_wrist_white', cat: 'accessory', slot: 'wristbands', name: 'Wristbands · White', rarity: 'common', price: 100, level: 1, unlock: 'shop', data: { color: '#f2f4f7' }, swatch: ['#f2f4f7'] },
  { id: 'acc_wrist_black', cat: 'accessory', slot: 'wristbands', name: 'Wristbands · Black', rarity: 'common', price: 100, level: 1, unlock: 'shop', data: { color: '#141414' }, swatch: ['#141414'] },
  { id: 'acc_wrist_cyan', cat: 'accessory', slot: 'wristbands', name: 'Wristbands · Electric', rarity: 'rare', price: 260, level: 2, unlock: 'shop', data: { color: '#2ad4ff' }, swatch: ['#2ad4ff'] },
  { id: 'acc_sleeve_black', cat: 'accessory', slot: 'sleeve', name: 'Arm Sleeve · Black', rarity: 'rare', price: 340, level: 2, unlock: 'shop', data: { color: '#141414' }, swatch: ['#141414'] },
  { id: 'acc_sleeve_white', cat: 'accessory', slot: 'sleeve', name: 'Arm Sleeve · White', rarity: 'rare', price: 340, level: 3, unlock: 'shop', data: { color: '#f2f4f7' }, swatch: ['#f2f4f7'] },
  { id: 'acc_sleeve_cyan', cat: 'accessory', slot: 'sleeve', name: 'Arm Sleeve · Electric', rarity: 'epic', price: 700, level: 5, unlock: 'shop', data: { color: '#2ad4ff' }, swatch: ['#2ad4ff'] },
  { id: 'acc_legsleeve_black', cat: 'accessory', slot: 'legSleeve', name: 'Leg Sleeve · Black', rarity: 'rare', price: 360, level: 3, unlock: 'shop', data: { color: '#141414' }, swatch: ['#141414'] },
  { id: 'acc_legsleeve_white', cat: 'accessory', slot: 'legSleeve', name: 'Leg Sleeve · White', rarity: 'rare', price: 360, level: 4, unlock: 'shop', data: { color: '#f2f4f7' }, swatch: ['#f2f4f7'] },
  // ------------------------------------------------------------------ finishes
  { id: 'finish_none', cat: 'finish', name: 'Natural', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { fx: null }, swatch: ['#a86b48'] },
  { id: 'finish_halftone', cat: 'finish', name: 'Halftone', rarity: 'epic', price: 1200, level: 6, unlock: 'shop', data: { fx: 'halftone' }, swatch: ['#e9edf2', '#1a1d22'] },
  { id: 'finish_neon', cat: 'finish', name: 'Neon Grid', rarity: 'epic', price: 1300, level: 7, unlock: 'shop', data: { fx: 'neon' }, swatch: ['#11161f', '#2ad4ff'] },
  { id: 'finish_chrome', cat: 'finish', name: 'Chrome', rarity: 'legendary', price: 2400, level: 10, unlock: 'shop', data: { fx: 'chrome' }, swatch: ['#c9d2dc', '#5b6470'] },
  { id: 'finish_gold', cat: 'finish', name: 'Solid Gold', rarity: 'legendary', price: 0, level: 1, unlock: 'achievement', data: { fx: 'gold' }, swatch: ['#d9a740', '#7a5418'] },
  // ------------------------------------------------------------------ jump shots (cosmetic animation styles)
  { id: 'js_classic', cat: 'jumpshot', name: 'Classic', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { style: 'classic' }, desc: 'Balanced set point and a smooth release.' },
  { id: 'js_quick', cat: 'jumpshot', name: 'Quick Trigger', rarity: 'rare', price: 600, level: 2, unlock: 'shop', data: { style: 'quick' }, desc: 'Low set point, fast release. Same window, earlier timing.' },
  { id: 'js_sling', cat: 'jumpshot', name: 'Sling Shot', rarity: 'rare', price: 600, level: 3, unlock: 'shop', data: { style: 'sling' }, desc: 'Low-slung one-motion form.' },
  { id: 'js_high', cat: 'jumpshot', name: 'High Release', rarity: 'epic', price: 1100, level: 5, unlock: 'shop', data: { style: 'high' }, desc: 'Big elevation, high release point, later timing.' },
  { id: 'js_fade', cat: 'jumpshot', name: 'Fade Artist', rarity: 'legendary', price: 1700, level: 8, unlock: 'shop', data: { style: 'fade' }, desc: 'Signature fade with a leg kick.' },
  // ------------------------------------------------------------------ celebrations
  { id: 'emote_fist', cat: 'emote', name: 'Fist Pump', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { emote: 'fist' } },
  { id: 'emote_point', cat: 'emote', name: 'Sky Point', rarity: 'common', price: 180, level: 1, unlock: 'shop', data: { emote: 'point' } },
  { id: 'emote_shrug', cat: 'emote', name: 'Shrug', rarity: 'rare', price: 400, level: 2, unlock: 'shop', data: { emote: 'shrug' } },
  { id: 'emote_flex', cat: 'emote', name: 'Flex', rarity: 'rare', price: 450, level: 3, unlock: 'shop', data: { emote: 'flex' } },
  { id: 'emote_goggles', cat: 'emote', name: 'Goggles', rarity: 'epic', price: 850, level: 4, unlock: 'shop', data: { emote: 'goggles' } },
  { id: 'emote_chest', cat: 'emote', name: 'Chest Pound', rarity: 'epic', price: 850, level: 5, unlock: 'shop', data: { emote: 'chest' } },
  { id: 'emote_bow', cat: 'emote', name: 'Take a Bow', rarity: 'legendary', price: 1600, level: 8, unlock: 'shop', data: { emote: 'bow' } },
  { id: 'emote_ice', cat: 'emote', name: 'Ice Cold', rarity: 'legendary', price: 0, level: 1, unlock: 'achievement', data: { emote: 'ice' } },
  // ------------------------------------------------------------------ release effects
  { id: 'fx_green', cat: 'effect', name: 'Green Light', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { color: '#3dff8a' }, swatch: ['#3dff8a'] },
  { id: 'fx_cyan', cat: 'effect', name: 'Electric', rarity: 'rare', price: 420, level: 2, unlock: 'shop', data: { color: '#2ad4ff' }, swatch: ['#2ad4ff'] },
  { id: 'fx_gold', cat: 'effect', name: 'Gold Spark', rarity: 'epic', price: 900, level: 4, unlock: 'shop', data: { color: '#ffc94a' }, swatch: ['#ffc94a'] },
  { id: 'fx_violet', cat: 'effect', name: 'Violet', rarity: 'epic', price: 900, level: 5, unlock: 'shop', data: { color: '#b277ff' }, swatch: ['#b277ff'] },
  { id: 'fx_inferno', cat: 'effect', name: 'Inferno', rarity: 'legendary', price: 1500, level: 7, unlock: 'shop', data: { color: '#ff6a2a' }, swatch: ['#ff6a2a'] },
  // ------------------------------------------------------------------ trails
  { id: 'trail_none', cat: 'trail', name: 'No Trail', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { color: null }, swatch: ['#2a2f38'] },
  { id: 'trail_cyan', cat: 'trail', name: 'Comet', rarity: 'rare', price: 650, level: 3, unlock: 'shop', data: { color: '#2ad4ff' }, swatch: ['#2ad4ff'] },
  { id: 'trail_fire', cat: 'trail', name: 'Heat Check', rarity: 'epic', price: 1200, level: 6, unlock: 'shop', data: { color: '#ff7a2a' }, swatch: ['#ff7a2a'] },
  { id: 'trail_green', cat: 'trail', name: 'Green Streak', rarity: 'legendary', price: 0, level: 15, unlock: 'level', data: { color: '#3dff8a' }, swatch: ['#3dff8a'] },
  // ------------------------------------------------------------------ courts
  { id: 'court_classic', cat: 'court', name: 'Classic Maple', rarity: 'common', price: 0, level: 1, unlock: 'default', data: { theme: 'classic' }, swatch: ['#d6ac7a', '#566b8a'] },
  { id: 'court_retro', cat: 'court', name: 'Retro Hardwood', rarity: 'rare', price: 700, level: 2, unlock: 'shop', data: { theme: 'retro' }, swatch: ['#e2a866', '#b9462a'] },
  { id: 'court_blacktop', cat: 'court', name: 'Blacktop', rarity: 'rare', price: 700, level: 3, unlock: 'shop', data: { theme: 'blacktop' }, swatch: ['#46464a', '#283848'] },
  { id: 'court_ice', cat: 'court', name: 'Ice Arena', rarity: 'epic', price: 1300, level: 5, unlock: 'shop', data: { theme: 'ice' }, swatch: ['#ece8e2', '#8fc3e6'] },
  { id: 'court_midnight', cat: 'court', name: 'Midnight', rarity: 'epic', price: 1400, level: 6, unlock: 'shop', data: { theme: 'midnight' }, swatch: ['#78563a', '#0d2533'] },
  { id: 'court_neon', cat: 'court', name: 'Neon Night', rarity: 'legendary', price: 2400, level: 9, unlock: 'shop', data: { theme: 'neon' }, swatch: ['#34323c', '#ff4fd8'] },
];

export const ITEM = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const DEFAULT_EQUIPPED = {
  jersey: 'jersey_midnight',
  shorts: 'shorts_midnight',
  shoes: 'shoes_court',
  ball: 'ball_classic',
  headband: null,
  wristbands: null,
  sleeve: null,
  legSleeve: null,
  finish: 'finish_none',
  jumpshot: 'js_classic',
  emote: 'emote_fist',
  effect: 'fx_green',
  trail: 'trail_none',
  court: 'court_classic',
};

export function slotOf(item) {
  if (item.cat === 'accessory') return item.slot;
  return item.cat;
}

/** Build a CharacterView look object from equipped items + base appearance. */
export function lookFromProfile(profile) {
  const eq = profile.equipped;
  const ap = profile.look;
  const g = (id) => (id && ITEM[id] ? ITEM[id].data : null);
  const jersey = g(eq.jersey) || ITEM.jersey_midnight.data;
  const shorts = g(eq.shorts) || ITEM.shorts_midnight.data;
  const shoes = g(eq.shoes) || ITEM.shoes_court.data;
  return {
    skin: ap.skin,
    hair: ap.hair,
    hairColor: ap.hairColor,
    number: ap.number,
    jersey: { base: jersey.base, trim: jersey.trim, number: jersey.number, pattern: jersey.pattern },
    shorts: { base: shorts.base, trim: shorts.trim },
    shoes: { upper: shoes.upper, sole: shoes.sole, accent: shoes.accent },
    socks: '#f4f5f7',
    headband: eq.headband ? g(eq.headband).color : null,
    wristbands: eq.wristbands ? g(eq.wristbands).color : null,
    sleeve: eq.sleeve ? g(eq.sleeve).color : null,
    legSleeve: eq.legSleeve ? g(eq.legSleeve).color : null,
    skinFx: g(eq.finish) ? g(eq.finish).fx : null,
  };
}
