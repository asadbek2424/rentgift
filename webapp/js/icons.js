// Inline SVG icons (stroke = currentColor).
const s = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const icons = {
  gift: s('<rect x="3" y="8" width="18" height="13" rx="2.5"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-1.8-3.6-6-4.2-6-1.6C6 8 9 8 12 8Zm0 0c1.8-3.6 6-4.2 6-1.6C18 8 15 8 12 8Z"/>'),
  key: s('<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>'),
  book: s('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 7.5h7M9 11h5"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  shield: s('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>'),
  globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21M12 3C9.4 5.6 8.2 8.6 8.2 12s1.2 6.4 3.8 9"/>'),
  chevronRight: s('<path d="m9 6 6 6-6 6"/>'),
  chevronDown: s('<path d="m6 9 6 6 6-6"/>'),
  cart: s('<path d="M3.5 4h2l2.2 10.2a1.8 1.8 0 0 0 1.8 1.4h7.6a1.8 1.8 0 0 0 1.8-1.4L20.5 8H6.6"/><circle cx="10" cy="19.5" r="1.3"/><circle cx="17" cy="19.5" r="1.3"/>'),
  snow: s('<path d="M12 3v18M4.2 7.5l15.6 9M4.2 16.5l15.6-9"/><path d="m9.5 4.5 2.5 2 2.5-2M9.5 19.5l2.5-2 2.5 2"/>'),
  alert: s('<path d="M12 3.5 2.8 19.5h18.4L12 3.5Z"/><path d="M12 10v4.2M12 17.2v.1"/>'),
  clock: s('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  checkCircle: s('<circle cx="12" cy="12" r="8.5"/><path d="m8.3 12.2 2.5 2.5 5-5"/>'),
  chevronLeft: s('<path d="m15 6-6 6 6 6"/>'),
  close: s('<path d="M6 6l12 12M18 6 6 18"/>', 'stroke-width="2.4"'),
  card: s('<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M2.5 10h19M6.5 15h4"/>'),
  chat: s('<path d="M21 12a8 8 0 0 1-11.8 7L4 20.5l1.5-4.6A8 8 0 1 1 21 12Z"/>'),
  bell: s('<path d="M6 9a6 6 0 1 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z"/><path d="M10 19.5a2 2 0 0 0 4 0"/>'),
  doc: s('<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>'),
  sort: s('<path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/>'),
  x: s('<path d="M7 7l10 10M17 7 7 17"/>', 'stroke-width="2.4"'),
  wallet: s('<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v4"/><rect x="3.5" y="7.5" width="17" height="12" rx="2.5"/><path d="M16 13.5h2"/>'),
  upload: s('<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>'),
  link: s('<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>'),
  check: s('<path d="m5 12.5 4.5 4.5L19 7.5"/>', 'stroke-width="2.6"'),
  layers: s('<rect x="4" y="9" width="16" height="11" rx="2.5"/><path d="M6.5 6h11M9 3h6"/>'),
  sliders: s('<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>'),
  search: s('<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>'),
  telegram: s('<path d="M21 4 3 11l6 2.5M21 4l-3 16-9-6.5M21 4 9 13.5V19l3-3"/>'),
  star: s('<path d="M12 3.5 14.6 9l6 .7-4.4 4.1 1.2 5.9L12 16.8l-5.4 2.9 1.2-5.9L3.4 9.7l6-.7L12 3.5Z"/>'),
  bolt: s('<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>'),
  users: s('<circle cx="9" cy="8.5" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M18 14.3c2.1.7 3.5 2.7 3.5 5.7"/>'),
  trophy: s('<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M10 17h4v3.5h-4z"/>'),
  phone: s('<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z"/>'),
  plus: s('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.4"'),
};

// Original illustrations (not copied from anywhere).
export const art = {
  star: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><defs>
    <linearGradient id="sg1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe680"/><stop offset=".55" stop-color="#ffc21a"/><stop offset="1" stop-color="#f08c00"/></linearGradient></defs>
    <path d="M86 26c8 4 12 10 13 17M94 20c9 6 13 13 14 21" stroke="#ffd34d" stroke-width="5" stroke-linecap="round" fill="none" opacity=".8"/>
    <path d="M58 14l12.4 26.2 28.6 3.4-21 19.8 5.6 28.4L58 77.6 32.4 91.8 38 63.4 17 43.6l28.6-3.4z" fill="url(#sg1)" stroke="#fff3c4" stroke-width="2.5" stroke-linejoin="round"/>
    <path d="M58 26l8 17 18 2.3" stroke="#fff8dc" stroke-width="4" stroke-linecap="round" fill="none" opacity=".7"/></svg>`,
  giftBox: `<img class="art-img" src="/static/img/gift-hero.webp" alt="" draggable="false">`,
  globe: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="gl1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#4fb4ff"/><stop offset="1" stop-color="#3d6be0"/></linearGradient></defs>
    <circle cx="56" cy="60" r="38" fill="url(#gl1)"/>
    <path d="M36 40c8 2 10 8 18 7s6-9 14-9 9 7 13 12M30 66c9-3 14 3 20 9s3 14 10 15M70 62c6 1 8 7 15 6" stroke="#9fe3b1" stroke-width="6" fill="none" stroke-linecap="round"/>
    <rect x="72" y="16" width="38" height="26" rx="8" fill="#fff"/><path d="M80 47l4-6h-8z" fill="#fff"/>
    <text x="91" y="34" font-size="14" font-weight="800" text-anchor="middle" fill="#3d6be0" font-family="Arial">Aa</text></svg>`,
  card: `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
    <rect x="6" y="16" width="44" height="30" rx="6" fill="#ffffff" opacity=".95"/><rect x="6" y="23" width="44" height="6" fill="#1f9d4a"/>
    <rect x="14" y="20" width="44" height="30" rx="6" fill="#d9ffe6"/><rect x="20" y="40" width="14" height="4" rx="2" fill="#1f9d4a"/>
    <circle cx="48" cy="40" r="5" fill="#1f9d4a" opacity=".6"/><circle cx="52" cy="40" r="5" fill="#1f9d4a" opacity=".35"/></svg>`,
};

export function placeholder(name = '') {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = h % 360;
  return `<div class="ph" style="background:linear-gradient(140deg,hsl(${hue} 60% 46%),hsl(${(hue + 50) % 360} 65% 30%))">${icons.gift}</div>`;
}

// ---------------------------------------------------------------- Tower icon set
// Filled bottom-nav icons (MARKET / INVENTORY / ACTIVITY / PROFILE) and status icons.
const f = (body, vb = '0 0 24 24') => `<svg viewBox="${vb}" fill="currentColor" aria-hidden="true">${body}</svg>`;
export const nav = {
  market: f('<path d="M12 2.6 2.8 7.3a1 1 0 0 0 .46 1.9h17.5a1 1 0 0 0 .46-1.9L12 2.6Z"/><rect x="4.4" y="10.6" width="2.8" height="7.2" rx="1"/><rect x="10.6" y="10.6" width="2.8" height="7.2" rx="1"/><rect x="16.8" y="10.6" width="2.8" height="7.2" rx="1"/><rect x="2.6" y="19.2" width="18.8" height="2.4" rx="1.2"/>'),
  inventory: f('<rect x="3" y="3" width="8" height="8" rx="2.4"/><rect x="13" y="3" width="8" height="8" rx="2.4"/><rect x="3" y="13" width="8" height="8" rx="2.4"/><rect x="13" y="13" width="8" height="8" rx="2.4"/>'),
  activity: f('<path d="M12 3c5 0 9 3.6 9 8s-4 8-9 8c-1 0-2-.1-2.9-.4L5 20.5c-.6.3-1.3-.3-1.1-.9l.9-3A7.6 7.6 0 0 1 3 11c0-4.4 4-8 9-8Z"/><circle cx="8" cy="11" r="1.4" fill="#0b0f16"/><circle cx="12" cy="11" r="1.4" fill="#0b0f16"/><circle cx="16" cy="11" r="1.4" fill="#0b0f16"/>'),
  profile: f('<circle cx="12" cy="7.6" r="4.6"/><path d="M3.6 20.2c0-4.2 3.8-7 8.4-7s8.4 2.8 8.4 7c0 .7-.5 1.2-1.2 1.2H4.8c-.7 0-1.2-.5-1.2-1.2Z"/>'),
};

// Flat glyphs from the first logo sheet: alert (red outline), basket, 2×2 grid, minus (blue tile), users.
export const flat = {
  alert: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><rect x="3" y="3" width="18" height="18" rx="5.5"/><path d="M12 7.6v5.2M12 16.4v.1"/></svg>`,
  basket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8.4 3.4-3 5M15.6 3.4l3 5M3 8.6h18"/><path d="m4.6 8.8 1.6 8.6a3 3 0 0 0 3 2.4h5.6a3 3 0 0 0 3-2.4l1.6-8.6"/><path d="M10 12.2v3.6M14 12.2v3.6"/></svg>`,
  grid: nav.inventory,
  minus: `<svg viewBox="0 0 24 24"><rect x="2.5" y="2.5" width="19" height="19" rx="6" fill="currentColor"/><path d="M8 12h8" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`,
  users: f('<circle cx="9.4" cy="7.6" r="4.2"/><path d="M2 19.4c0-3.8 3.3-6.2 7.4-6.2s7.4 2.4 7.4 6.2c0 .6-.5 1.1-1.1 1.1H3.1c-.6 0-1.1-.5-1.1-1.1Z"/><path d="M16.2 3.9a3.7 3.7 0 0 1 0 7.4 5.8 5.8 0 0 0 0-7.4ZM17.6 13.4c2.6.4 4.4 2.4 4.4 5.2 0 .6-.5 1.1-1.1 1.1h-2.6c.1-.4.1-.8.1-1.2 0-2-.3-3.6-.8-5.1Z"/>'),
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="m8.2 12.3 2.6 2.6 5-5.2"/></svg>`,
  snow: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2.8v18.4M4 7.4l16 9.2M4 16.6l16-9.2"/><path d="m9.4 4.4 2.6 2 2.6-2M9.4 19.6l2.6-2 2.6 2M3.6 10.2l3.4.6-1.2 3.2M20.4 13.8l-3.4-.6 1.2-3.2M5.8 10l1.2 3.2-3.4.6M18.2 14l-1.2-3.2 3.4-.6"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7.5V12l3 2"/></svg>`,
  trash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 6.5h16M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7"/><path d="m6 6.5.9 12.3a2 2 0 0 0 2 1.7h6.2a2 2 0 0 0 2-1.7L18 6.5"/></svg>`,
  eye: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>`,
  share: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="m8.2 10.8 7.6-4M8.2 13.2l7.6 4"/></svg>`,
  more: f('<circle cx="5.5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="18.5" cy="12" r="1.9"/>'),
  sum: `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="currentColor"/><path d="M8.4 9.4c0-1.6 1.6-2.6 3.6-2.6s3.4.8 3.6 2.2M15.6 14.6c0 1.6-1.6 2.6-3.6 2.6s-3.6-1-3.6-2.6M8.4 9.4c0 3.6 7.2 1.6 7.2 5.2" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/></svg>`,
};

// Glossy "glow" tiles from the second logo sheet: ticket (blue), bag (green / orange), users (blue), wallet (green), card (orange).
const GLOW = {
  blue: ['#46b2ff', '#1677ee', 'rgba(30,140,255,.55)'],
  green: ['#35f0a0', '#12c473', 'rgba(20,210,120,.5)'],
  orange: ['#ffc23a', '#f29200', 'rgba(255,160,20,.5)'],
  violet: ['#b58cff', '#7a4cf0', 'rgba(140,90,255,.5)'],
  red: ['#ff7a7f', '#ee3b45', 'rgba(255,70,80,.5)'],
};
const glowShapes = {
  ticket: (a) => `<path d="M3 7.2A2.2 2.2 0 0 1 5.2 5h13.6A2.2 2.2 0 0 1 21 7.2v2.1a2.7 2.7 0 0 0 0 5.4v2.1a2.2 2.2 0 0 1-2.2 2.2H5.2A2.2 2.2 0 0 1 3 16.8v-2.1a2.7 2.7 0 0 0 0-5.4Z" fill="url(#${a})"/><path d="M10.4 9.2v5.6M13.6 9.2v5.6" stroke="#eaf4ff" stroke-width="1.6" stroke-linecap="round"/>`,
  bag: (a) => `<path d="M9 7V5.6C9 4.7 9.7 4 10.6 4h2.8c.9 0 1.6.7 1.6 1.6V7" fill="none" stroke="url(#${a})" stroke-width="1.8"/><rect x="3" y="7" width="18" height="13" rx="3.4" fill="url(#${a})"/><circle cx="12" cy="13.4" r="2.9" fill="none" stroke="#102016" stroke-opacity=".85" stroke-width="1.7"/>`,
  users: (a) => `<circle cx="9.6" cy="8" r="3.8" fill="url(#${a})"/><path d="M3 19c0-3.4 3-5.6 6.6-5.6s6.6 2.2 6.6 5.6c0 .6-.4 1-1 1H4c-.6 0-1-.4-1-1Z" fill="url(#${a})"/><circle cx="17.2" cy="11" r="2.6" fill="url(#${a})"/><path d="M14.8 20c.2-.3.3-.6.3-1 0-1.4-.4-2.6-1.2-3.6a4.6 4.6 0 0 1 3.3-1.4c2.4 0 4 1.6 4 3.8 0 1.2-.6 2.2-1.6 2.2Z" fill="url(#${a})"/>`,
  wallet: (a) => `<path d="M14.6 6.2 16 4.4c.4-.5 1.2-.6 1.7-.2l1.3 1.2" fill="none" stroke="url(#${a})" stroke-width="1.6" stroke-linecap="round"/><rect x="3" y="6" width="18" height="14" rx="3.4" fill="url(#${a})"/><path d="M6 9h10" stroke="#0e2a1c" stroke-opacity=".55" stroke-width="1.4" stroke-linecap="round"/><circle cx="17.4" cy="14.2" r="1.3" fill="#0e2a1c" fill-opacity=".8"/>`,
  card: (a) => `<rect x="2.6" y="5" width="18.8" height="14" rx="3" fill="url(#${a})"/><rect x="4.8" y="8.2" width="14.4" height="2.4" rx=".8" fill="#3a2100" fill-opacity=".8"/><rect x="5.4" y="13.8" width="4.6" height="2" rx="1" fill="#3a2100" fill-opacity=".8"/>`,
  star: (a) => `<path d="M12 3.2 14.6 8.6l5.9.8-4.3 4.1 1 5.9L12 16.6l-5.2 2.8 1-5.9-4.3-4.1 5.9-.8Z" fill="url(#${a})"/>`,
  key: (a) => `<circle cx="8" cy="15.2" r="4.6" fill="url(#${a})"/><circle cx="8" cy="15.2" r="1.6" fill="#071a33" fill-opacity=".7"/><path d="m11.2 12 8-8M16.4 6.8l2.4 2.4M14 9.2l1.8 1.8" stroke="url(#${a})" stroke-width="2.2" stroke-linecap="round"/>`,
  trophy: (a) => `<path d="M7.6 4h8.8v5.4a4.4 4.4 0 0 1-8.8 0V4Z" fill="url(#${a})"/><path d="M7.6 6H4.8a3 3 0 0 0 3.2 4.2M16.4 6h2.8a3 3 0 0 1-3.2 4.2" fill="none" stroke="url(#${a})" stroke-width="1.6"/><rect x="10.6" y="13" width="2.8" height="4" fill="url(#${a})"/><rect x="7.4" y="17" width="9.2" height="3" rx="1.2" fill="url(#${a})"/>`,
  book: (a) => `<path d="M4 5.6A2.6 2.6 0 0 1 6.6 3H20v14.4H6.6A2.6 2.6 0 0 0 4 20Z" fill="url(#${a})"/><path d="M4 20a2.6 2.6 0 0 0 2.6 1.6H20v-4.2" fill="none" stroke="url(#${a})" stroke-width="1.6"/><path d="M8.6 7.4h7.4M8.6 10.6h5" stroke="#071a33" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round"/>`,
  globe: (a) => `<circle cx="12" cy="12" r="9" fill="url(#${a})"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9M12 3C9.4 5.6 8.2 8.6 8.2 12s1.2 6.4 3.8 9" fill="none" stroke="#071a33" stroke-opacity=".5" stroke-width="1.4"/>`,
  chat: (a) => `<path d="M12 3.4c5 0 9 3.5 9 7.9s-4 7.9-9 7.9c-1 0-1.9-.1-2.8-.4L5 20.4c-.6.3-1.2-.3-1-.9l.8-2.8A7.4 7.4 0 0 1 3 11.3c0-4.4 4-7.9 9-7.9Z" fill="url(#${a})"/>`,
  bell: (a) => `<path d="M6 9.4a6 6 0 1 1 12 0c0 4.8 2 6.4 2 6.4H4s2-1.6 2-6.4Z" fill="url(#${a})"/><path d="M10 19.2a2 2 0 0 0 4 0" fill="none" stroke="url(#${a})" stroke-width="1.8" stroke-linecap="round"/>`,
  doc: (a) => `<path d="M6.6 3h7.2L19 8.2v11.2a1.6 1.6 0 0 1-1.6 1.6H6.6A1.6 1.6 0 0 1 5 19.4V4.6A1.6 1.6 0 0 1 6.6 3Z" fill="url(#${a})"/><path d="M9 13h6.4M9 16.6h6.4" stroke="#3a2100" stroke-opacity=".6" stroke-width="1.6" stroke-linecap="round"/>`,
};
let glowSeq = 0;
/** Glossy tile icon with a soft colored halo, e.g. glow('wallet', 'green'). */
export function glow(shape, color = 'blue', size = 40) {
  const [c1, c2, halo] = GLOW[color] || GLOW.blue;
  const id = `gw${++glowSeq}`;
  return `<span class="glow-ico" style="--halo:${halo};width:${size}px;height:${size}px"><svg viewBox="0 0 24 24" aria-hidden="true">
    <defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient></defs>
    ${(glowShapes[shape] || glowShapes.ticket)(id)}</svg></span>`;
}
