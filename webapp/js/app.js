import { api, ApiError } from './api.js';
import { art, icons, placeholder } from './icons.js';
import { clock, dateTime, duration, lang, loadLang, money, t } from './i18n.js';

const tg = window.Telegram?.WebApp;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const haptic = (type = 'light') => { try { tg?.HapticFeedback?.impactOccurred(type); } catch { /* not in Telegram */ } };
const FINAL = new Set(['expired', 'cancelled', 'refunded', 'failed', 'extended']);

const state = {
  me: null, tab: 'catalog', segment: 'all', sort: 'recently_touch', category: 'gift', q: '', starsSeg: 'stars',
  filters: { collections: [], model: '', backdrop: '', symbol: '', price_min: '', price_max: '', num_min: '', num_max: '' },
  gifts: [], cursor: null, giftsLoaded: false, giftsError: false, collections: null,
  view: null, orders: null, timers: [], poll: null,
};

// ------------------------------------------------------------------ utilities
export function toast(text, error = false) {
  const el = $('#toast');
  el.textContent = text;
  el.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.className = 'toast' + (error ? ' error' : ''); }, 2600);
  if (error) { try { tg?.HapticFeedback?.notificationOccurred('error'); } catch { /* noop */ } }
}

export const errText = e => t(`error.${e instanceof ApiError ? e.code : 'generic'}`);

export function giftImage(url, name) {
  const urls = (Array.isArray(url) ? url : [url]).filter(Boolean);
  if (!urls.length) return placeholder(name);
  return `<img src="${esc(urls[0])}" alt="" loading="lazy" referrerpolicy="no-referrer" data-ph="${esc(name)}" data-alts="${esc(urls.slice(1).join('|'))}">`;
}

// Try the next candidate URL, then fall back to a generated placeholder.
document.addEventListener('error', ev => {
  const img = ev.target;
  if (img.tagName !== 'IMG' || img.dataset.ph === undefined) return;
  const alts = (img.dataset.alts || '').split('|').filter(Boolean);
  if (alts.length) { img.dataset.alts = alts.slice(1).join('|'); img.src = alts[0]; return; }
  img.outerHTML = placeholder(img.dataset.ph);
}, true);

async function copy(text) {
  try { await navigator.clipboard.writeText(text); } catch {
    const area = document.createElement('textarea'); area.value = text; document.body.append(area); area.select();
    document.execCommand('copy'); area.remove();
  }
  haptic(); toast(t('common.copied'));
}

function openLink(url) { if (tg?.openLink) tg.openLink(url); else window.open(url, '_blank', 'noopener'); }
function openTg(username) { const url = `https://t.me/${username}`; if (tg?.openTelegramLink) tg.openTelegramLink(url); else openLink(url); }

function statusBadge(status) {
  const color = { active: 'green', awaiting_link: 'blue', connecting: 'blue', connect_signing: 'blue', renting: 'blue', paid: 'blue',
    awaiting_payment: 'orange', payment_review: 'orange', failed: 'red', cancelled: '', expired: '', refunded: '', extended: 'green' }[status] || '';
  return `<span class="badge ${color}">${esc(t(`status.${status}`))}</span>`;
}

function clearTimers() {
  state.timers.forEach(clearInterval); state.timers = [];
  clearInterval(state.poll); state.poll = null;
}

// ------------------------------------------------------------------ sheets
let sheetStack = [];
export function openSheet(html, mount) {
  const root = $('#sheet-root');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="sheet" role="dialog"><button class="sheet-close" aria-label="close">${icons.close}</button>${html}</div>`;
  const close = () => { overlay.remove(); sheetStack = sheetStack.filter(c => c !== close); syncBackButton(); };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  $('.sheet-close', overlay).onclick = close;
  root.append(overlay);
  sheetStack.push(close);
  syncBackButton();
  mount?.($('.sheet', overlay), close);
  return close;
}

function syncBackButton() {
  if (!tg?.BackButton) return;
  if (sheetStack.length || state.view) tg.BackButton.show(); else tg.BackButton.hide();
}

function goBack() {
  if (sheetStack.length) { sheetStack[sheetStack.length - 1](); return; }
  if (state.view) { state.view = null; render(); }
}

// ------------------------------------------------------------------ chrome
function avatarHtml(user) {
  if (user?.photo_url) return `<div class="avatar"><img src="${esc(user.photo_url)}" alt=""></div>`;
  const initials = ((user?.first_name || '?')[0] + ((user?.last_name || '')[0] || '')).toUpperCase();
  return `<div class="avatar">${esc(initials.trim() || '?')}</div>`;
}

function renderTopbar() {
  const bar = $('#topbar');
  const user = state.me?.user;
  let center = '';
  if (state.view?.name === 'order') center = `<div class="topbar-title">${esc(t('order.title', { id: state.view.id }))}</div>`;
  else if (state.view) center = `<div class="topbar-title">${esc(t(`nav.${state.view.name}`))}</div>`;
  else if (state.tab === 'stars') center = `<div class="segmented">
      <button data-sseg="stars" class="${state.starsSeg === 'stars' ? 'active' : ''}">${esc(t('stars.seg_stars'))}</button>
      <button data-sseg="premium" class="${state.starsSeg === 'premium' ? 'active' : ''}">${esc(t('stars.seg_premium'))}</button></div>`;
  else if (state.tab === 'catalog' && state.category !== 'gift') center = `<div class="topbar-title">${esc(t(`cat.${state.category}_one`))}</div>`;
  else if (state.tab === 'catalog') center = `<div class="segmented">
      <button data-seg="all" class="${state.segment === 'all' ? 'active' : ''}">${esc(t('catalog.segment_all'))}</button>
      <button data-seg="collections" class="${state.segment === 'collections' ? 'active' : ''}">${esc(t('catalog.segment_collections'))}</button></div>`;
  else center = `<div class="topbar-title">${esc(t(`nav.${state.tab}`))}</div>`;
  const left = state.view
    ? `<button class="icon-btn" id="tb-back" aria-label="back">${icons.chevronLeft}</button>`
    : `<button class="avatar-pill" id="tb-profile">${avatarHtml(user)}${icons.chevronRight}</button>`;
  const bal = user ? `<button class="bal-pill" id="tb-bal"><span class="dot"></span>${esc(Number(user.balance_uzs || 0).toLocaleString('ru-RU'))}<i>${icons.plus}</i></button>` : '';
  const langBtn = bal ? '' : `<button class="icon-btn" id="tb-lang" aria-label="language">${icons.globe}</button>`;
  bar.innerHTML = `<div class="left">${left}</div>${center}<div class="right">${bal}${langBtn}</div>`;
  $('#tb-profile', bar)?.addEventListener('click', () => switchTab('profile'));
  $('#tb-bal', bar)?.addEventListener('click', () => openView('balance'));
  bar.querySelectorAll('[data-sseg]').forEach(b => b.onclick = () => { state.starsSeg = b.dataset.sseg; haptic(); render(); });
  $('#tb-back', bar)?.addEventListener('click', goBack);
  $('#tb-lang', bar)?.addEventListener('click', langSheet);
  bar.querySelectorAll('[data-seg]').forEach(b => b.onclick = () => { state.segment = b.dataset.seg; haptic(); render(); });
}

function renderTabbar() {
  const tabs = [['catalog', icons.gift], ['rentals', icons.key], ['stars', icons.star], ['profile', icons.user]];
  if (state.me?.user?.is_admin) tabs.push(['admin', icons.shield]);
  const bar = $('#tabbar');
  bar.innerHTML = tabs.map(([id, icon]) =>
    `<button class="tab ${state.tab === id && !state.view ? 'active' : ''}" data-tab="${id}">${icon}<span>${esc(t(`nav.${id}`))}</span></button>`).join('');
  bar.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
}

function switchTab(tab) {
  haptic();
  state.tab = tab; state.view = null;
  render();
  window.scrollTo({ top: 0 });
}

export function openView(name, extra = {}) {
  haptic();
  state.view = { name, ...extra };
  render();
  window.scrollTo({ top: 0 });
}

const helpers = () => ({ state, render, renderTopbar, openSheet, toast, errText, esc, giftImage, statusBadge, copy, haptic,
  openView, switchTab, openTg, openLink });

export function openOrder(id) {
  state.view = { name: 'order', id: Number(id) };
  render();
  window.scrollTo({ top: 0 });
}

export async function render() {
  clearTimers();
  renderTopbar();
  renderTabbar();
  syncBackButton();
  const view = $('#view');
  if (state.view?.name === 'order') return orderView(view, state.view.id);
  if (state.view?.name === 'guide') return guideView(view);
  if (state.view) {
    const mod = await import('./wallet.js');
    const fn = { balance: mod.balanceView, topup: mod.topupView, referral: mod.referralView, top: mod.topView }[state.view.name];
    if (fn) return fn(view, helpers(), state.view.id);
  }
  if (state.tab === 'stars') return (await import('./wallet.js')).starsView(view, helpers());
  if (state.tab === 'catalog' && state.category !== 'gift') return otherCatalogView(view);
  if (state.tab === 'catalog') return state.segment === 'all' ? catalogView(view) : collectionsView(view);
  if (state.tab === 'rentals') return rentalsView(view);
  if (state.tab === 'guide') return guideView(view);
  if (state.tab === 'profile') return profileView(view);
  if (state.tab === 'admin') {
    const mod = await import('./admin.js');
    return mod.adminView(view, helpers());
  }
}

// ------------------------------------------------------------------ catalog
function banner() {
  return `<button class="banner" id="banner">
    <svg class="spark" style="right:84px;top:10px;width:14px" viewBox="0 0 10 10"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="#fff"/></svg>
    <svg class="spark" style="right:18px;bottom:8px;width:10px" viewBox="0 0 10 10"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="#fff"/></svg>
    <div><b>${esc(t('banner.title'))}</b><span>${esc(t('banner.subtitle'))} ›</span></div>
    <div class="banner-art">${art.card}</div></button>`;
}

function categoryTabs() {
  return `<div class="cat-tabs">${['gift', 'username', 'number'].map(c =>
    `<button class="${state.category === c ? 'active' : ''}" data-cat="${c}">${esc(t(`cat.${c}`))}</button>`).join('')}</div>`;
}

function bindCategoryTabs(view) {
  view.querySelectorAll('[data-cat]').forEach(b => b.onclick = () => {
    if (state.category === b.dataset.cat) return;
    state.category = b.dataset.cat; state.q = ''; state.other = null; haptic(); render();
  });
}

function nameTile(g) {
  const isNum = g.category === 'number';
  let h = 0;
  for (const c of g.name || '') h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = isNum ? 150 + (h % 60) : 200 + (h % 80);
  return `<div class="name-tile ${isNum ? 'num' : ''}" style="background:linear-gradient(140deg,hsl(${hue} 70% 48%),hsl(${(hue + 40) % 360} 70% 30%))">
    ${isNum ? `<span class="tile-icon">${icons.phone}</span>` : ''}<b>${esc(g.name)}</b></div>`;
}

function otherCard(g) {
  return `<button class="gift-card" data-gift="${esc(g.address)}">
    <div class="gift-img">${nameTile(g)}</div>
    <div class="gift-meta"><div class="gift-name">${esc(g.name)}</div>
      <div class="gift-sub">${esc(t(`cat.${g.category}_one`))} · ${esc(t('catalog.days_range', { min: g.min_days, max: g.max_days }))}</div>
      <div class="gift-price"><b>${g.per_day_uzs != null ? money(g.per_day_uzs) : esc(g.price_per_day_ton) + ' TON'}</b><span>${esc(t('catalog.per_day'))}</span></div></div>
  </button>`;
}

async function loadOther(reset) {
  const o = state.other || (state.other = { items: [], cursor: null, loaded: false, error: false });
  if (reset) { o.items = []; o.cursor = null; o.loaded = false; }
  o.error = false;
  try {
    const page = await api.gifts({ category: state.category, sort: state.sort, q: state.q, cursor: reset ? null : o.cursor });
    o.items = reset ? page.items : o.items.concat(page.items);
    o.cursor = page.cursor;
  } catch { o.error = true; }
  o.loaded = true;
}

async function otherCatalogView(view) {
  const cat = state.category;
  const draw = () => {
    if (state.tab !== 'catalog' || state.category !== cat || state.view) return;
    const o = state.other;
    let body;
    if (!o?.loaded) body = `<div class="grid">${'<div class="skeleton" style="aspect-ratio:.78"></div>'.repeat(6)}</div>`;
    else if (o.error && !o.items.length) body = `<div class="empty"><p>${esc(t('catalog.error'))}</p><button class="btn secondary small" id="retry">${esc(t('common.retry'))}</button></div>`;
    else if (!o.items.length) body = `<div class="empty"><div class="hero-art">${art.giftBox}</div>${esc(t(state.q ? 'catalog.no_results' : 'catalog.empty'))}</div>`;
    else body = `<div class="grid">${o.items.map(otherCard).join('')}</div>`
      + (o.cursor ? `<button class="btn secondary mt2" id="more">${esc(t('catalog.load_more'))}</button>` : '');
    view.innerHTML = categoryTabs() + `<div class="toolbar"><div class="search grow-search">${icons.search}<input id="q" placeholder="${esc(t('catalog.search_name'))}" value="${esc(state.q)}"></div>
      <button class="tool icon-only" id="open-sort" aria-label="${esc(t('catalog.sort_btn'))}">${icons.sort}</button></div>
      <p class="note" style="margin-top:-4px">${esc(t('catalog.other_hint'))}</p>` + body;
    bindCategoryTabs(view);
    $('#open-sort', view).onclick = sortSheet;
    const q = $('#q', view);
    let timer;
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { state.q = q.value.trim(); state.other.loaded = false; await loadOther(true); draw(); const n = $('#q', view); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 500); };
    $('#retry', view)?.addEventListener('click', async () => { state.other.loaded = false; draw(); await loadOther(true); draw(); });
    $('#more', view)?.addEventListener('click', async e => { e.target.disabled = true; await loadOther(false); draw(); });
    view.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => {
      const g = state.other.items.find(x => x.address === b.dataset.gift); if (g) giftSheet(g);
    });
  };
  draw();
  if (!state.other?.loaded) { await loadOther(true); draw(); }
}

function giftCard(g) {
  const sub = [g.model, g.backdrop].filter(Boolean).join(' · ');
  return `<button class="gift-card" data-gift="${esc(g.address)}">
    <div class="gift-img">${giftImage(g.image, g.name)}${g.number ? `<span class="gift-num">#${esc(g.number)}</span>` : ''}</div>
    <div class="gift-meta"><div class="gift-name">${esc(g.collection || g.name)}</div>
      <div class="gift-sub">${esc(sub || t('catalog.days_range', { min: g.min_days, max: g.max_days }))}</div>
      <div class="gift-price"><b>${g.per_day_uzs != null ? money(g.per_day_uzs) : esc(g.price_per_day_ton) + ' TON'}</b><span>${esc(t('catalog.per_day'))}</span></div></div>
  </button>`;
}

function filterParams() {
  const f = state.filters;
  return { sort: state.sort, collections: f.collections.map(c => c.address).join(','), model: f.model, backdrop: f.backdrop,
    symbol: f.symbol, price_min: f.price_min, price_max: f.price_max, num_min: f.num_min, num_max: f.num_max };
}

function filterCount() {
  const f = state.filters;
  return ['model', 'backdrop', 'symbol'].filter(k => f[k]).length + (f.price_min || f.price_max ? 1 : 0) + (f.num_min || f.num_max ? 1 : 0);
}

async function loadGifts(reset) {
  if (reset) { state.gifts = []; state.cursor = null; state.giftsLoaded = false; }
  state.giftsError = false;
  try {
    const page = await api.gifts({ ...filterParams(), cursor: reset ? null : state.cursor });
    state.gifts = reset ? page.items : state.gifts.concat(page.items);
    state.cursor = page.cursor;
  } catch { state.giftsError = true; }
  state.giftsLoaded = true;
}

const SORTS = [['recently_touch', 'catalog.sort_new'], ['price_per_day', 'catalog.sort_cheap'],
  ['item_num_asc', 'catalog.sort_number'], ['item_num_desc', 'catalog.sort_number_desc']];

async function applyFilters() {
  state.giftsLoaded = false; state.segment = 'all';
  if (state.tab === 'catalog' && !state.view) render();
  await loadGifts(true);
  if (state.tab === 'catalog' && state.segment === 'all' && !state.view) render();
}

function activeChips() {
  const f = state.filters, chips = [];
  f.collections.forEach(c => chips.push([`col:${c.address}`, c.name]));
  if (f.model) chips.push(['model', `${t('gift.model')}: ${f.model}`]);
  if (f.backdrop) chips.push(['backdrop', `${t('gift.backdrop')}: ${f.backdrop}`]);
  if (f.symbol) chips.push(['symbol', `${t('gift.symbol')}: ${f.symbol}`]);
  if (f.price_min || f.price_max) chips.push(['price', `${f.price_min || 0} – ${f.price_max || '∞'} ${t('common.sum')}`]);
  if (f.num_min || f.num_max) chips.push(['num', `#${f.num_min || 1} – ${f.num_max || '∞'}`]);
  return chips;
}

function removeChip(key) {
  const f = state.filters;
  if (key.startsWith('col:')) {
    f.collections = f.collections.filter(c => c.address !== key.slice(4));
    if (f.collections.length !== 1) f.model = '';
  } else if (key === 'price') { f.price_min = ''; f.price_max = ''; }
  else if (key === 'num') { f.num_min = ''; f.num_max = ''; }
  else f[key] = '';
  applyFilters();
}

async function catalogView(view) {
  const draw = () => {
    if (state.tab !== 'catalog' || state.segment !== 'all' || state.view) return;
    const nCol = state.filters.collections.length, nFil = filterCount();
    const sortLabel = t((SORTS.find(([v]) => v === state.sort) || SORTS[0])[1]);
    const toolbar = `<div class="toolbar">
      <button class="tool ${nCol ? 'on' : ''}" id="open-cols">${esc(t('catalog.collections_btn'))}${nCol ? ` <i>${nCol}</i>` : ''} ${icons.layers}</button>
      <button class="tool ${nFil ? 'on' : ''}" id="open-filters">${esc(t('catalog.filters_btn'))}${nFil ? ` <i>${nFil}</i>` : ''} ${icons.sliders}</button>
      <button class="tool icon-only" id="open-sort" aria-label="${esc(t('catalog.sort_btn'))}" title="${esc(sortLabel)}">${icons.sort}</button></div>`;
    const chips = activeChips();
    const chipRow = chips.length ? `<div class="chips">${chips.map(([k, label]) =>
      `<button class="chip active" data-rm="${esc(k)}">${esc(label)} ${icons.x}</button>`).join('')}</div>` : '';
    let body;
    if (!state.giftsLoaded) body = `<div class="grid">${'<div class="skeleton" style="aspect-ratio:.78"></div>'.repeat(6)}</div>`;
    else if (state.giftsError && !state.gifts.length) body = `<div class="empty"><p>${esc(t('catalog.error'))}</p><button class="btn secondary small" id="retry">${esc(t('common.retry'))}</button></div>`;
    else if (!state.gifts.length) body = `<div class="empty"><div class="hero-art">${art.giftBox}</div>${esc(t(chips.length ? 'catalog.no_results' : 'catalog.empty'))}</div>`;
    else body = `<div class="grid">${state.gifts.map(giftCard).join('')}</div>`
      + (state.cursor ? `<button class="btn secondary mt2" id="more">${esc(t('catalog.load_more'))}</button>` : '');
    view.innerHTML = categoryTabs() + banner() + toolbar + chipRow + body;
    bindCategoryTabs(view);
    $('#banner', view).onclick = () => openView('guide');
    $('#open-cols', view).onclick = collectionsSheet;
    $('#open-filters', view).onclick = filtersSheet;
    $('#open-sort', view).onclick = sortSheet;
    view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeChip(b.dataset.rm));
    $('#retry', view)?.addEventListener('click', async () => { state.giftsLoaded = false; draw(); await loadGifts(true); draw(); });
    $('#more', view)?.addEventListener('click', async e => { e.target.disabled = true; await loadGifts(false); draw(); });
    view.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => {
      const g = state.gifts.find(x => x.address === b.dataset.gift); if (g) giftSheet(g);
    });
  };
  draw();
  if (!state.giftsLoaded) { await loadGifts(true); draw(); }
}

async function ensureCollections() {
  if (!state.collections) state.collections = (await api.collections()).items;
  return state.collections;
}

function collectionRow(c, checkbox, checked) {
  const floor = c.floor_uzs != null ? `${esc(t('catalog.rent_floor'))}: <b>${money(c.floor_uzs)}</b>` : (c.floor_ton ? `${esc(t('catalog.rent_floor'))}: ${esc(c.floor_ton)} TON` : '');
  return `<button class="row-card col-row" data-col="${esc(c.address)}">
    ${checkbox ? `<span class="check ${checked ? 'on' : ''}">${icons.check}</span>` : ''}
    <div class="thumb">${giftImage(c.images, c.name)}</div>
    <div class="grow"><div class="title">${esc(c.name)}</div><div class="sub">${floor}</div></div>
    ${c.for_rent != null ? `<div class="right-num"><b>${Number(c.for_rent).toLocaleString('ru-RU')}</b><span>${esc(t('catalog.for_rent'))}</span></div>`
      : c.items ? `<div class="right-num"><b>${Number(c.items).toLocaleString('ru-RU')}</b><span>${esc(t('catalog.available'))}</span></div>` : `<span class="chev">${icons.chevronRight}</span>`}
  </button>`;
}

async function collectionsView(view) {
  view.innerHTML = banner() + `<div class="list">${'<div class="skeleton" style="height:78px"></div>'.repeat(6)}</div>`;
  $('#banner', view).onclick = () => openView('guide');
  try { await ensureCollections(); } catch { view.innerHTML = banner() + `<div class="empty">${esc(t('catalog.error'))}</div>`; return; }
  if (state.tab !== 'catalog' || state.segment !== 'collections') return;
  view.innerHTML = banner() + `<div class="list">${state.collections.map(c => collectionRow(c, false)).join('')}</div>`;
  $('#banner', view).onclick = () => openView('guide');
  view.querySelectorAll('[data-col]').forEach(b => b.onclick = () => {
    const c = state.collections.find(x => x.address === b.dataset.col);
    state.filters.collections = [{ address: c.address, name: c.name }]; state.filters.model = ''; haptic(); applyFilters();
  });
}

function collectionsSheet() {
  const picked = new Map(state.filters.collections.map(c => [c.address, c]));
  const html = `<h3 class="left-title">${esc(t('catalog.collections_btn'))}</h3>
    <div class="search">${icons.search}<input id="col-q" placeholder="${esc(t('catalog.search_collection'))}"></div>
    <div class="list" id="col-list"><div class="skeleton" style="height:70px"></div></div>
    <div class="sheet-footer"><button class="btn secondary" id="col-reset">${esc(t('catalog.reset'))}</button><button class="btn" id="col-apply">${esc(t('catalog.apply'))}</button></div>`;
  openSheet(html, async (sheet, close) => {
    const list = $('#col-list', sheet);
    try { await ensureCollections(); } catch { list.innerHTML = `<div class="empty">${esc(t('catalog.error'))}</div>`; return; }
    const draw = () => {
      const q = $('#col-q', sheet).value.trim().toLowerCase();
      const items = state.collections.filter(c => !q || (c.name || '').toLowerCase().includes(q));
      list.innerHTML = items.map(c => collectionRow(c, true, picked.has(c.address))).join('') || `<div class="empty">—</div>`;
      list.querySelectorAll('[data-col]').forEach(b => b.onclick = () => {
        const c = state.collections.find(x => x.address === b.dataset.col);
        if (picked.has(c.address)) picked.delete(c.address);
        else if (picked.size >= 5) { toast(t('catalog.max_collections'), true); return; }
        else picked.set(c.address, { address: c.address, name: c.name });
        haptic(); b.querySelector('.check').classList.toggle('on', picked.has(c.address));
      });
    };
    $('#col-q', sheet).oninput = draw;
    draw();
    $('#col-reset', sheet).onclick = () => { picked.clear(); draw(); };
    $('#col-apply', sheet).onclick = () => {
      state.filters.collections = [...picked.values()];
      if (state.filters.collections.length !== 1) state.filters.model = '';
      close(); applyFilters();
    };
  });
}

function filtersSheet() {
  const f = { ...state.filters };
  const one = f.collections.length === 1 ? f.collections[0].address : '';
  const html = `<h3 class="left-title">${esc(t('catalog.filters_btn'))}</h3>
    <div class="f-title">${esc(t('catalog.price'))}</div>
    <div class="pair"><input class="input" id="p-min" inputmode="numeric" placeholder="${esc(t('catalog.from'))}" value="${esc(f.price_min)}">
      <input class="input" id="p-max" inputmode="numeric" placeholder="${esc(t('catalog.to'))}" value="${esc(f.price_max)}"></div>
    <div class="f-title">${esc(t('catalog.item_id'))}</div>
    <div class="pair"><input class="input" id="n-min" inputmode="numeric" placeholder="${esc(t('catalog.from'))}" value="${esc(f.num_min)}">
      <input class="input" id="n-max" inputmode="numeric" placeholder="${esc(t('catalog.to'))}" value="${esc(f.num_max)}"></div>
    <div class="f-title">${esc(t('catalog.attributes'))}</div>
    <div class="search">${icons.search}<input id="a-q" placeholder="${esc(t('catalog.search_attr'))}"></div>
    ${one ? '' : `<p class="note" style="margin-top:0">${esc(t('catalog.model_hint'))}</p>`}
    <div id="attr-groups"><div class="skeleton" style="height:56px"></div></div>
    <div class="sheet-footer"><button class="btn secondary" id="f-reset">${esc(t('catalog.reset'))}</button><button class="btn" id="f-apply">${esc(t('catalog.apply'))}</button></div>`;
  openSheet(html, async (sheet, close) => {
    const box = $('#attr-groups', sheet);
    let groups = [];
    const open = new Set();
    const draw = () => {
      const q = $('#a-q', sheet).value.trim().toLowerCase();
      box.innerHTML = groups.map(g => {
        const values = g.values.filter(v => !q || v.value.toLowerCase().includes(q));
        const expanded = open.has(g.trait) || (q && values.length);
        const label = t(`gift.${g.trait}`);
        return `<div class="acc"><button class="acc-head" data-acc="${g.trait}"><b>${esc(label)}${f[g.trait] ? ` · <span class="accent">${esc(f[g.trait])}</span>` : ''}</b>
          <span class="muted">${g.values.length} ${expanded ? '▴' : '▾'}</span></button>
          ${expanded ? `<div class="acc-body">${values.slice(0, 200).map(v => `<button class="opt ${f[g.trait] === v.value ? 'on' : ''}" data-trait="${g.trait}" data-val="${esc(v.value)}">
            <span class="radio"></span><span class="grow">${esc(v.value)}</span><span class="muted">${v.count || ''}</span></button>`).join('')}</div>` : ''}</div>`;
      }).join('');
      box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { open.has(b.dataset.acc) ? open.delete(b.dataset.acc) : open.add(b.dataset.acc); draw(); });
      box.querySelectorAll('[data-trait]').forEach(b => b.onclick = () => {
        const { trait, val } = b.dataset; f[trait] = f[trait] === val ? '' : val; haptic(); draw();
      });
    };
    $('#a-q', sheet).oninput = draw;
    try { groups = (await api.attributes(one)).attributes; } catch { box.innerHTML = `<p class="note">${esc(t('catalog.error'))}</p>`; }
    if (groups.length) draw();
    const num = id => $(id, sheet).value.replace(/[^\d]/g, '');
    $('#f-reset', sheet).onclick = () => {
      Object.assign(state.filters, { model: '', backdrop: '', symbol: '', price_min: '', price_max: '', num_min: '', num_max: '' });
      close(); applyFilters();
    };
    $('#f-apply', sheet).onclick = () => {
      Object.assign(state.filters, { model: f.model, backdrop: f.backdrop, symbol: f.symbol,
        price_min: num('#p-min'), price_max: num('#p-max'), num_min: num('#n-min'), num_max: num('#n-max') });
      close(); applyFilters();
    };
  });
}

function sortSheet() {
  const html = `<h3>${esc(t('catalog.sort_btn'))}</h3><div class="mt">${SORTS.map(([v, k]) =>
    `<button class="radio-row ${state.sort === v ? 'active' : ''}" data-sort="${v}"><span class="radio"></span><div><b>${esc(t(k))}</b></div></button>`).join('')}</div>`;
  openSheet(html, (sheet, close) => {
    sheet.querySelectorAll('[data-sort]').forEach(b => b.onclick = () => {
      state.sort = b.dataset.sort; haptic(); close();
      if (state.category !== 'gift') { state.other = null; render(); } else applyFilters();
    });
  });
}

// ------------------------------------------------------------------ price breakdown ("Ijara × kun" + "Xizmat haqi")
function breakdown(perDay, days, fee, total, add = 0) {
  return `<div class="card breakdown" style="padding:6px 16px">
    <div class="kv"><span>${esc(t('price.rent', { per: money(perDay), days }))}</span><b>${money(perDay * days)}</b></div>
    ${fee ? `<div class="kv"><span>${esc(t('price.fee'))}</span><b>${money(fee)}</b></div>` : ''}
    ${add ? `<div class="kv"><span>${esc(t('price.unique'))}</span><b>+${money(add)}</b></div>` : ''}
    <div class="kv"><span><b style="color:var(--text)">${esc(t('price.total'))}</b></span><b style="font-size:17px">${money(total)}</b></div></div>`;
}

// ------------------------------------------------------------------ gift sheet
function giftSheet(g) {
  let days = Math.max(g.min_days, Math.min(g.max_days, 1));
  const attrs = [['gift.model', g.model], ['gift.backdrop', g.backdrop], ['gift.symbol', g.symbol]].filter(([, v]) => v);
  const other = g.category && g.category !== 'gift';
  const html = `
    <div class="gift-hero">${other ? nameTile(g) : giftImage(g.image, g.name)}</div>
    <h3>${esc(g.name)}</h3>
    <div class="attrs">${attrs.map(([k, v]) => `<div class="attr"><span>${esc(t(k))}</span>${esc(v)}</div>`).join('')}</div>
    <div class="card" style="padding:14px">
      <div class="kv"><span>${esc(t('gift.per_day'))}</span><b>${g.per_day_uzs != null ? money(g.per_day_uzs) : '—'}</b></div>
      <div class="kv" style="border:0;padding-bottom:6px"><span>${esc(t('gift.duration'))}</span><b class="muted" style="font-size:13px">${esc(t('gift.limits', { min: g.min_days, max: g.max_days }))}</b></div>
      <div class="stepper"><button id="minus">−</button><div class="val"><b id="days"></b><span>${esc(t('gift.days'))}</span></div><button id="plus">+</button></div>
      <div class="chips mt" id="quick" style="margin-bottom:0"></div>
    </div>
    <div class="mt" id="bd"></div><p class="note center" id="ton" style="margin-top:6px"></p>
    <button class="btn mt" id="rent">${esc(t('gift.rent'))}</button>
    <p class="note center">${esc(other ? t('catalog.other_hint') : t('gift.how'))}</p>`;
  openSheet(html, (sheet, close) => {
    let seq = 0;
    const quick = [1, 3, 7, 14, 30].filter(d => d >= g.min_days && d <= g.max_days);
    const update = async () => {
      $('#days', sheet).textContent = days;
      $('#minus', sheet).disabled = days <= g.min_days;
      $('#plus', sheet).disabled = days >= g.max_days;
      $('#quick', sheet).innerHTML = quick.map(d => `<button class="chip ${d === days ? 'active' : ''}" data-d="${d}">${d} ${esc(t('common.days'))}</button>`).join('');
      sheet.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { days = Number(b.dataset.d); haptic(); update(); });
      if (g.per_day_uzs != null) $('#bd', sheet).innerHTML = breakdown(g.per_day_uzs, days, g.service_fee_uzs || 0, g.per_day_uzs * days + (g.service_fee_uzs || 0));
      const mine = ++seq;
      try {
        const q = await api.quote(g.address, days);
        if (mine !== seq) return;
        $('#bd', sheet).innerHTML = breakdown(q.per_day_uzs, q.days, q.service_fee_uzs || 0, q.amount_uzs);
        $('#ton', sheet).textContent = t('gift.ton_hint', { ton: q.ton_total });
        $('#rent', sheet).textContent = `${t('gift.rent')} — ${money(q.amount_uzs)}`;
        $('#rent', sheet).disabled = false;
      } catch (e) {
        if (mine !== seq) return;
        $('#ton', sheet).textContent = errText(e);
        if (e.code === 'gift_unavailable') $('#rent', sheet).disabled = true;
      }
    };
    $('#minus', sheet).onclick = () => { if (days > g.min_days) { days--; haptic(); update(); } };
    $('#plus', sheet).onclick = () => { if (days < g.max_days) { days++; haptic(); update(); } };
    $('#rent', sheet).onclick = async e => {
      e.target.disabled = true;
      try {
        const order = await api.createOrder(g.address, days);
        haptic('medium'); close(); state.orders = null; openOrder(order.id);
      } catch (err) { toast(errText(err), true); e.target.disabled = false; }
    };
    update();
  });
}

// ------------------------------------------------------------------ order page
const STEP_OF = { awaiting_payment: 0, payment_review: 1, paid: 2, renting: 2, awaiting_link: 3, connecting: 3, connect_signing: 3, active: 4, expired: 5, extended: 5 };

function stepsHtml(status, kind = 'rent') {
  const now = STEP_OF[status];
  if (now === undefined) return '';
  const names = kind === 'extend' ? ['payment', 'review', 'rent'] : ['payment', 'review', 'rent', 'fragment', 'active'];
  if (kind === 'extend' && now >= 5) return `<div class="steps">${names.map((n) => `<div class="step done" style="width:33%"><i>${icons.check.replace('<svg', '<svg width="14" height="14"')}</i>${esc(t(`steps.${n}`))}</div>`).join('')}</div>`;
  return `<div class="steps">${names.map((n, i) => {
    const cls = i < now || now === 5 ? 'done' : i === now ? 'now' : '';
    return `<div class="step ${cls}"><i>${cls === 'done' ? icons.check.replace('<svg', '<svg width="14" height="14"') : i + 1}</i>${esc(t(`steps.${n}`))}</div>`;
  }).join('')}</div>`;
}

function waiting(text) { return `<div class="card"><div class="waiting"><div class="spinner"></div><p>${esc(text)}</p></div></div>`; }

function paymentCard(o) {
  const card = state.me?.card || {};
  const bal = Number(state.me?.user?.balance_uzs || 0), price = o.amount_uzs - (o.unique_add_uzs || 0);
  const balanceBox = `<div class="card pay-balance"><div class="kv" style="padding-top:0"><span>${esc(t('stars.your_balance'))}</span><b>${money(bal)}</b></div>
    ${bal >= price ? `<button class="btn green mt" id="pay-balance">${esc(t('wallet.pay_balance', { amount: money(price) }))}</button>`
      : `<p class="note warn">${esc(t('wallet.low', { amount: money(bal) }))}</p><button class="btn secondary" id="go-topup">${esc(t('wallet.topup'))}</button>`}
    ${bal >= price ? '' : `<div class="or-line"><span>${esc(t('wallet.or_card'))}</span></div>`}</div>`;
  if (!card.number) return balanceBox + `<div class="card"><p class="note warn" style="margin:0">${esc(t('pay.no_card'))}</p></div>`;
  const wrap = html => (bal >= price ? `<details class="alt-way mt"><summary>${esc(t('wallet.or_card'))}</summary>${html}</details>` : html);
  return balanceBox + wrap(`<div class="card">
    <div class="timer-label">${esc(t('pay.time_left'))}</div>
    <div class="timer" data-until="${esc(o.payment_expires_at)}">--:--</div>
    <div class="section-title" style="margin-top:12px">${esc(t('pay.title'))}</div>
    <div class="copy-line"><div><div class="label">${esc(t('pay.amount'))}</div><div class="value">${money(o.amount_uzs)}</div></div>
      <button class="copy-btn" data-copy="${o.amount_uzs}">${esc(t('common.copy'))}</button></div>
    <div class="copy-line"><div><div class="label">${esc(t('pay.card'))}</div><div class="value">${esc(card.number)}</div></div>
      <button class="copy-btn" data-copy="${esc(card.number.replace(/\s/g, ''))}">${esc(t('common.copy'))}</button></div>
    ${card.holder ? `<div class="kv mt"><span>${esc(t('pay.holder'))}</span><b>${esc(card.holder)}</b></div>` : ''}
    ${card.bank ? `<div class="kv"><span>${esc(t('pay.bank'))}</span><b>${esc(card.bank)}</b></div>` : ''}
    <p class="note ${o.unique_add_uzs ? 'warn' : ''}">${esc(o.unique_add_uzs ? t('pay.unique', { add: o.unique_add_uzs }) : t('pay.exact'))}</p>
    ${state.me?.app?.auto_payments ? `<p class="note" style="color:#6fe39a">🤖 ${esc(t('pay.auto'))}</p>` : ''}
    <div class="waiting"><div class="spinner"></div><p>${esc(t('wallet.waiting'))}</p></div></div>`)
    + `<button class="btn ghost mt" id="cancel">${esc(t('pay.cancel'))}</button>`;
}

function linkCard(o, relink = false) {
  return `<div class="card">
    <h3 style="margin:0 0 6px;font-size:18px">${esc(t(relink ? 'active.relink' : 'link.title'))}</h3>
    ${[1, 2, 3, 4].map(n => `<div class="instruction"><div class="n">${n}</div><p>${esc(t(`link.step${n}`))}</p></div>`).join('')}
    <button class="btn secondary mt" id="open-fragment">${icons.link.replace('<svg', '<svg width="18" height="18"')} ${esc(t('link.open_fragment'))}</button>
    <textarea class="input mt" id="tc-url" rows="3" placeholder="${esc(t('link.placeholder'))}"></textarea>
    <button class="btn mt" id="send-link">${esc(t('link.send'))}</button>
    <p class="note warn">${esc(t('link.note'))}</p></div>`;
}

function numberCard(o) {
  return `<div class="card"><h3 style="margin:0 0 8px">${esc(t('number.title'))}</h3>
    <div class="copy-line"><div><div class="label">${esc(t('cat.number_one'))}</div><div class="value">${esc(o.nft_name)}</div></div>
      <button class="copy-btn" data-copy="${esc(o.nft_name.replace(/\s/g, ''))}">${esc(t('common.copy'))}</button></div>
    <p class="note">${esc(t('number.text'))}</p>
    <div id="code-box"></div>
    <button class="btn mt" id="get-code">${icons.phone.replace('<svg', '<svg width="18" height="18"')} ${esc(t('number.get'))}</button></div>`;
}

function tgCard(o, again = false) {
  const name = state.me?.user?.tg_display_name;
  return `<div class="card">
    <h3 style="margin:0 0 6px;font-size:18px">${esc(t(again ? 'tgc.again' : 'tgc.title'))}</h3>
    ${again ? '' : `<p class="note" style="margin-top:0">${esc(t('tgc.text'))}</p>`}
    ${name ? `<p class="note accent">${esc(t('tgc.connected_as', { name }))}</p>` : ''}
    <div id="tg-box"><button class="btn mt" id="tg-start">${icons.telegram.replace('<svg', '<svg width="19" height="19"')} ${esc(t(again ? 'tgc.again' : 'tgc.btn'))}</button></div>
  </div>`;
}

function bindTg(view, o) {
  const box = $('#tg-box', view);
  if (!box) return;
  let link = null, started = Date.now(), timer = null, busy = false;
  const stop = () => { clearInterval(timer); state.timers = state.timers.filter(x => x !== timer); };
  const done = async () => {
    stop(); haptic('medium');
    try { state.me = await api.me(); } catch { /* keep old profile */ }
    toast(t('tgc.displayed', { account: state.me?.user?.tg_display_name || 'Telegram' }));
    render();
  };
  const waitingUi = (status) => {
    box.innerHTML = `<div class="waiting mt"><div class="spinner"></div><p id="tg-msg">${esc(t(status === 'consumed' ? 'tgc.consumed' : status === 'refresh' ? 'tgc.refresh' : 'tgc.waiting'))}</p></div>
      <button class="btn mt" id="tg-open">${icons.telegram.replace('<svg', '<svg width="19" height="19"')} ${esc(t('tgc.open'))}</button>
      <button class="btn secondary mt" id="tg-copy">${esc(t('tgc.copy_link'))}</button>
      <p class="note center">${esc(t('tgc.android'))}</p>`;
    $('#tg-open', box).onclick = () => link && (tg?.openTelegramLink ? tg.openTelegramLink(link) : openLink(link));
    $('#tg-copy', box).onclick = () => link && copy(link);
  };
  const handle = res => {
    if (res.status === 'displayed') return done(res);
    if (res.link) link = res.link;
    if (!$('#tg-msg', box)) waitingUi(res.status); else $('#tg-msg', box).textContent = t(res.status === 'consumed' ? 'tgc.consumed' : res.status === 'refresh' ? 'tgc.refresh' : 'tgc.waiting');
  };
  $('#tg-start', box).onclick = async e => {
    e.target.disabled = true;
    try {
      const res = await api.tgConnect(o.id);
      handle(res);
      if (res.status === 'displayed') return;
      if (link) (tg?.openTelegramLink ? tg.openTelegramLink(link) : openLink(link));
      started = Date.now();
      timer = setInterval(async () => {
        if (document.hidden || busy) return;
        if (Date.now() - started > 15 * 60 * 1000) { stop(); toast(t('tgc.timeout'), true); render(); return; }
        busy = true;
        try { handle(await api.tgStatus(o.id)); } catch (err) { stop(); toast(errText(err), true); render(); }
        busy = false;
      }, 2500);
      state.timers.push(timer);
    } catch (err) { toast(errText(err), true); e.target.disabled = false; }
  };
}

async function orderView(view, id) {
  view.innerHTML = `<div class="skeleton" style="height:120px"></div><div class="skeleton mt" style="height:280px"></div>`;
  let o;
  try { o = await api.order(id); } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.view?.id !== id) return;
  const isGift = (o.category || 'gift') === 'gift';
  const head = `<div class="card"><div class="order-head"><div class="thumb">${isGift ? giftImage(o.image, o.nft_name) : nameTile({ name: o.nft_name, category: o.category })}</div>
      <div><h3>${esc(o.nft_name)}</h3>${o.kind === 'extend' ? `<div class="sub muted" style="margin:-2px 0 6px;font-size:13px">${esc(t('ext.of', { id: o.parent_id }))}</div>` : ''}${statusBadge(o.status)}</div></div>${stepsHtml(o.status, o.kind)}
      <div class="kv mt" style="padding-bottom:4px"><span>${esc(t('order.period'))}</span><b>${o.days} ${esc(t('common.days'))}</b></div></div>
      <div class="mt">${breakdown(o.per_day_uzs, o.days, o.service_fee_uzs || 0, o.amount_uzs, o.unique_add_uzs || 0)}</div>`;
  let body = '';
  switch (o.status) {
    case 'awaiting_payment': body = paymentCard(o); break;
    case 'payment_review': body = waiting(t('review.text')); break;
    case 'paid': case 'renting': body = waiting(t('renting.text')); break;
    case 'awaiting_link': body = isGift ? tgCard(o) + `<details class="alt-way mt"><summary>${esc(t('tgc.alt_title'))}</summary>${linkCard(o)}</details>`
      : `<p class="note">${esc(t('uname.text'))}</p>` + linkCard(o); break;
    case 'connecting': case 'connect_signing': body = waiting(t('connecting.text')); break;
    case 'active': body = `<div class="card"><h3 style="margin:0 0 8px">${esc(t('active.title'))}</h3>
        <div class="timer-label">${esc(t('active.left'))}</div><div class="timer" data-left-until="${esc(o.end_time)}">—</div>
        <div class="kv mt"><span>${esc(t('active.ends'))}</span><b>${esc(dateTime(o.end_time))}</b></div>
        <p class="note">${esc(t('active.hint'))}</p>
        <button class="btn green mt" id="extend-btn">${esc(t('ext.btn'))}</button>
        </div>` + (o.category === 'number' ? `<div class="mt">${numberCard(o)}</div>`
          : isGift ? `<div class="mt">${tgCard(o, true)}</div><details class="alt-way mt"><summary>${esc(t('tgc.alt_title'))}</summary>${linkCard(o, true)}</details>`
          : `<details class="alt-way mt"><summary>${esc(t('active.relink'))}</summary>${linkCard(o, true)}</details>`); break;
    default: body = `<div class="card center"><p style="margin:0;line-height:1.5">${esc(t(`final.${o.status}`))}</p>
        ${o.kind === 'extend' && o.parent_id ? `<button class="btn mt" id="open-parent">${esc(t('notify.open'))} #${o.parent_id}</button>` : ''}
        <button class="btn secondary mt" id="browse">${esc(t('rentals.browse'))}</button></div>`;
  }
  view.innerHTML = head + `<div class="mt">${body}</div>`;
  bindOrder(view, o);
  // countdowns
  const tick = () => {
    view.querySelectorAll('[data-until]').forEach(el => { el.textContent = clock((new Date(el.dataset.until) - Date.now()) / 1000); });
    view.querySelectorAll('[data-left-until]').forEach(el => { el.textContent = duration((new Date(el.dataset.leftUntil) - Date.now()) / 1000); });
  };
  tick(); state.timers.push(setInterval(tick, 1000));
  // live status updates
  if (!FINAL.has(o.status)) {
    state.poll = setInterval(async () => {
      if (document.hidden || state.view?.id !== id) return;
      if (view.querySelector('textarea:focus') || view.querySelector('#tg-msg')) return;
      try { const fresh = await api.order(id); if (fresh.status !== o.status) { haptic('medium'); render(); } } catch { /* offline */ }
    }, 5000);
  }
}

function bindOrder(view, o) {
  view.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => copy(b.dataset.copy));
  $('#browse', view)?.addEventListener('click', () => switchTab('catalog'));
  $('#open-parent', view)?.addEventListener('click', () => openOrder(o.parent_id));
  $('#extend-btn', view)?.addEventListener('click', () => extendSheet(o));
  $('#go-topup', view)?.addEventListener('click', () => openView('balance'));
  $('#pay-balance', view)?.addEventListener('click', async e => {
    e.target.disabled = true;
    try { await api.payBalance(o.id); haptic('medium'); state.me = await api.me(); state.orders = null; render(); }
    catch (err) { toast(errText(err), true); e.target.disabled = false; }
  });
  $('#get-code', view)?.addEventListener('click', async e => {
    e.target.disabled = true;
    try {
      const r = await api.loginCode(o.id);
      $('#code-box', view).innerHTML = `<div class="code-show"><span>${esc(t('number.code'))}</span><b>${esc(r.code)}</b></div>`;
      $('#code-box', view).onclick = () => copy(r.code);
      e.target.textContent = t('number.again');
    } catch (err) { toast(errText(err), true); }
    e.target.disabled = false;
  });
  if (state.autoExtend === o.id && o.status === 'active') { state.autoExtend = null; extendSheet(o); }
  $('#cancel', view)?.addEventListener('click', () => {
    const run = async () => { try { await api.cancel(o.id); state.orders = null; render(); } catch (e) { toast(errText(e), true); } };
    if (tg?.showConfirm) tg.showConfirm(t('pay.cancel_confirm'), ok => ok && run()); else if (confirm(t('pay.cancel_confirm'))) run();
  });
  $('#receipt', view)?.addEventListener('change', async e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast(t('error.file_too_large'), true); return; }
    const label = $('#upload-label span', view);
    label.textContent = t('pay.uploading');
    try { await api.receipt(o.id, file); haptic('medium'); render(); } catch (err) { toast(errText(err), true); label.textContent = t('pay.upload'); }
  });
  const bindLink = root => {
    $('#open-fragment', root).onclick = () => openLink('https://fragment.com');
    $('#send-link', root).onclick = async e => {
      const url = $('#tc-url', root).value.trim();
      if (!url) return;
      e.target.disabled = true;
      try { await api.link(o.id, url); haptic('medium'); render(); } catch (err) { toast(errText(err), true); e.target.disabled = false; }
    };
  };
  if ($('#send-link', view)) bindLink(view);
  bindTg(view, o);
}

// ------------------------------------------------------------------ extend
function extendSheet(o) {
  const html = `<h3>${esc(t('ext.title'))}</h3><p class="sub">${esc(o.nft_name)}</p>
    <div class="card" style="padding:14px" id="ext-body"><div class="skeleton" style="height:120px"></div></div>
    <div class="mt" id="ext-bd"></div><p class="note center" id="ext-end" style="margin-top:6px"></p>
    <button class="btn" id="ext-pay" disabled>${esc(t('ext.pay'))}</button>`;
  openSheet(html, async (sheet, close) => {
    let info;
    try { info = await api.extendQuote(o.id); } catch (e) { $('#ext-body', sheet).innerHTML = `<p class="note warn" style="margin:0">${esc(errText(e))}</p>`; return; }
    let days = 1, seq = 0;
    const quick = [1, 3, 7, 14, 30].filter(d => d <= info.max_days);
    const update = async () => {
      $('#ext-body', sheet).innerHTML = `<div class="kv" style="padding-top:0"><span>${esc(t('gift.per_day'))}</span><b>${money(info.per_day_uzs)}</b></div>
        <div class="kv" style="border:0;padding-bottom:6px"><span>${esc(t('ext.days'))}</span><b class="muted" style="font-size:13px">${esc(t('ext.max', { n: info.max_days }))}</b></div>
        <div class="stepper"><button id="m" ${days <= 1 ? 'disabled' : ''}>−</button><div class="val"><b>${days}</b><span>${esc(t('gift.days'))}</span></div><button id="p" ${days >= info.max_days ? 'disabled' : ''}>+</button></div>
        <div class="chips mt" style="margin-bottom:0">${quick.map(d => `<button class="chip ${d === days ? 'active' : ''}" data-d="${d}">${d} ${esc(t('common.days'))}</button>`).join('')}</div>`;
      $('#m', sheet).onclick = () => { if (days > 1) { days--; haptic(); update(); } };
      $('#p', sheet).onclick = () => { if (days < info.max_days) { days++; haptic(); update(); } };
      sheet.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { days = Number(b.dataset.d); haptic(); update(); });
      if (o.end_time) $('#ext-end', sheet).textContent = `${t('ext.new_end')}: ${dateTime(new Date(new Date(o.end_time).getTime() + days * 86400000).toISOString())}`;
      const mine = ++seq;
      $('#ext-pay', sheet).disabled = true;
      try {
        const q = await api.extendQuote(o.id, days);
        if (mine !== seq) return;
        $('#ext-bd', sheet).innerHTML = breakdown(q.per_day_uzs, q.days, q.service_fee_uzs || 0, q.amount_uzs);
        $('#ext-pay', sheet).disabled = false;
      } catch (e) { if (mine === seq) $('#ext-bd', sheet).innerHTML = `<p class="note warn">${esc(errText(e))}</p>`; }
    };
    $('#ext-pay', sheet).onclick = async e => {
      e.target.disabled = true;
      try { const created = await api.extend(o.id, days); haptic('medium'); close(); state.orders = null; openOrder(created.id); }
      catch (err) { toast(errText(err), true); e.target.disabled = false; }
    };
    update();
  });
}

// ------------------------------------------------------------------ rentals
async function rentalsView(view) {
  view.innerHTML = `<div class="list">${'<div class="skeleton" style="height:80px"></div>'.repeat(4)}</div>`;
  try { state.orders = (await api.orders()).items; } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.tab !== 'rentals' || state.view) return;
  if (!state.orders.length) {
    view.innerHTML = `<div class="card hero"><div class="hero-art">${art.giftBox}</div><h2>${esc(t('rentals.empty'))}</h2>
      <p>${esc(t('gift.how'))}</p><button class="btn mt2" id="browse">${esc(t('rentals.browse'))}</button></div>`;
    $('#browse', view).onclick = () => switchTab('catalog');
    return;
  }
  const row = o => `<button class="row-card" data-order="${o.id}"><div class="thumb">${(o.category || 'gift') === 'gift' ? giftImage(o.image, o.nft_name) : nameTile({ name: o.nft_name, category: o.category })}</div>
    <div class="grow"><div class="title">${esc(o.nft_name)}</div><div class="sub">#${o.id}${o.kind === 'extend' ? ` · +${esc(t('ext.label'))}` : ''} · ${o.days} ${esc(t('common.days'))} · ${money(o.amount_uzs)}</div>
    <div style="margin-top:6px">${statusBadge(o.status)}</div></div><span class="chev">${icons.chevronRight}</span></button>`;
  const open = state.orders.filter(o => !FINAL.has(o.status)), past = state.orders.filter(o => FINAL.has(o.status));
  view.innerHTML = (open.length ? `<div class="section-title">${esc(t('rentals.active'))}</div><div class="list">${open.map(row).join('')}</div>` : '')
    + (past.length ? `<div class="section-title">${esc(t('rentals.history'))}</div><div class="list">${past.map(row).join('')}</div>` : '');
  view.querySelectorAll('[data-order]').forEach(b => b.onclick = () => openOrder(b.dataset.order));
}

// ------------------------------------------------------------------ guide
function guideView(view) {
  const steps = [1, 2, 3, 4, 5].map(n => `<div class="guide-step"><div class="n">${n}</div><div><b>${esc(t(`guide.s${n}_t`))}</b><p>${esc(t(`guide.s${n}`))}</p></div></div>`).join('');
  view.innerHTML = `<div class="card hero"><div class="hero-art">${art.giftBox}</div><h2>${esc(t('guide.title'))}</h2><p>${esc(t('gift.how'))}</p></div>
    <div class="card">${steps}</div>
    <div class="card"><div class="guide-step"><div class="n" style="background:linear-gradient(135deg,#1fa55a,#4fd879)">${icons.shield.replace('<svg', '<svg width="18" height="18"')}</div>
      <div><b>${esc(t('guide.safe_t'))}</b><p>${esc(t('guide.safe'))}</p></div></div></div>
    <button class="btn mt2" id="go">${esc(t('rentals.browse'))}</button>`;
  $('#go', view).onclick = () => switchTab('catalog');
}


// ------------------------------------------------------------------ profile
function profileView(view) {
  const { user, app, rentals } = state.me;
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || 'User';
  const row = (id, color, icon, label, value = '') => `<button class="menu-row" data-row="${id}"><span class="menu-icon" style="background:${color}">${icon}</span>
    <span class="label">${esc(label)}</span><span class="value">${esc(value)}</span><span class="chev">${icons.chevronRight}</span></button>`;
  const tile = (id, cls, icon, title, sub) => `<button class="p-tile ${cls}" data-row="${id}"><span class="p-ico">${icon.replace('<svg', '<svg width="20" height="20"')}</span>
    <b>${esc(title)}</b><small>${esc(sub)}</small></button>`;
  view.innerHTML = `<div class="p-card">
      ${avatarHtml(user)}<h2>${esc(name)}</h2>${user.username ? `<span class="p-user">● @${esc(user.username)}</span>` : ''}
      <div class="p-stats"><button class="p-stat" data-row="balance"><b>${esc(Number(user.balance_uzs || 0).toLocaleString('ru-RU'))}</b><span>${esc(t('profile.balance'))}</span></button>
        <button class="p-stat" data-row="rentals"><b>${rentals}</b><span>${esc(t('profile.active'))}</span></button></div>
      <button class="btn mt" data-row="topup">${icons.plus.replace('<svg', '<svg width="18" height="18"')} ${esc(t('profile.topup'))}</button></div>
    ${app.support ? `<button class="p-chat" data-row="support"><span class="p-ico">${icons.chat.replace('<svg', '<svg width="22" height="22"')}</span>
      <div><b>${esc(t('profile.chat'))}</b><small>${esc(t('profile.chat_d'))}</small></div><span class="chev">${icons.chevronRight}</span></button>` : ''}
    <div class="p-tiles">${tile('referral', 'violet', icons.users, t('profile.referral'), t('profile.referral_d'))}
      ${tile('premium', 'sunset', icons.star, t('profile.premium'), t('profile.premium_d'))}</div>
    <div class="menu">
      ${row('rentals', 'var(--green-1)', icons.key, t('nav.rentals'), String(rentals))}
      ${row('top', '#e0a400', icons.trophy, t('profile.top'))}
      ${row('guide', 'var(--blue)', icons.book, t('profile.guide'))}
      ${row('lang', 'var(--purple)', icons.globe, t('profile.lang'), t('lang.name'))}
      ${app.channel ? row('channel', '#e0a400', icons.bell, t('profile.channel'), '@' + app.channel) : ''}
      ${app.offer_url ? row('offer', '#3f9d6b', icons.doc, t('profile.offer')) : ''}
    </div>
    <p class="center muted" style="font-size:12px;line-height:1.5;padding:0 10px">${esc(t('profile.safe_note'))}</p>
    <p class="center muted" style="font-size:12px">${esc(app.name)}</p>`;
  const actions = {
    lang: langSheet, support: () => openTg(app.support), channel: () => openTg(app.channel),
    rentals: () => switchTab('rentals'), offer: () => openLink(app.offer_url), balance: () => openView('balance'),
    topup: () => openView('balance'), referral: () => openView('referral'), top: () => openView('top'),
    guide: () => openView('guide'), premium: () => { state.starsSeg = 'premium'; switchTab('stars'); },
  };
  view.querySelectorAll('[data-row]').forEach(b => b.onclick = () => actions[b.dataset.row]?.());
}

// ------------------------------------------------------------------ language
function langSheet() {
  let choice = lang;
  const options = [['uz', 'UZ', 'Uzbek', "O'zbek"], ['en', 'GB', 'English', 'English'], ['ru', 'RU', 'Russian', 'Русский']];
  const html = `<div class="hero-art" style="width:110px;height:110px">${art.globe}</div>
    <h3>${esc(t('lang.title'))}</h3><p class="sub">${esc(t('lang.subtitle'))}</p>
    <div id="opts">${options.map(([code, flag, name, native]) => `<button class="radio-row ${code === choice ? 'active' : ''}" data-lang="${code}">
      <span class="radio"></span><div><b><span class="code">${flag}</span>${esc(name)}</b><small>${esc(native)}</small></div></button>`).join('')}</div>
    <button class="btn mt" id="confirm-lang">${esc(t('lang.confirm'))}</button>`;
  openSheet(html, (sheet, close) => {
    sheet.querySelectorAll('[data-lang]').forEach(b => b.onclick = () => {
      choice = b.dataset.lang; haptic();
      sheet.querySelectorAll('[data-lang]').forEach(x => x.classList.toggle('active', x.dataset.lang === choice));
    });
    $('#confirm-lang', sheet).onclick = async () => {
      close();
      if (choice === lang) return;
      await loadLang(choice);
      api.setLang(choice).catch(() => {});
      if (state.me) state.me.user.lang = choice;
      render();
      toast(t('lang.changed'));
    };
  });
}

// ------------------------------------------------------------------ boot
async function boot() {
  if (tg) {
    tg.ready(); tg.expand();
    try { tg.setHeaderColor('#1a2130'); tg.setBackgroundColor('#1a2130'); tg.setBottomBarColor?.('#1a2130'); } catch { /* old client */ }
    try { tg.disableVerticalSwipes?.(); } catch { /* old client */ }
    tg.BackButton?.onClick(goBack);
  }
  const params = new URLSearchParams(location.search);
  const startParam = tg?.initDataUnsafe?.start_param || '';
  try {
    state.me = await api.me();
  } catch (e) {
    await loadLang(tg?.initDataUnsafe?.user?.language_code || 'uz');
    $('#view').innerHTML = `<div class="card hero mt2"><div class="hero-art">${art.giftBox}</div><h2>GiftRent</h2><p>${esc(errText(e))}</p></div>`;
    return;
  }
  await loadLang(state.me.user.lang);
  document.title = state.me.app.name;
  if (params.get('admin') && state.me.user.is_admin) state.tab = 'admin';
  else if (['balance', 'referral', 'top'].includes(params.get('tab'))) state.view = { name: params.get('tab') };
  else if (params.get('tab')) state.tab = params.get('tab');
  const orderId = params.get('order') || (startParam.startsWith('order_') ? startParam.slice(6) : '');
  if (orderId && state.tab !== 'admin') state.view = { name: 'order', id: Number(orderId) };
  if (orderId && params.get('extend')) state.autoExtend = Number(orderId);
  if (state.tab === 'admin' && orderId) state.adminFocus = Number(orderId);
  render();
}

boot();
