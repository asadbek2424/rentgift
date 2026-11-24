// Inline SVG icons (stroke = currentColor).
const s = (body, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" ${extra}>${body}</svg>`;

export const icons = {
  gift: s('<rect x="3" y="8" width="18" height="13" rx="2.5"/><path d="M3 12h18M12 8v13"/><path d="M12 8c-1.8-3.6-6-4.2-6-1.6C6 8 9 8 12 8Zm0 0c1.8-3.6 6-4.2 6-1.6C18 8 15 8 12 8Z"/>'),
  key: s('<circle cx="8" cy="15" r="4.5"/><path d="m11.2 11.8 8.3-8.3M16.5 6.5l2.5 2.5M14 9l2 2"/>'),
  book: s('<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5v-15Z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5"/><path d="M9 7.5h7M9 11h5"/>'),
  user: s('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7"/>'),
  shield: s('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6L12 3Z"/><path d="m9 12 2 2 4-4"/>'),
  globe: s('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9S14.6 18.4 12 21M12 3C9.4 5.6 8.2 8.6 8.2 12s1.2 6.4 3.8 9"/>'),
  chevronRight: s('<path d="m9 6 6 6-6 6"/>'),
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
  giftBox: `<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg">
    <defs><linearGradient id="gb1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5aa8ff"/><stop offset="1" stop-color="#7a5cf0"/></linearGradient>
    <linearGradient id="gb2" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffd85a"/><stop offset="1" stop-color="#ffab2e"/></linearGradient></defs>
    <rect x="22" y="48" width="76" height="56" rx="12" fill="url(#gb1)"/>
    <rect x="16" y="36" width="88" height="20" rx="9" fill="#8fc3ff"/>
    <rect x="53" y="36" width="14" height="68" fill="url(#gb2)"/>
    <path d="M60 36c-6-14-26-16-26-5 0 7 12 6 26 5Zm0 0c6-14 26-16 26-5 0 7-12 6-26 5Z" fill="url(#gb2)"/>
    <g fill="#ffd85a"><path d="M14 20l2.4 5 5 2.4-5 2.4-2.4 5-2.4-5-5-2.4 5-2.4z"/><path d="M104 14l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z"/></g>
    <circle cx="100" cy="40" r="2.5" fill="#9aa6c0"/><circle cx="24" cy="110" r="2" fill="#9aa6c0"/></svg>`,
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
