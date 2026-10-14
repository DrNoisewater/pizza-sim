// Small DOM/format helpers and the icon set (hand-drawn 24px stroke icons).

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];

export function esc(s: string | number): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

const P: Record<string, string> = {
  staff: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.4 2.8-5.2 5.5-5.2s4.9 1.8 5.5 5.2"/><circle cx="17" cy="9" r="2.4"/><path d="M15.6 13.9c2.4-.3 4.3 1.2 4.9 4.1"/>',
  stock: '<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5z"/><path d="M4 8.5 12 13l8-4.5M12 13v7"/>',
  menu: '<path d="M12 3 3.5 19.5c5.4 2 11.6 2 17 0z"/><circle cx="10.5" cy="12" r="1.3"/><circle cx="14" cy="15.5" r="1.3"/><circle cx="9.5" cy="16.6" r="1"/>',
  upgrades: '<path d="M12 20V6M6.5 11.5 12 6l5.5 5.5"/><path d="M5 3.5h14"/>',
  marketing: '<path d="M4 10v4h3l6 4V6L7 10z"/><path d="M16.5 9a4 4 0 0 1 0 6M19 6.5a7.5 7.5 0 0 1 0 11"/>',
  finance: '<path d="M4 20h16"/><path d="M6.5 16v-4M11 16V8M15.5 16v-6M20 16V5"/>',
  empire: '<path d="M12 21s6.5-6.1 6.5-11A6.5 6.5 0 0 0 5.5 10c0 4.9 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.4"/>',
  goals: '<path d="M6 21V4"/><path d="M6 4.5h11l-2.2 3.7L17 12H6"/>',
  pause: '<path d="M8.5 5v14M15.5 5v14"/>',
  play: '<path d="M7 4.8v14.4L19 12z"/>',
  fast: '<path d="M4 5.5v13L11.5 12zM12.5 5.5v13L20 12z"/>',
  faster: '<path d="M2.5 6v12L8 12zM8.5 6v12L14 12zM14.5 6v12L20 12z"/>',
  burger: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  star: '<path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.6 9.6l5.8-.8z"/>',
  coin: '<circle cx="12" cy="12" r="8"/><path d="M14.8 9.2c-.5-1-1.6-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2.1 0 2.9 5.8 1.6 5.8 4.4 0 1.3-1.3 2.1-3 2.1-1.3 0-2.5-.6-3-1.6M12 6v1.7M12 16.3V18"/>',
  sunny: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  cloudy: '<path d="M7 18h10.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 7.4 9.6 4.2 4.2 0 0 0 7 18z"/>',
  rainy: '<path d="M7 14h10.5a3.5 3.5 0 0 0 .4-7A5.5 5.5 0 0 0 7.4 5.6 4.2 4.2 0 0 0 7 14z"/><path d="M8.5 17l-1 3M12.5 17l-1 3M16.5 17l-1 3"/>',
  hot: '<path d="M12 14.5V5a2 2 0 0 0-4 0v9.5a4 4 0 1 0 4 0z" transform="translate(2 0)"/><path d="M12 15.5v-6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4.5M12 17.2v.3"/>',
  door: '<path d="M6 21V3.5h12V21"/><circle cx="14.5" cy="12" r=".9"/><path d="M3.5 21h17"/>',
  save: '<path d="M5 4h11l3 3v13H5z"/><path d="M8 4v5h7V4M8 20v-6h8v6"/>',
  sound: '<path d="M4 10v4h3l5 4V6L7 10z"/><path d="M15.5 9.5a3.5 3.5 0 0 1 0 5"/>',
  broom: '<path d="M14 3l-4 9"/><path d="M6 21c.5-3 1.5-6 4-9l4 2c-.5 3.5-2 6-4 7z"/>',
  truck: '<path d="M3 6h11v10H3zM14 9h4l3 3.5V16h-7"/><circle cx="7" cy="17.5" r="1.8"/><circle cx="17" cy="17.5" r="1.8"/>',
  heart: '<path d="M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.4 4.3 4.3 0 0 1 19.5 10c0 5.4-7.5 10-7.5 10z"/>',
  bolt: '<path d="M13 3 5.5 13.5H12L11 21l7.5-10.5H12z"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9.5" rx="1.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  cart: '<path d="M3.5 4.5h2.2l2 11h10.5l1.9-7.5H6.6"/><circle cx="9.5" cy="19" r="1.3"/><circle cx="16.5" cy="19" r="1.3"/>',
  camera: '<path d="M4 15a8 8 0 0 1 16 0"/><circle cx="12" cy="15" r="2"/><path d="M12 7V4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.3"/>',
  trash: '<path d="M5 7h14M10 7V4.5h4V7M7 7l1 13h8l1-13"/>',
};

export function icon(name: string, size = 20, cls = ''): string {
  const fill = name === 'play' || name === 'fast' || name === 'faster' || name === 'star' ? 'currentColor' : 'none';
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] ?? ''}</svg>`;
}

/** Star rating shown with partial fill. */
export function stars(r: number, size = 14): string {
  let out = '<span class="stars" aria-label="' + r.toFixed(1) + ' stars">';
  for (let i = 1; i <= 5; i++) {
    const f = Math.max(0, Math.min(1, r - (i - 1)));
    out += `<span class="star" style="--f:${Math.round(f * 100)}%;width:${size}px;height:${size}px"></span>`;
  }
  return out + '</span>';
}

export function meter(v: number, max = 100, tone: 'auto' | 'good' | 'warn' | 'bad' | 'gold' = 'auto'): string {
  const f = Math.max(0, Math.min(1, v / max));
  const t = tone !== 'auto' ? tone : f > 0.6 ? 'good' : f > 0.3 ? 'warn' : 'bad';
  return `<span class="meter m-${t}"><span style="width:${(f * 100).toFixed(1)}%"></span></span>`;
}

export function signed(n: number, fmt: (n: number) => string): string {
  return (n >= 0 ? '+' : '-') + fmt(Math.abs(n)).replace('-', '');
}
