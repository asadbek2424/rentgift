// Loads /locales/<lang>.json (shared with the bot).
let dict = {};
let fallback = {};
export let lang = 'uz';

const lookup = (obj, key) => key.split('.').reduce((node, part) => (node && typeof node === 'object' ? node[part] : undefined), obj);

export async function loadLang(code) {
  lang = ['uz', 'ru', 'en'].includes(code) ? code : 'uz';
  const [main, en] = await Promise.all([
    fetch(`/locales/${lang}.json`).then(r => r.json()),
    lang === 'en' ? null : fetch('/locales/en.json').then(r => r.json()).catch(() => ({})),
  ]);
  dict = main;
  fallback = en || main;
  document.documentElement.lang = lang;
}

export function t(key, params = {}) {
  let text = lookup(dict, key) ?? lookup(fallback, key) ?? key;
  for (const [k, v] of Object.entries(params)) text = text.replaceAll(`{${k}}`, v);
  return text;
}

export const locale = () => ({ uz: 'uz-UZ', ru: 'ru-RU', en: 'en-GB' })[lang];

export function money(value) {
  if (value === null || value === undefined) return '—';
  return `${Number(value).toLocaleString('ru-RU').replace(/,/g, ' ')} ${t('common.sum')}`;
}

export function duration(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  const parts = [];
  if (d) parts.push(t('time.d', { n: d }));
  if (h) parts.push(t('time.h', { n: h }));
  if (m && !d) parts.push(t('time.m', { n: m }));
  return parts.join(' ') || t('time.lt_minute');
}

export function clock(seconds) {
  seconds = Math.max(0, Math.floor(seconds));
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function dateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(locale(), { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
