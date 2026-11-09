// Tiny DOM helpers + inline SVG icons.

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export const fmt = {
  int: (n) => Math.round(n).toLocaleString('en-US'),
  pct: (a, b) => (b > 0 ? `${Math.round((100 * a) / b)}%` : '—'),
  clock: (s) => {
    s = Math.max(0, Math.floor(s));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  },
  dur: (ms) => {
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `${h}h ${m}m`;
  },
};

const svg = (p, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" ${extra}>${p}</svg>`;
export const ICON = {
  back: svg('<path d="M15 5l-7 7 7 7"/>'),
  pause: svg('<path d="M8 5v14M16 5v14"/>'),
  play: svg('<path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/>'),
  camera: svg('<rect x="3" y="7" width="13" height="10"/><path d="M16 10l5-3v10l-5-3"/>'),
  sound: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9c1.5 1.7 1.5 4.3 0 6"/>'),
  mute: svg('<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l4 6M21 9l-4 6"/>'),
  stats: svg('<path d="M5 20V11M12 20V4M19 20v-6"/>'),
  gear: svg('<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  trophy: svg('<path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4M12 14v4M8 20h8"/>'),
  medal: svg('<circle cx="12" cy="14" r="5"/><path d="M8 3l3 6M16 3l-3 6"/>'),
  lock: svg('<rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  check: svg('<path d="M5 12l5 5 9-10"/>'),
  ball: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3v18M6 5.5c3 3 3 10 0 13M18 5.5c-3 3-3 10 0 13"/>'),
  gift: svg('<rect x="4" y="10" width="16" height="10"/><path d="M3 7h18v3H3zM12 7v13M12 7c-2-4-6-3-5 0M12 7c2-4 6-3 5 0"/>'),
};

export const LOGO_MARK = `<svg class="mark" viewBox="0 0 64 64" fill="none"><circle cx="32" cy="32" r="27" stroke="#2ad4ff" stroke-width="4"/><path d="M32 5v54M5 32h54" stroke="#2ad4ff" stroke-width="3"/><path d="M14 12c9 10 9 30 0 40M50 12c-9 10-9 30 0 40" stroke="#eef3f8" stroke-width="3"/></svg>`;
