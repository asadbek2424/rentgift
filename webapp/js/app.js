import { api, ApiError } from './api.js';
import { art, flat, glow, icons, nav, placeholder } from './icons.js';
import { clock, dateTime, duration, lang, loadLang, locale, money, t } from './i18n.js';

const tg = window.Telegram?.WebApp;
const $ = (sel, root = document) => root.querySelector(sel);
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const haptic = (type = 'light') => { try { tg?.HapticFeedback?.impactOccurred(type); } catch { /* not in Telegram */ } };
const FINAL = new Set(['expired', 'cancelled', 'refunded', 'failed', 'extended']);

const state = {
  me: null, tab: 'catalog', segment: 'all', sort: 'recently_touch', category: 'gift', q: '', starsSeg: 'stars',
  filters: { collections: [], model: '', backdrop: '', symbol: '', price_min: '', price_max: '', num_min: '', num_max: '' },
  gifts: [], cursor: null, giftsLoaded: false, giftsError: false, collections: null,
  view: null, orders: null, timers: [], poll: null, actSeg: null, invQ: '',
  cart: loadCart(), cartSel: new Set(),
};

// ------------------------------------------------------------------ cart (kept on this device)
function loadCart() {
  try { const v = JSON.parse(localStorage.getItem('gr_cart') || '[]'); return Array.isArray(v) ? v.slice(0, 100) : []; } catch { return []; }
}
function saveCart() { try { localStorage.setItem('gr_cart', JSON.stringify(state.cart)); } catch { /* private mode */ } }
const inCart = address => state.cart.some(g => g.address === address);
function toggleCart(g) {
  haptic();
  if (inCart(g.address)) { state.cart = state.cart.filter(x => x.address !== g.address); state.cartSel.delete(g.address); toast(t('ui.cart_removed')); }
  else { state.cart.unshift(g); toast(t('ui.cart_added')); }
  saveCart();
  document.querySelectorAll(`[data-cart="${CSS.escape(g.address)}"]`).forEach(b => b.classList.toggle('on', inCart(g.address)));
  const badge = document.querySelector('#tb-cart i');
  if (badge) { badge.textContent = state.cart.length; badge.hidden = !state.cart.length; }
}

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
  if (tgOnVisible) { document.removeEventListener('visibilitychange', tgOnVisible); tgOnVisible = null; }
  clearInterval(state.poll); state.poll = null;
}

// ------------------------------------------------------------------ sheets
let sheetStack = [];

// While a sheet is open the page behind must not scroll (phones chain the scroll to <body> otherwise).
let lockedY = 0;
function lockScroll() {
  if (document.body.classList.contains('scroll-locked')) return;
  lockedY = window.scrollY;
  document.body.style.top = `-${lockedY}px`;
  document.body.classList.add('scroll-locked');
}
function unlockScroll() {
  if (!document.body.classList.contains('scroll-locked')) return;
  document.body.classList.remove('scroll-locked');
  document.body.style.top = '';
  window.scrollTo(0, lockedY);
}

export function openSheet(html, mount) {
  const root = $('#sheet-root');
  const overlay = document.createElement('div');
  overlay.className = 'overlay';
  overlay.innerHTML = `<div class="sheet" role="dialog"><button class="sheet-close" aria-label="close">${icons.close}</button>${html}</div>`;
  const close = () => {
    overlay.remove(); sheetStack = sheetStack.filter(c => c !== close);
    if (!sheetStack.length) unlockScroll();
    syncBackButton();
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  $('.sheet-close', overlay).onclick = close;
  root.append(overlay);
  lockScroll();
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

const TAB_LABEL = { catalog: 'nav.market', rentals: 'nav.inventory', activity: 'nav.activity', profile: 'nav.profile', stars: 'nav.stars', admin: 'nav.admin', guide: 'nav.guide' };

function pageTitle() {
  if (state.view?.name === 'order') return t('order.title', { id: state.view.id });
  if (state.view?.name === 'notices') return t('x.bell');
  if (state.view?.name === 'favorites') return t('x.favorites');
  if (state.view) return t(`nav.${state.view.name}`);
  return ['catalog', 'profile'].includes(state.tab) ? '' : t(TAB_LABEL[state.tab] || `nav.${state.tab}`);
}

function pageSub() {
  if (state.view?.name === 'notices' || state.view?.name === 'favorites') return '';
  if (state.view?.name === 'cart') return t('ui.cart_sub');
  if (state.view) return '';
  return { rentals: t('ui.inv_sub'), activity: t('ui.act_sub') }[state.tab] || '';
}

function renderTopbar() {
  const bar = $('#topbar');
  const user = state.me?.user;
  const left = state.view
    ? `<button class="icon-btn" id="tb-back" aria-label="back">${icons.chevronLeft}</button>`
    : `<button class="avatar-btn" id="tb-profile" aria-label="profile">${avatarHtml(user)}</button>
       <button class="stars-pill" id="tb-stars"><span class="lbl">Stars</span>${icons.star}</button>`;
  const n = state.cart.length;
  const right = user
    ? `<button class="round-btn" id="tb-bell" aria-label="${esc(t('x.bell'))}">${icons.bell}<i ${state.me?.unread ? '' : 'hidden'}>${Math.min(99, state.me?.unread || 0)}</i></button>
       <button class="round-btn" id="tb-cart" aria-label="${esc(t('nav.cart'))}">${flat.basket}<i ${n ? '' : 'hidden'}>${n}</i></button>
       <div class="bal-pill"><button class="bal-plus" id="tb-plus" aria-label="top up">${icons.plus}</button>
       <button class="bal-sum" id="tb-bal">${esc(Number(user.balance_uzs || 0).toLocaleString('ru-RU').replace(/,/g, ' '))}<span class="sum-ico">${esc(t('common.sum'))}</span></button></div>`
    : `<button class="icon-btn" id="tb-lang" aria-label="language">${icons.globe}</button>`;
  bar.innerHTML = `<div class="hdr">${left}</div><div class="hdr">${right}</div>`;
  const title = $('#page-title');
  if (title) {
    const sub = pageSub();
    title.innerHTML = pageTitle() ? `${esc(pageTitle())}${sub ? `<small>${esc(sub)}</small>` : ''}` : '';
  }
  $('#tb-cart', bar)?.addEventListener('click', () => openView('cart'));
  $('#tb-bell', bar)?.addEventListener('click', () => openView('notices'));
  $('#tb-profile', bar)?.addEventListener('click', () => switchTab('profile'));
  $('#tb-stars', bar)?.addEventListener('click', () => { state.category = 'stars'; switchTab('catalog'); });
  $('#tb-bal', bar)?.addEventListener('click', () => openView('balance'));
  $('#tb-plus', bar)?.addEventListener('click', () => openView('balance'));
  $('#tb-back', bar)?.addEventListener('click', goBack);
  $('#tb-lang', bar)?.addEventListener('click', langSheet);
}

function renderTabbar() {
  const tabs = [['catalog', nav.market], ['rentals', nav.inventory], ['activity', nav.activity], ['profile', nav.profile]];
  const bar = $('#tabbar');
  const current = state.tab === 'stars' ? 'catalog' : state.tab;
  bar.innerHTML = tabs.map(([id, icon]) =>
    `<button class="tab ${current === id && !state.view ? 'active' : ''}" data-tab="${id}">${icon}<span>${esc(t(TAB_LABEL[id]))}</span></button>`).join('');
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

const helpers = () => ({ state, exactBox, render, renderTopbar, openSheet, toast, errText, esc, giftImage, statusBadge, copy, haptic,
  openView, switchTab, openTg, openLink });

export function openOrder(id) {
  state.view = { name: 'order', id: Number(id) };
  render();
  window.scrollTo({ top: 0 });
}

export async function render() {
  clearTimers();
  if (!sheetStack.length) unlockScroll();
  renderTopbar();
  renderTabbar();
  syncBackButton();
  const view = $('#view');
  if (state.view?.name === 'order') return orderView(view, state.view.id);
  if (state.view?.name === 'guide') return guideView(view);
  if (state.view?.name === 'notices') return noticesView(view);
  if (state.view?.name === 'favorites') return favoritesView(view);
  if (state.view) {
    const mod = await import('./wallet.js');
    if (state.view.name === 'cart') return cartView(view);
    const fn = { balance: mod.balanceView, topup: mod.topupView, referral: mod.referralView, top: mod.topView }[state.view.name];
    if (fn) return fn(view, helpers(), state.view.id);
  }
  if (state.tab === 'stars') { state.tab = 'catalog'; state.category = 'stars'; }
  if (state.tab === 'catalog' && state.category === 'stars') {
    view.innerHTML = categoryTabs() + `<div class="seg pill">
      <button data-sseg="stars" class="${state.starsSeg === 'stars' ? 'active' : ''}">${esc(t('stars.seg_stars'))}</button>
      <button data-sseg="premium" class="${state.starsSeg === 'premium' ? 'active' : ''}">${esc(t('stars.seg_premium'))}</button></div><div id="stars-body"></div>`;
    view.querySelectorAll('[data-sseg]').forEach(b => b.onclick = () => { state.starsSeg = b.dataset.sseg; haptic(); render(); });
    bindCategoryTabs(view);
    return (await import('./wallet.js')).starsView($('#stars-body', view), helpers());
  }
  if (state.tab === 'catalog' && state.category !== 'gift') return otherCatalogView(view);
  if (state.tab === 'catalog') return state.segment === 'all' ? catalogView(view) : collectionsView(view);
  if (state.tab === 'rentals') return inventoryView(view);
  if (state.tab === 'activity') return rentalsView(view);
  if (state.tab === 'guide') return guideView(view);
  if (state.tab === 'profile') return profileView(view);
  if (state.tab === 'admin') {
    const mod = await import('./admin.js');
    return mod.adminView(view, helpers());
  }
}

// ------------------------------------------------------------------ catalog
// Promo banner: dark glass card with a glowing blue edge, CTA pill and 3D-ish bank cards on a light ring.
const BANNER_ART = `<svg viewBox="0 0 170 120" aria-hidden="true">
  <defs>
    <linearGradient id="bc1" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5fb4ff"/><stop offset=".55" stop-color="#2a7cf0"/><stop offset="1" stop-color="#1650c8"/></linearGradient>
    <linearGradient id="bc2" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3f8ff5" stop-opacity=".95"/><stop offset="1" stop-color="#1b46a8" stop-opacity=".9"/></linearGradient>
    <linearGradient id="bchip" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffe59a"/><stop offset="1" stop-color="#e5a52a"/></linearGradient>
    <radialGradient id="bring" cx=".5" cy=".5" r=".5"><stop offset=".6" stop-color="#3da0ff" stop-opacity="0"/><stop offset=".86" stop-color="#5cc3ff" stop-opacity=".9"/><stop offset="1" stop-color="#5cc3ff" stop-opacity="0"/></radialGradient>
    <filter id="bglow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>
  </defs>
  <ellipse cx="88" cy="96" rx="72" ry="16" fill="url(#bring)" filter="url(#bglow)"/>
  <ellipse cx="88" cy="96" rx="66" ry="13" fill="none" stroke="#7fd2ff" stroke-opacity=".75" stroke-width="1.4"/>
  <g transform="rotate(-12 100 52)">
    <rect x="58" y="18" width="92" height="58" rx="9" fill="url(#bc2)" stroke="#9fd3ff" stroke-opacity=".45"/>
    <rect x="58" y="30" width="92" height="9" fill="#0d2a66" opacity=".55"/>
  </g>
  <g transform="rotate(-8 80 66)">
    <rect x="34" y="38" width="96" height="60" rx="9" fill="url(#bc1)" stroke="#bfe3ff" stroke-opacity=".6"/>
    <path d="M34 47 Q82 30 130 52" stroke="#fff" stroke-opacity=".18" stroke-width="10" fill="none"/>
    <rect x="45" y="55" width="17" height="13" rx="3" fill="url(#bchip)"/>
    <path d="M49 55v13M58 55v13M45 61.5h17" stroke="#b8801a" stroke-width=".8" opacity=".7"/>
    <path d="M103 56a6 6 0 0 1 0 9M108 53a10 10 0 0 1 0 15M113 50a14 14 0 0 1 0 21" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round" opacity=".9"/>
    <rect x="45" y="80" width="34" height="4" rx="2" fill="#fff" opacity=".55"/>
  </g>
  <circle cx="132" cy="86" r="13" fill="#2b8cff" stroke="#bfe3ff" stroke-width="2"/>
  <circle cx="132" cy="86" r="17" fill="#2b8cff" opacity=".25" filter="url(#bglow)"/>
  <path d="m126 86 4 4 8-8" stroke="#fff" stroke-width="2.6" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

function banner() {
  return `<button class="banner promo" id="banner">
    <div class="promo-txt"><b>${esc(t('banner.title'))}</b><span class="promo-cta">${esc(t('banner.subtitle'))} ${icons.chevronRight}</span></div>
    <div class="promo-art">${BANNER_ART}</div></button>`;
}

// Category bar: Gift · Username · Raqam · Stars
const catLabel = c => t(`cat.${c}`).replace(/^[^\p{L}]+/u, '').trim();

function categoryTabs() {
  // Tower-style text tabs: active one white with a blue underline, the rest muted
  return `<div class="cat-text" role="tablist">${['gift', 'username', 'number', 'stars'].map(c =>
    `<button role="tab" class="${state.category === c ? 'active' : ''}" data-cat="${c}" aria-selected="${state.category === c}">${esc(catLabel(c))}</button>`).join('')}</div>`;
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

function priceBtn(g) {
  const price = g.per_day_uzs != null ? Number(g.per_day_uzs).toLocaleString('ru-RU').replace(/,/g, ' ') : `${g.price_per_day_ton} TON`;
  return `<div class="gift-foot"><span class="price-btn"><span class="sum-ico">${esc(t('common.sum'))}</span>${esc(price)}<small>${esc(t('catalog.per_day').replace(/\s/g, ''))}</small></span>
    <button class="icon-sq ${inCart(g.address) ? 'on' : ''}" data-cart="${esc(g.address)}" aria-label="${esc(t('ui.to_cart'))}">${flat.basket}</button></div>`;
}

// Cart buttons live inside clickable cards: handle them first and stop the card from opening.
function bindCartButtons(root, list) {
  root.querySelectorAll('[data-cart]').forEach(b => b.onclick = e => {
    e.stopPropagation();
    const g = list().find(x => x.address === b.dataset.cart); if (g) toggleCart(g);
  });
}

function otherCard(g) {
  return `<div class="gift-card" role="button" tabindex="0" data-gift="${esc(g.address)}">
    <div class="gift-img">${nameTile(g)}</div>
    <div class="gift-meta"><div class="gift-name">${esc(g.name)}</div>
      <div class="gift-sub">${esc(t(`cat.${g.category}_one`))} · ${esc(t('catalog.days_range', { min: g.min_days, max: g.max_days }))}</div></div>
    ${priceBtn(g)}</div>`;
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
    view.innerHTML = banner() + categoryTabs() + `<div class="toolbar"><div class="search grow-search">${icons.search}<input id="q" placeholder="${esc(t('catalog.search_name'))}" value="${esc(state.q)}"></div>
      <button class="tool icon-only" id="open-sort" aria-label="${esc(t('catalog.sort_btn'))}">${icons.sort}</button></div>
      <p class="note" style="margin-top:-4px">${esc(t('catalog.other_hint'))}</p>` + body;
    bindCategoryTabs(view);
    $('#banner', view).onclick = () => openView('guide');
    $('#open-sort', view).onclick = sortSheet;
    const q = $('#q', view);
    let timer;
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(async () => { state.q = q.value.trim(); state.other.loaded = false; await loadOther(true); draw(); const n = $('#q', view); n?.focus(); n?.setSelectionRange(n.value.length, n.value.length); }, 500); };
    $('#retry', view)?.addEventListener('click', async () => { state.other.loaded = false; draw(); await loadOther(true); draw(); });
    $('#more', view)?.addEventListener('click', async e => { e.target.disabled = true; await loadOther(false); draw(); });
    view.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => {
      const g = state.other.items.find(x => x.address === b.dataset.gift); if (g) giftSheet(g);
    });
    bindCartButtons(view, () => state.other?.items || []);
  };
  draw();
  if (!state.other?.loaded) { await loadOther(true); draw(); }
}

function giftCard(g) {
  const sub = g.number ? `#${g.number}` : [g.model, g.backdrop].filter(Boolean).join(' · ') || t('catalog.days_range', { min: g.min_days, max: g.max_days });
  return `<div class="gift-card" role="button" tabindex="0" data-gift="${esc(g.address)}">
    <div class="gift-img">${giftImage(g.image, g.name)}${g.discount ? `<span class="disc-ribbon"><b>-${esc(String(g.discount))}%</b></span>` : ''}${g.max_days ? `<span class="days-badge">${icons.clock}${esc(t('catalog.days_range', { min: g.min_days, max: g.max_days }))}</span>` : ''}</div>
    <div class="gift-meta"><div class="gift-name">${esc(g.collection || g.name)}</div><div class="gift-sub">${esc(sub)}</div></div>
    ${priceBtn(g)}</div>`;
}

const giftBy = (list, address) => list.find(x => x.address === address);

// Gift search: the Marketapp catalogue has no name search for gifts, so it filters the loaded cards.
function matchGift(g) {
  const q = (state.gq || '').trim().toLowerCase().replace(/^#/, '');
  if (!q) return true;
  return [g.collection, g.name, g.model, g.backdrop, g.symbol, g.number].some(v => String(v ?? '').toLowerCase().includes(q));
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

function filterPills() {
  const f = state.filters, n = f.collections.length;
  const pill = (attrs, label, on) => `<button class="fpill ${on ? 'on' : ''}" ${attrs}><span>${esc(label)}</span>${icons.chevronDown}</button>`;
  const colLabel = n === 1 ? f.collections[0].name : n ? `${t('catalog.collections_btn')} · ${n}` : t('catalog.collections_btn');
  // Tower-style row: Collection · Model · Backdrop · Symbol (each opens the filter sheet on that group), then sort
  const trait = k => pill(`data-pick="${k}"`, f[k] || t(`gift.${k}`), !!f[k]);
  return `<div class="fpills">${pill('id="open-cols"', colLabel, n > 0)}${trait('model')}${trait('backdrop')}${trait('symbol')}
    <button class="fpill icon" id="open-sort" aria-label="${esc(t('catalog.sort_btn'))}">${icons.sort}</button></div>`;
}

async function catalogView(view) {
  const drawBody = () => {
    const body = $('#gift-body', view);
    if (!body) return;
    const items = state.gifts.filter(matchGift);
    if (!state.giftsLoaded) body.innerHTML = `<div class="grid">${'<div class="skeleton" style="aspect-ratio:.72"></div>'.repeat(6)}</div>`;
    else if (state.giftsError && !state.gifts.length) body.innerHTML = `<div class="empty"><p>${esc(t('catalog.error'))}</p><button class="btn secondary small" id="retry" style="margin:0 auto">${esc(t('common.retry'))}</button></div>`;
    else if (!items.length) body.innerHTML = `<div class="empty"><div class="hero-art">${art.giftBox}</div>${esc(t(activeChips().length || state.gq ? 'catalog.no_results' : 'catalog.empty'))}</div>`;
    else body.innerHTML = `<div class="grid">${items.map(giftCard).join('')}</div>`
      + (state.cursor ? `<button class="btn secondary mt2" id="more">${esc(t('catalog.load_more'))}</button>` : '');
    $('#retry', body)?.addEventListener('click', async () => { state.giftsLoaded = false; drawBody(); await loadGifts(true); draw(); });
    $('#more', body)?.addEventListener('click', async e => { e.target.disabled = true; await loadGifts(false); drawBody(); });
    body.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => {
      const g = state.gifts.find(x => x.address === b.dataset.gift); if (g) giftSheet(g);
    });
    bindCartButtons(body, () => state.gifts);
  };
  const draw = () => {
    if (state.tab !== 'catalog' || state.segment !== 'all' || state.view) return;
    const nFil = filterCount();
    // price / item-number filters have no pill of their own: show them as removable chips
    const chips = activeChips().filter(([k]) => !k.startsWith('col:') && !['model', 'backdrop', 'symbol'].includes(k));
    const chipRow = chips.length ? `<div class="chips">${chips.map(([k, label]) =>
      `<button class="chip active" data-rm="${esc(k)}">${esc(label)} ${icons.x}</button>`).join('')}</div>` : '';
    view.innerHTML = banner() + categoryTabs()
      + `<div class="toolbar"><div class="search grow-search">${icons.search}<input id="gq" placeholder="${esc(t('catalog.search_gift'))}" value="${esc(state.gq || '')}"></div>
        <button class="tool icon-only ${nFil ? 'on' : ''}" id="open-filters" aria-label="${esc(t('catalog.filters_btn'))}">${icons.sliders}${nFil ? `<i>${nFil}</i>` : ''}</button></div>`
      + filterPills() + chipRow
      + `<div class="sec-row"><b>${icons.gift.replace('<svg', '<svg width="20" height="20"')}${esc(t('catalog.all_gifts'))}</b>
        <button class="link-btn" id="to-cols">${esc(t('catalog.segment_collections'))} ›</button></div><div id="gift-body"></div>`;
    bindCategoryTabs(view);
    $('#banner', view).onclick = () => openView('guide');
    $('#open-cols', view).onclick = collectionsSheet;
    $('#open-filters', view).onclick = () => filtersSheet();
    $('#open-sort', view).onclick = sortSheet;
    $('#to-cols', view).onclick = () => { state.segment = 'collections'; haptic(); render(); };
    view.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => traitSheet(b.dataset.pick));
    view.querySelectorAll('[data-rm]').forEach(b => b.onclick = () => removeChip(b.dataset.rm));
    $('#gq', view).oninput = e => { state.gq = e.target.value; drawBody(); };
    drawBody();
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
  const head = () => banner() + categoryTabs() + `<div class="sec-row"><b>${icons.layers.replace('<svg', '<svg width="20" height="20"')}${esc(t('catalog.segment_collections'))}</b>
    <button class="link-btn" id="to-all">${esc(t('catalog.all_gifts'))} ›</button></div>`;
  const bind = () => {
    $('#banner', view).onclick = () => openView('guide');
    $('#to-all', view).onclick = () => { state.segment = 'all'; haptic(); render(); };
    bindCategoryTabs(view);
  };
  view.innerHTML = head() + `<div class="list">${'<div class="skeleton" style="height:76px"></div>'.repeat(6)}</div>`;
  bind();
  try { await ensureCollections(); } catch { view.innerHTML = head() + `<div class="empty">${esc(t('catalog.error'))}</div>`; bind(); return; }
  if (state.tab !== 'catalog' || state.segment !== 'collections' || state.view) return;
  view.innerHTML = head() + `<div class="list">${state.collections.map(c => collectionRow(c, false)).join('')}</div>`;
  bind();
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

// Pictures for the filter pickers. Model/Symbol art comes from the public gift dataset (cdn.changes.tg);
// backdrop colours come from the server (/api/attributes → backdrop_colors). Everything has a fallback.
const GIFT_CDN = 'https://cdn.changes.tg/gifts';
// Marketapp collections are plural ("Light Swords", "Swiss Watches", "Jelly Bunnies"); gift art uses the singular name.
function giftName(collection) {
  const words = String(collection || '').trim().split(/\s+/);
  let last = words.pop() || '';
  if (last.length > 4 && /ies$/i.test(last)) last = last.slice(0, -3) + 'y';
  else if (last.length > 4 && /(ches|shes|sses|xes|zes)$/i.test(last)) last = last.slice(0, -2);
  else if (last.length > 3 && /s$/i.test(last) && !/ss$/i.test(last)) last = last.slice(0, -1);
  return [...words, last].join(' ');
}
function hashHue(text) { let h = 0; for (const c of text || '') h = (h * 31 + c.charCodeAt(0)) >>> 0; return h % 360; }
// Fallback when the colour list is unreachable: guess from colour words in the backdrop name ("Ice Blue", "Mint Green").
const COLOR_WORDS = [['black', '#3a3a3e', '#141416'], ['onyx', '#3a3a3e', '#141416'], ['white', '#e9edf2', '#a9b0ba'], ['ivory', '#efe6cf', '#b9ab86'],
  ['silver', '#c4ccd6', '#7f8a98'], ['gray', '#9aa1ab', '#5b626c'], ['grey', '#9aa1ab', '#5b626c'], ['navy', '#3b5c8c', '#1f3152'],
  ['ice', '#bfe3f5', '#6aa8c9'], ['sky', '#7cc4f0', '#3b84b8'], ['blue', '#4a90e2', '#22508f'], ['cyan', '#4fd1e0', '#1f8a99'],
  ['teal', '#3fb6a8', '#1d6e66'], ['turquoise', '#46cfc0', '#1f857a'], ['mint', '#8fe0b8', '#3f9a74'], ['emerald', '#3fbf7f', '#1c7048'],
  ['green', '#5cbf5c', '#2b6e2b'], ['lime', '#b5e05a', '#6f9a22'], ['olive', '#a7a85a', '#5f6029'], ['jade', '#4fb38a', '#25694f'],
  ['gold', '#f1c75a', '#a8781c'], ['yellow', '#f5d94e', '#b0961c'], ['amber', '#f2b24a', '#a9681a'], ['orange', '#f39a4a', '#b0561a'],
  ['carrot', '#f39a4a', '#b0561a'], ['caramel', '#d9a066', '#8f5b2b'], ['brown', '#a87956', '#5e3d26'], ['chocolate', '#8b5a3c', '#4a2c1b'],
  ['coffee', '#9c6b4a', '#553521'], ['red', '#e25b5b', '#8f2424'], ['crimson', '#d6404f', '#7a1520'], ['ruby', '#d0405a', '#7a1428'],
  ['rose', '#e88aa6', '#a0465f'], ['pink', '#f29ac1', '#b04f7c'], ['coral', '#f58b78', '#b04a39'], ['peach', '#f6b69a', '#b9705a'],
  ['purple', '#9b6ce0', '#55309a'], ['violet', '#9b6ce0', '#55309a'], ['lavender', '#b9a4ec', '#6f5aa8'], ['lilac', '#c3a2e6', '#7a5aa0'],
  ['plum', '#9a5a8c', '#55284c'], ['indigo', '#6a6fe0', '#33379a'], ['midnight', '#3a4a7a', '#151d38'], ['sapphire', '#3f6fd6', '#1c3a85']];
function guessBackdrop(name) {
  const n = (name || '').toLowerCase();
  const hit = COLOR_WORDS.find(([w]) => n.includes(w));
  if (hit) return [hit[1], hit[2]];
  const h = hashHue(name);
  return [`hsl(${h} 55% 58%)`, `hsl(${h} 60% 32%)`];
}
// "0.1%" style like gift lists: one decimal from 1% up, two below 1% (trailing zeros dropped)
const fmtPerc = p => { const n = Number(p); if (!n) return ''; const v = n >= 1 ? n.toFixed(1) : n.toFixed(2); return v.replace(/\.?0+$/, ''); };
function traitThumb(trait, value, collection, colors) {
  if (trait === 'backdrop') {
    const c = colors?.[value] || guessBackdrop(value);
    const bg = `radial-gradient(circle at 35% 30%, ${c[0]}, ${c[1]})`;
    return `<span class="opt-thumb swatch" style="background:${bg}"></span>`;
  }
  if (!collection) return `<span class="opt-thumb letter">${esc((value || '?')[0])}</span>`;
  const kind = trait === 'model' ? 'models' : 'patterns';
  const src = `${GIFT_CDN}/${kind}/${encodeURIComponent(giftName(collection))}/png/${encodeURIComponent(value)}.png`;
  return `<span class="opt-thumb ${trait}"><img src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer"
    onerror="this.parentNode.classList.add('letter');this.parentNode.textContent='${esc((value || '?')[0]).replace(/'/g, '')}'"></span>`;
}

function filtersSheet(focus) {
  const f = { ...state.filters };
  const one = f.collections.length === 1 ? f.collections[0].address : '';
  const oneName = f.collections.length === 1 ? f.collections[0].name : '';
  let colors = {};
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
    const open = new Set(typeof focus === 'string' ? [focus] : []);
    const draw = () => {
      const q = $('#a-q', sheet).value.trim().toLowerCase();
      box.innerHTML = groups.map(g => {
        const values = g.values.filter(v => !q || v.value.toLowerCase().includes(q));
        const expanded = open.has(g.trait) || (q && values.length);
        const label = t(`gift.${g.trait}`);
        return `<div class="acc"><button class="acc-head" data-acc="${g.trait}"><b>${esc(label)}${f[g.trait] ? ` · <span class="accent">${esc(f[g.trait])}</span>` : ''}</b>
          <span class="muted">${g.values.length} ${expanded ? '▴' : '▾'}</span></button>
          ${expanded ? `<div class="acc-body">${values.slice(0, 200).map(v => `<button class="opt ${f[g.trait] === v.value ? 'on' : ''}" data-trait="${g.trait}" data-val="${esc(v.value)}">
            <span class="radio"></span>${traitThumb(g.trait, v.value, oneName, colors)}<span class="grow">${esc(v.value)}</span>
            ${v.perc ? `<em class="opt-perc">${esc(fmtPerc(v.perc))}%</em>` : ''}<span class="opt-count">${v.count || ''}</span></button>`).join('')}</div>` : ''}</div>`;
      }).join('');
      box.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => { open.has(b.dataset.acc) ? open.delete(b.dataset.acc) : open.add(b.dataset.acc); draw(); });
      box.querySelectorAll('[data-trait]').forEach(b => b.onclick = () => {
        const { trait, val } = b.dataset; f[trait] = f[trait] === val ? '' : val; haptic(); draw();
      });
    };
    $('#a-q', sheet).oninput = draw;
    try { const r = await api.attributes(one); groups = r.attributes; colors = r.backdrop_colors || {}; } catch { box.innerHTML = `<p class="note">${esc(t('catalog.error'))}</p>`; }
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

// One trait as a dropdown-like sheet (Model / Fon / Belgi pills): tap a value → applied at once.
function traitSheet(trait) {
  const f = state.filters;
  const one = f.collections.length === 1 ? f.collections[0].address : '';
  const oneName = f.collections.length === 1 ? f.collections[0].name : '';
  if (trait === 'model' && !one) {          // models only exist inside one collection
    toast(t('catalog.model_hint'));
    collectionsSheet();
    return;
  }
  const label = t(`gift.${trait}`);
  const html = `<h3 class="left-title">${esc(label)}${oneName ? ` <small class="muted" style="font-size:14px;font-weight:600">· ${esc(oneName)}</small>` : ''}</h3>
    <div class="search">${icons.search}<input id="t-q" placeholder="${esc(t('catalog.search_attr'))}"></div>
    <div id="t-list" class="acc-body t-list"><div class="skeleton" style="height:56px"></div><div class="skeleton mt" style="height:56px"></div></div>
    ${f[trait] ? `<div class="sheet-footer"><button class="btn secondary" id="t-clear">${esc(t('catalog.reset'))}</button></div>` : ''}`;
  openSheet(html, async (sheet, close) => {
    const box = $('#t-list', sheet);
    let values = [], colors = {};
    const pick = val => { state.filters[trait] = state.filters[trait] === val ? '' : val; haptic(); close(); applyFilters(); };
    const draw = () => {
      const q = $('#t-q', sheet).value.trim().toLowerCase();
      const list = values.filter(v => !q || v.value.toLowerCase().includes(q));
      box.innerHTML = list.length ? list.slice(0, 300).map(v => `<button class="opt ${f[trait] === v.value ? 'on' : ''}" data-val="${esc(v.value)}">
        <span class="radio"></span>${traitThumb(trait, v.value, oneName, colors)}<span class="grow">${esc(v.value)}</span>
        ${v.perc ? `<em class="opt-perc">${esc(fmtPerc(v.perc))}%</em>` : ''}<span class="opt-count">${v.count || ''}</span></button>`).join('')
        : `<p class="note center">${esc(t('catalog.no_results'))}</p>`;
      box.querySelectorAll('[data-val]').forEach(b => b.onclick = () => pick(b.dataset.val));
    };
    $('#t-q', sheet).oninput = draw;
    $('#t-clear', sheet)?.addEventListener('click', () => { state.filters[trait] = ''; close(); applyFilters(); });
    try {
      const r = await api.attributes(one);
      values = (r.attributes.find(g => g.trait === trait) || {}).values || [];
      colors = r.backdrop_colors || {};
      draw();
    } catch { box.innerHTML = `<p class="note">${esc(t('catalog.error'))}</p>`; }
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
function breakdown(perDay, days, fee, total, add = 0, discount = 0) {
  return `<div class="card breakdown" style="padding:6px 16px">
    <div class="kv"><span>${esc(t('price.rent', { per: money(perDay), days }))}</span><b>${money(perDay * days)}</b></div>
    ${fee ? `<div class="kv"><span>${esc(t('price.fee'))}</span><b>${money(fee)}</b></div>` : ''}
    ${add ? `<div class="kv"><span>${esc(t('price.unique'))}</span><b>+${money(add)}</b></div>` : ''}
    ${discount ? `<div class="kv disc"><span>${esc(t('x.discount'))}</span><b>−${money(discount)}</b></div>` : ''}
    <div class="kv"><span><b style="color:var(--text)">${esc(t('price.total'))}</b></span><b style="font-size:17px">${money(total)}</b></div></div>`;
}

// ------------------------------------------------------------------ animated gifts (Lottie from Fragment)
// The static .webp is shown at once; the animation (model only, transparent) is drawn over the gift's backdrop
// gradient and fades in when ready. Fragment's animation is the full picture (backdrop + pattern + model). If anything fails, the static picture simply stays.
let lottieLoading = null;
function loadLottie() {
  if (window.lottie) return Promise.resolve(window.lottie);
  return lottieLoading || (lottieLoading = new Promise((ok, fail) => {
    const s = document.createElement('script');
    s.src = '/static/js/vendor/lottie_light.min.js?v=5.12.2';
    s.onload = () => (window.lottie ? ok(window.lottie) : fail());
    s.onerror = () => { lottieLoading = null; fail(); };
    document.head.appendChild(s);
  }));
}

function animKey(image) {
  const url = Array.isArray(image) ? image[0] : image;
  const m = /nft\.fragment\.com\/gift\/([a-z0-9]+-\d+)\.webp/.exec(url || '');
  return m ? m[1] : null;
}

async function animateHero(hero, image, colors) {
  const key = animKey(image);
  if (!key || !hero || hero.querySelector('.gift-anim')) return;
  let data, lib;
  try {
    [lib, data] = await Promise.all([loadLottie(), fetch(`/api/gift-anim/${key}`).then(r => (r.ok ? r.json() : null))]);
  } catch { return; }
  if (!data || !hero.isConnected || hero.querySelector('.gift-anim')) return;
  const box = document.createElement('div');
  box.className = 'gift-anim';
  if (Array.isArray(colors) && colors[0]) box.style.background = `radial-gradient(circle at 50% 46%, ${colors[0]} 0%, ${colors[1] || colors[0]} 78%)`;
  else {
    const src = hero.querySelector('img')?.src;
    if (src) { const bg = document.createElement('i'); bg.className = 'ga-blur'; bg.style.backgroundImage = `url("${src}")`; box.appendChild(bg); }
  }
  const stage = document.createElement('div');
  stage.className = 'ga-stage';
  box.appendChild(stage);
  hero.insertBefore(box, hero.querySelector('.gd-title'));
  let anim;
  try {
    anim = lib.loadAnimation({ container: stage, renderer: 'svg', loop: true, autoplay: true, animationData: data,
      rendererSettings: { preserveAspectRatio: 'xMidYMid slice' } });
  } catch { box.remove(); return; }
  // With inline data lottie may finish loading inside loadAnimation(), before a 'DOMLoaded' listener exists —
  // so reveal on whichever comes first: already loaded, DOMLoaded, first frame, or a short timeout.
  let shown = false;
  const show = () => {
    if (shown || !box.isConnected) return;
    shown = true;
    box.classList.add('on');
    hero.classList.add('animated');
    anim.play();
  };
  if (anim.isLoaded) requestAnimationFrame(show);
  anim.addEventListener('DOMLoaded', show);
  anim.addEventListener('enterFrame', show);
  setTimeout(show, 600);
  anim.addEventListener('data_failed', () => { box.remove(); hero.classList.remove('animated'); });
  hero.onclick = () => { if (shown) anim.goToAndPlay(0, true); };   // tap → play again from the start
  // stop the animation loop once the sheet is closed
  const watch = setInterval(() => { if (!box.isConnected) { clearInterval(watch); anim.destroy(); } }, 1500);
}

// ------------------------------------------------------------------ gift sheet
function giftSheet(g) {
  let days = Math.max(g.min_days, Math.min(g.max_days, 1));
  const attrs = [['model', g.model], ['symbol', g.symbol], ['backdrop', g.backdrop]].filter(([, v]) => v);
  const other = g.category && g.category !== 'gift';
  const title = !other && g.collection && g.number ? [g.collection, `#${g.number}`] : [g.name, ''];
  const perDay = g.per_day_uzs != null ? Number(g.per_day_uzs).toLocaleString('ru-RU').replace(/,/g, ' ') : '—';
  const html = `
    <div class="gd-card">
      <div class="gift-hero">${other ? nameTile(g) : giftImage(g.image, g.name)}
        <div class="gd-title"><h3>${esc(title[0])}</h3>${title[1] ? `<span>${esc(title[1])}</span>` : ''}</div></div>
      <div class="attr-table">
        ${attrs.map(([k, v]) => `<div class="attr-row"><span>${esc(t(`gift.${k}`))}</span><b>${esc(v)}<em class="pct rar loading" data-tr="${k}">…</em></b></div>`).join('')}
        <div class="attr-row"><span>${esc(t('ui.price_day'))}</span><b>${esc(perDay)} <em class="pct">${esc(t('common.sum'))}</em></b></div>
        <div class="attr-row"><span>${esc(t('gift.duration'))}</span><b><em class="pct">${esc(t('gift.limits', { min: g.min_days, max: g.max_days }))}</em></b></div>
      </div>
      <div class="gd-actions">
        <button id="gd-share">${flat.share}<span>${esc(t('ui.share'))}</span></button>
        <button id="gd-cart" class="${inCart(g.address) ? 'on' : ''}">${flat.basket}<span>${esc(t(inCart(g.address) ? 'ui.in_cart' : 'ui.to_cart'))}</span></button>
        ${other ? '' : `<button id="gd-fav" class="fav ${isFav(g.address) ? 'on' : ''}">${icons.heart}<span>${esc(t('x.favorites'))}</span></button>`}
      </div>
    </div>
    <div class="card" style="padding:14px">
      <div class="stepper"><button id="minus">−</button><div class="val"><b id="days"></b><span>${esc(t('gift.days'))}</span></div><button id="plus">+</button></div>
      <div class="chips mt" id="quick" style="margin-bottom:0"></div>
    </div>
    <div class="promo-box mt" id="promo-box"><button class="promo-open" id="promo-open">${icons.tag}<span>${esc(t('x.promo'))}</span></button></div>
    <div class="mt" id="bd"></div><p class="note center" id="ton" style="margin-top:6px"></p>
    <p class="note center">${esc(other ? t('catalog.other_hint') : t('gift.how'))}</p>
    <div class="sticky-cta"><button class="btn" id="rent">${esc(t('gift.rent'))}</button></div>`;
  openSheet(html, (sheet, close) => {
    sheet.classList.add('gift-sheet');
    // rarity of each trait in the collection (Marketapp collection attributes, cached on the server)
    const hero = $('.gift-hero', sheet);
    if (attrs.length && !other) {
      api.traits(g.address).then(r => {
        animateHero(hero, g.image, r.backdrop_colors);
        (r.traits || []).forEach(x => {
          const chip = sheet.querySelector(`[data-tr="${x.trait}"]`);
          if (!chip) return;
          if (x.perc) { chip.textContent = `${x.perc}%`; chip.classList.remove('loading'); } else chip.remove();
        });
        sheet.querySelectorAll('.rar.loading').forEach(c => c.remove());
      }).catch(() => { sheet.querySelectorAll('.rar').forEach(c => c.remove()); animateHero(hero, g.image, null); });
    } else if (!other) animateHero(hero, g.image, null);
    sheet.parentElement.classList.add('gift-ov');   // see-through backdrop: the gift floats over the blurred app
    let seq = 0;
    let promo = null;                                // {code, discount_uzs}
    $('#gd-fav', sheet)?.addEventListener('click', e => toggleFav(g, e.currentTarget));
    const promoUi = () => {
      const box = $('#promo-box', sheet);
      if (promo) {
        box.innerHTML = `<div class="promo-on">${icons.tag}<span>${esc(t('x.promo_ok', { amount: money(promo.discount_uzs) }))}</span><b>${esc(promo.code)}</b>
          <button id="promo-del">${esc(t('x.promo_remove'))}</button></div>`;
        $('#promo-del', box).onclick = () => { promo = null; promoUi(); update(); };
        return;
      }
      box.innerHTML = `<button class="promo-open" id="promo-open">${icons.tag}<span>${esc(t('x.promo'))}</span></button>`;
      $('#promo-open', box).onclick = () => {
        box.innerHTML = `<div class="promo-form"><input id="promo-in" maxlength="24" autocapitalize="characters" placeholder="${esc(t('x.promo_ph'))}">
          <button class="btn" id="promo-go">${esc(t('x.promo_apply'))}</button></div>`;
        const input = $('#promo-in', box); input.focus();
        const go = async () => {
          const code = input.value.trim();
          if (!code) return;
          $('#promo-go', box).disabled = true;
          try { promo = await api.promoCheck(code, g.address, days); haptic('medium'); promoUi(); update(); }
          catch (err) { toast(errText(err), true); $('#promo-go', box).disabled = false; }
        };
        $('#promo-go', box).onclick = go;
        input.onkeydown = ev => { if (ev.key === 'Enter') go(); };
      };
    };
    $('#gd-share', sheet).onclick = () => {
      const bot = state.me?.app?.bot_username;
      const url = bot ? `https://t.me/${bot}?startapp=g_${g.address}` : location.href;
      const share = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`${t('ui.share_text')}: ${g.name}`)}`;
      if (tg?.openTelegramLink && bot) tg.openTelegramLink(share); else copy(url);
    };
    $('#gd-cart', sheet).onclick = e => {
      toggleCart(g);
      const b = e.currentTarget; b.classList.toggle('on', inCart(g.address));
      $('span', b).textContent = t(inCart(g.address) ? 'ui.in_cart' : 'ui.to_cart');
    };
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
        if (promo) promo = await api.promoCheck(promo.code, g.address, days).catch(() => promo);
        if (mine !== seq) return;
        const off = promo ? promo.discount_uzs : 0;
        $('#bd', sheet).innerHTML = breakdown(q.per_day_uzs, q.days, q.service_fee_uzs || 0, q.amount_uzs - off, 0, off);
        if (promo) promoUi();
        $('#ton', sheet).textContent = '';
        $('#rent', sheet).textContent = t('ui.rent_for', { price: money(q.amount_uzs - off) });
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
        const order = await api.createOrder(g.address, days, promo?.code || '');
        haptic('medium'); close(); state.orders = null; openOrder(order.id);
      } catch (err) { toast(errText(err), true); e.target.disabled = false; }
    };
    promoUi();
    update();
  });
}

// ------------------------------------------------------------------ 🔔 notifications / ❤️ favorites
function ago(iso) {
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return t('x.just_now');
    return dateTime(iso);
}

async function noticesView(view) {
  view.innerHTML = `<div class="skeleton" style="height:70px"></div><div class="skeleton mt" style="height:70px"></div>`;
  let data;
  try { data = await api.notices(); } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.view?.name !== 'notices') return;
  view.innerHTML = data.items.length ? `<div class="notices">${data.items.map(n => `
    <button class="notice ${n.read ? '' : 'unread'}" ${n.order_id ? `data-order="${n.order_id}"` : n.tab ? `data-tab="${esc(n.tab)}"` : ''}>
      <i>${icons.bell}</i><div><p>${esc(n.text).replace(/\n/g, '<br>')}</p><small>${esc(ago(n.at))}</small></div></button>`).join('')}</div>`
    : `<div class="empty"><div class="hero-art">${art.giftBox}</div>${esc(t('x.bell_empty'))}</div>`;
  view.querySelectorAll('[data-order]').forEach(b => b.onclick = () => openOrder(b.dataset.order));
  view.querySelectorAll('[data-tab]').forEach(b => b.onclick = () => {
    const tab = b.dataset.tab;
    if (tab === 'favorites') openView('favorites'); else if (tab === 'balance') openView('balance'); else switchTab(tab === 'stars' ? 'stars' : 'activity');
  });
  if (data.unread) {
    api.noticesRead().catch(() => {});
    if (state.me) { state.me.unread = 0; renderTopbar(); }
  }
}

async function favoritesView(view) {
  view.innerHTML = `<div class="grid">${'<div class="skeleton" style="height:210px"></div>'.repeat(4)}</div>`;
  let data;
  try { data = await api.favorites(); } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.view?.name !== 'favorites') return;
  if (!data.items.length) { view.innerHTML = `<div class="empty"><div class="hero-art">${art.giftBox}</div>${esc(t('x.fav_empty'))}</div>`; return; }
  view.innerHTML = `<div class="grid">${data.items.map(g => `<div class="fav-wrap ${g.available ? '' : 'gone'}">${giftCard(g)}
    ${g.available ? '' : `<span class="fav-gone">${esc(t('x.fav_gone'))}</span>`}</div>`).join('')}</div>`;
  view.querySelectorAll('[data-gift]').forEach(b => b.onclick = () => {
    const g = data.items.find(x => x.address === b.dataset.gift);
    if (!g) return;
    if (g.available) giftSheet(g); else rerent({ nft_address: g.address });
  });
  bindCartButtons(view, () => data.items.filter(x => x.available));
}

// expired/cancelled rental → open the same gift again (if it is still for rent)
async function rerent(o, btn) {
  if (btn) btn.disabled = true;
  try { giftSheet(await api.gift(o.nft_address)); }
  catch (e) { toast(e.code === 'gift_unavailable' || e.code === 'listing_stale' ? t('x.rerent_gone') : errText(e), true); }
  if (btn) btn.disabled = false;
}

export function isFav(address) { return (state.me?.favorites || []).includes(address); }

export async function toggleFav(g, btn) {
  const on = isFav(g.address);
  try {
    if (on) await api.favDel(g.address); else await api.favAdd(g.address);
    const list = state.me.favorites || (state.me.favorites = []);
    if (on) list.splice(list.indexOf(g.address), 1); else list.push(g.address);
    haptic(on ? 'light' : 'medium');
    toast(t(on ? 'x.fav_removed' : 'x.fav_added'));
    if (btn) btn.classList.toggle('on', !on);
  } catch (e) { toast(errText(e), true); }
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

// "Transfer exactly this amount" box: big amount with the +N tag highlighted, why it matters, auto-confirm line.
export function exactBox(amount, add) {
  const fmtN = n => Number(n).toLocaleString('ru-RU').replace(/,/g, ' ');
  const base = amount - (add || 0);
  const str = fmtN(amount), tail = add ? String(add).length : 0;   // highlight the last digits of the exact amount
  const auto = state.me?.app?.auto_payments;
  return `<div class="exact-box">
    <div class="ex-head">${flat.alert}<b>${esc(t('pay.exact_title'))}</b></div>
    <div class="ex-sum">${tail ? `${esc(str.slice(0, -tail))}<em>${esc(str.slice(-tail))}</em>` : esc(str)}<span>${esc(t('common.sum'))}</span></div>
    ${add ? `<p class="ex-why">${t('pay.exact_why', { add: esc(String(add)) })}</p>
      <p class="ex-bad">${flat.minus}${esc(t('pay.exact_bad', { round: money(base) }))}</p>` : `<p class="ex-why">${esc(t('pay.exact_plain'))}</p>`}
  </div>
  <div class="ex-auto ${auto ? '' : 'manual'}">${auto ? flat.check : flat.clock}<span>${esc(t(auto ? 'pay.auto_line' : 'pay.manual_line'))}</span></div>`;
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
    ${exactBox(o.amount_uzs, o.unique_add_uzs || 0)}
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

let tgOnVisible = null;   // one visibility listener for the Telegram connect screen (removed in clearTimers)

// Picture of the Telegram service message the customer must confirm ("Login attempt … Confirm / Decline").
const TG_CONFIRM_ART = `<svg class="tg-art" viewBox="0 0 300 118" aria-hidden="true">
  <rect x="1" y="1" width="298" height="116" rx="16" fill="#17212b" stroke="#2b5278"/>
  <circle cx="26" cy="27" r="13" fill="#2b8cff"/><path d="M20 27.5l12-5.2-2.1 11-3.8-2.9-2 1.9.3-3.3 5.6-5-6.9 4.3z" fill="#fff"/>
  <text x="46" y="24" fill="#fff" font-size="12" font-weight="700" font-family="Manrope,Arial">Telegram</text>
  <circle cx="111" cy="20" r="5" fill="#2b8cff"/><path d="m108.6 20 1.6 1.6 3-3.2" stroke="#fff" stroke-width="1.4" fill="none"/>
  <text x="46" y="38" fill="#8e96a4" font-size="9.5" font-family="Manrope,Arial">Login attempt · Fragment</text>
  <rect x="14" y="50" width="272" height="22" rx="6" fill="#1e2c3a"/>
  <text x="24" y="65" fill="#c7d0db" font-size="9.5" font-family="Manrope,Arial">Someone wants to log in to your account…</text>
  <rect x="14" y="80" width="132" height="26" rx="8" fill="#2b8cff"/><text x="80" y="97" fill="#fff" font-size="11" font-weight="800" text-anchor="middle" font-family="Manrope,Arial">Confirm ✓</text>
  <rect x="154" y="80" width="132" height="26" rx="8" fill="#26323f"/><text x="220" y="97" fill="#8e96a4" font-size="11" font-weight="700" text-anchor="middle" font-family="Manrope,Arial">Decline</text>
  <circle cx="80" cy="93" r="22" fill="none" stroke="#ffc24d" stroke-width="2" stroke-dasharray="4 3"/>
</svg>`;

function tgCard(o, again = false) {
  const name = state.me?.user?.tg_display_name;
  const steps = again ? '' : `<ol class="tg-steps">
      <li><i>1</i><span>${esc(t('tgc.step1'))}</span></li>
      <li><i>2</i><span>${esc(t('tgc.step2'))}</span></li>
      <li><i>3</i><span>${esc(t('tgc.step3'))}</span></li></ol>
    ${TG_CONFIRM_ART}
    <p class="note tg-where">${esc(t('tgc.where'))}</p>`;
  return `<div class="card tg-card">
    <h3 style="margin:0 0 6px;font-size:18px">${esc(t(again ? 'tgc.again' : 'tgc.title'))}</h3>
    ${again ? '' : `<p class="note" style="margin-top:0">${esc(t('tgc.text'))}</p>`}
    ${steps}
    ${name ? `<p class="note accent">${esc(t('tgc.connected_as', { name }))}</p>` : ''}
    ${o.tg_error && o.tg_error !== 'wrong_account' ? `<p class="note warn">⚠️ ${esc(t(`error.${o.tg_error}`))}</p>` : ''}
    <div id="tg-box"><button class="btn mt" id="tg-start">${icons.telegram.replace('<svg', '<svg width="19" height="19"')} ${esc(t(again ? 'tgc.again' : 'tgc.btn'))}</button></div>
    ${again ? '' : `<p class="note tg-auto">ℹ️ ${esc(t('tgc.auto'))}</p>`}
  </div>`;
}

// 2nd way (Fragment "Connect TON" link): always visible, not hidden behind a collapsed row.
function method2(o, relink = false) {
  return `<div class="card method2 mt"><div class="m2-head"><span class="m2-badge">2</span><b>${esc(t('tgc.method2'))}</b></div>
    <p class="note" style="margin-top:4px">${esc(t('tgc.alt_hint'))}</p>
    <details class="alt-way"><summary>${esc(t('tgc.alt_title'))}</summary>${linkCard(o, relink)}</details></div>`;
}

function bindTg(view, o) {
  const box = $('#tg-box', view);
  if (!box) return;
  let link = null, started = Date.now(), timer = null, busy = false;
  const stop = () => { clearInterval(timer); state.timers = state.timers.filter(x => x !== timer); timer = null; };
  const done = async () => {
    stop(); haptic('medium');
    try { state.me = await api.me(); } catch { /* keep old profile */ }
    toast(t('tgc.displayed', { account: state.me?.user?.tg_display_name || 'Telegram' }));
    render();
  };
  const msgFor = status => t(status === 'consumed' ? 'tgc.consumed' : status === 'refresh' ? 'tgc.refresh' : 'tgc.waiting');
  const waitingUi = (status) => {
    box.innerHTML = `<div class="waiting mt"><div class="spinner"></div><p id="tg-msg">${esc(msgFor(status))}</p></div>
      <button class="btn mt" id="tg-open">${icons.telegram.replace('<svg', '<svg width="19" height="19"')} ${esc(t('tgc.open'))}</button>
      <button class="btn secondary mt" id="tg-copy">${esc(t('tgc.copy_link'))}</button>
      <p class="note center">${esc(t('tgc.android'))}</p>`;
    $('#tg-open', box).onclick = () => link && (tg?.openTelegramLink ? tg.openTelegramLink(link) : openLink(link));
    $('#tg-copy', box).onclick = () => link && copy(link);
  };
  const wrongUi = account => {
    stop();
    box.innerHTML = `<div class="tg-wrong mt"><b>⚠️ ${esc(t('tgc.wrong_title'))}</b><p>${esc(t('tgc.wrong_text', { account }))}</p>
      <button class="btn mt" id="tg-reset">${esc(t('tgc.wrong_reset'))}</button>
      <button class="btn secondary mt" id="tg-use">${esc(t('tgc.wrong_use'))}</button></div>`;
    const choose = async (use, btn) => {
      btn.disabled = true;
      try { handle(await api.tgAccount(o.id, use)); if (!use) poll(); }
      catch (err) { toast(errText(err), true); btn.disabled = false; }
    };
    $('#tg-reset', box).onclick = e => choose(false, e.target);
    $('#tg-use', box).onclick = e => choose(true, e.target);
  };
  const handle = res => {
    if (res.status === 'displayed') return done();
    if (res.status === 'wrong_account') return wrongUi(res.account || '');
    if (res.link) link = res.link;
    if (!$('#tg-msg', box)) waitingUi(res.status); else $('#tg-msg', box).textContent = msgFor(res.status);
  };
  const check = async () => {
    if (busy) return;
    busy = true;
    try { handle(await api.tgStatus(o.id)); }
    catch (err) { stop(); toast(errText(err), true); render(); }
    busy = false;
  };
  const poll = () => {
    started = Date.now();
    if (timer) return;
    timer = setInterval(() => {
      if (document.hidden) return;
      if (Date.now() - started > 15 * 60 * 1000) { stop(); toast(t('tgc.timeout'), true); render(); return; }
      check();
    }, 2500);
    state.timers.push(timer);
  };
  // Android: Telegram minimizes/closes the Mini App while the login is confirmed — check at once on return.
  if (tgOnVisible) document.removeEventListener('visibilitychange', tgOnVisible);
  tgOnVisible = () => { if (!document.hidden && timer && $('#tg-box')) check(); };
  document.addEventListener('visibilitychange', tgOnVisible);
  $('#tg-start', box).onclick = async e => {
    e.target.disabled = true;
    try {
      const res = await api.tgConnect(o.id);
      handle(res);
      if (res.status === 'displayed' || res.status === 'wrong_account') return;
      if (link) (tg?.openTelegramLink ? tg.openTelegramLink(link) : openLink(link));
      poll();
    } catch (err) { toast(errText(err), true); e.target.disabled = false; }
  };
  // reopened after confirming elsewhere (or app was closed): resume watching instead of asking to tap again
  if (o.tg_waiting && o.status === 'awaiting_link') { waitingUi('consumed'); poll(); check(); }
  if (o.tg_error === 'wrong_account') wrongUi(state.me?.user?.tg_display_name || '');
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
      <div class="mt">${breakdown(o.per_day_uzs, o.days, o.service_fee_uzs || 0, o.amount_uzs, o.unique_add_uzs || 0, o.discount_uzs || 0)}</div>`;
  let body = '';
  switch (o.status) {
    case 'awaiting_payment': body = paymentCard(o); break;
    case 'payment_review': body = waiting(t('review.text')); break;
    case 'paid': case 'renting': body = waiting(t('renting.text')); break;
    case 'awaiting_link': body = isGift ? tgCard(o) + method2(o)
      : `<p class="note">${esc(t('uname.text'))}</p>` + linkCard(o); break;
    case 'connecting': case 'connect_signing': body = waiting(t('connecting.text')); break;
    case 'active': body = `<div class="card"><h3 style="margin:0 0 8px">${esc(t('active.title'))}</h3>
        <div class="timer-label">${esc(t('active.left'))}</div><div class="timer" data-left-until="${esc(o.end_time)}">—</div>
        <div class="kv mt"><span>${esc(t('active.ends'))}</span><b>${esc(dateTime(o.end_time))}</b></div>
        <p class="note">${esc(t('active.hint'))}</p>
        <button class="btn green mt" id="extend-btn">${esc(t('ext.btn'))}</button>
        </div>` + (o.category === 'number' ? `<div class="mt">${numberCard(o)}</div>`
          : isGift ? `<div class="mt">${tgCard(o, true)}</div>${method2(o, true)}`
          : `<details class="alt-way mt"><summary>${esc(t('active.relink'))}</summary>${linkCard(o, true)}</details>`); break;
    default: body = `<div class="card center"><p style="margin:0;line-height:1.5">${esc(t(`final.${o.status}`))}</p>
        ${o.kind === 'extend' && o.parent_id ? `<button class="btn mt" id="open-parent">${esc(t('notify.open'))} #${o.parent_id}</button>` : ''}
        ${o.kind !== 'extend' && ['expired', 'cancelled', 'refunded', 'failed'].includes(o.status) ? `<button class="btn mt" id="rerent">${icons.repeat.replace('<svg', '<svg width="18" height="18"')} ${esc(t('x.rerent'))}</button>` : ''}
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
  $('#rerent', view)?.addEventListener('click', e => rerent(o, e.currentTarget));
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

// ------------------------------------------------------------------ activity (all orders) — Tower "Activity" screen
const ACT_KIND = { active: 'ok', extended: 'ok', expired: 'info', cancelled: 'info', refunded: 'info', failed: 'err' };
const ACT_ICON = { ok: flat.check, info: flat.snow, err: flat.alert, wait: flat.clock };
const ACT_LABEL = { ok: 'ui.completed', info: 'ui.frozen', err: 'ui.dispute', wait: 'ui.processing' };
const LIVE = new Set(['active', 'awaiting_link', 'connecting', 'connect_signing']);

function orderThumb(o) {
  return (o.category || 'gift') === 'gift' ? giftImage(o.image, o.nft_name) : nameTile({ name: o.nft_name, category: o.category });
}

function shortDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  // Uzbek month names are missing in some WebViews' Intl data, so spell them out.
  const uz = ['yan', 'fev', 'mar', 'apr', 'may', 'iyun', 'iyul', 'avg', 'sen', 'okt', 'noy', 'dek'];
  const day = lang === 'uz' ? `${d.getDate()} ${uz[d.getMonth()]}` : d.toLocaleDateString(locale(), { day: 'numeric', month: 'short' });
  return `${day}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function splitName(name = '') {
  const i = name.lastIndexOf(' #');
  return i > 0 ? [name.slice(0, i), name.slice(i + 1)] : [name, ''];
}

function statusCard(o) {
  const kind = ACT_KIND[o.status] || 'wait';
  const [title, num] = splitName(o.nft_name);
  const label = kind === 'wait' || o.status === 'active' ? t(`status.${o.status}`) : t(ACT_LABEL[kind]);
  return `<div class="act-item">
    <div class="act-top"><span class="act-st ${kind}">${ACT_ICON[kind]}${esc(label)}</span><span class="date">${esc(shortDate(o.created_at))}</span></div>
    <button class="status-card ${kind}" data-order="${o.id}">
      <div class="sc-body"><div class="thumb">${orderThumb(o)}</div>
        <div class="grow"><div class="title">${esc(title)}</div>
          <div class="sub">${esc(num || `#${o.id}`)}${o.kind === 'extend' ? ` · +${esc(t('ext.label'))}` : ''} · ${o.days} ${esc(t('common.days'))}</div></div>
        <div class="price">${esc(Number(o.amount_uzs).toLocaleString('ru-RU').replace(/,/g, ' '))}<span class="sum-ico">${esc(t('common.sum'))}</span></div></div>
      <span class="sc-go">${esc(t('ui.go_order'))}</span></button></div>`;
}

async function rentalsView(view) {
  view.innerHTML = `<div class="list">${'<div class="skeleton" style="height:130px"></div>'.repeat(3)}</div>`;
  try { state.orders = (await api.orders()).items; } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.tab !== 'activity' || state.view) return;
  const open = state.orders.filter(o => !FINAL.has(o.status)), past = state.orders.filter(o => FINAL.has(o.status));
  if (!state.actSeg) state.actSeg = open.length || !past.length ? 'active' : 'history';
  const items = state.actSeg === 'active' ? open : past;
  view.innerHTML = `<div class="seg pill">
      <button data-rs="active" class="${state.actSeg === 'active' ? 'active' : ''}">${esc(t('rentals.active'))} <em>${open.length}</em></button>
      <button data-rs="history" class="${state.actSeg === 'history' ? 'active' : ''}">${esc(t('rentals.history'))} <em>${past.length}</em></button></div>`
    + (items.length ? `<div class="list act-list">${items.map(statusCard).join('')}</div>`
      : `<div class="card hero"><div class="hero-art">${art.giftBox}</div><h2>${esc(t('rentals.empty'))}</h2>
        <p>${esc(t('gift.how'))}</p><button class="btn mt2" id="browse">${esc(t('rentals.browse'))}</button></div>`);
  view.querySelectorAll('[data-rs]').forEach(b => b.onclick = () => { state.actSeg = b.dataset.rs; haptic(); rentalsView(view); });
  view.querySelectorAll('[data-order]').forEach(b => b.onclick = () => openOrder(b.dataset.order));
  $('#browse', view)?.addEventListener('click', () => switchTab('catalog'));
}

// ------------------------------------------------------------------ inventory (gifts rented right now) — Tower "Inventory" grid
function invCard(o) {
  const [title, num] = splitName(o.nft_name);
  const left = o.end_time ? duration((new Date(o.end_time) - Date.now()) / 1000) : t(`status.${o.status}`);
  return `<div class="gift-card" role="button" tabindex="0" data-order="${o.id}">
    <div class="gift-img">${orderThumb(o)}${o.status !== 'active' ? `<span class="gift-num">${esc(t(`status.${o.status}`))}</span>` : ''}</div>
    <div class="gift-meta"><div class="gift-name">${esc(title)}</div><div class="gift-sub">${esc(num || `#${o.id}`)}</div></div>
    <div class="gift-foot"><span class="price-btn time">${flat.clock}<span data-left-until="${esc(o.end_time || '')}">${esc(left)}</span></span>
      <span class="icon-sq">${icons.chevronRight}</span></div></div>`;
}

async function inventoryView(view) {
  const head = () => `<div class="toolbar"><div class="search grow-search">${icons.search}<input id="iq" placeholder="${esc(t('ui.search_inv'))}" value="${esc(state.invQ)}"></div>
    <button class="tool icon-only" id="inv-filter" aria-label="${esc(t('catalog.sort_btn'))}">${icons.sliders}</button></div>`;
  view.innerHTML = head() + `<div class="grid">${'<div class="skeleton" style="aspect-ratio:.72"></div>'.repeat(4)}</div>`;
  try { state.orders = (await api.orders()).items; } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.tab !== 'rentals' || state.view) return;
  const live = state.orders.filter(o => LIVE.has(o.status) && o.kind !== 'extend');
  const draw = () => {
    const q = state.invQ.trim().toLowerCase().replace(/^#/, '');
    const items = live.filter(o => !q || `${o.nft_name} ${o.id}`.toLowerCase().includes(q));
    const body = $('#inv-body', view);
    body.innerHTML = items.length ? `<div class="grid">${items.map(invCard).join('')}</div>`
      : `<div class="card hero"><div class="hero-art">${art.giftBox}</div><h2>${esc(t('ui.inv_empty'))}</h2>
        <p>${esc(t('gift.how'))}</p><button class="btn mt2" id="browse">${esc(t('rentals.browse'))}</button></div>`;
    body.querySelectorAll('[data-order]').forEach(b => b.onclick = () => openOrder(b.dataset.order));
    $('#browse', body)?.addEventListener('click', () => switchTab('catalog'));
  };
  view.innerHTML = head() + `<div id="inv-body"></div>`;
  $('#iq', view).oninput = e => { state.invQ = e.target.value; draw(); };
  $('#inv-filter', view).onclick = () => switchTab('activity');
  draw();
  const tick = () => view.querySelectorAll('[data-left-until]').forEach(el => {
    if (el.dataset.leftUntil) el.textContent = duration((new Date(el.dataset.leftUntil) - Date.now()) / 1000);
  });
  state.timers.push(setInterval(tick, 30000));
}

// ------------------------------------------------------------------ cart — Tower "Cart" screen
function cartView(view) {
  const draw = () => {
    const sel = state.cartSel;
    [...sel].forEach(a => { if (!inCart(a)) sel.delete(a); });
    const all = state.cart.length && sel.size === state.cart.length;
    if (!state.cart.length) {
      view.innerHTML = `<div class="card hero"><div class="hero-art">${art.giftBox}</div><h2>${esc(t('ui.cart_empty'))}</h2>
        <button class="btn mt2" id="browse">${esc(t('rentals.browse'))}</button></div>`;
      $('#browse', view).onclick = () => switchTab('catalog');
      return;
    }
    view.innerHTML = `<div class="cart-bar">
        <button class="cart-all" id="c-all"><span class="lbl">${esc(t('ui.select_all'))}</span><em>${state.cart.length}</em><span class="tick ${all ? 'on' : ''}">${icons.check}</span></button>
        <button class="cart-rm" id="c-rm" ${sel.size ? '' : 'disabled'}>${esc(t('ui.remove_selected'))}${flat.trash}</button></div>
      <div class="list">${state.cart.map(g => {
        const price = g.per_day_uzs != null ? Number(g.per_day_uzs).toLocaleString('ru-RU').replace(/,/g, ' ') : g.price_per_day_ton;
        const other = g.category && g.category !== 'gift';
        return `<div class="cart-row" data-open="${esc(g.address)}">
          <div class="thumb">${other ? nameTile(g) : giftImage(g.image, g.name)}</div>
          <div class="grow"><div class="title">${esc(g.collection || g.name)}</div><div class="sub">${esc(g.number ? `#${g.number}` : t(`cat.${g.category}_one`))}</div>
            <div class="cprice">${esc(price)}<span class="sum-ico">${esc(g.per_day_uzs != null ? t('common.sum') : 'TON')}</span><small>${esc(t('catalog.per_day'))}</small></div></div>
          <button class="tick ${sel.has(g.address) ? 'on' : ''}" data-sel="${esc(g.address)}" aria-label="select">${icons.check}</button></div>`;
      }).join('')}</div>`;
    $('#c-all', view).onclick = () => { haptic(); if (all) sel.clear(); else state.cart.forEach(g => sel.add(g.address)); draw(); };
    $('#c-rm', view).onclick = () => {
      haptic('medium'); state.cart = state.cart.filter(g => !sel.has(g.address)); sel.clear(); saveCart(); renderTopbar(); draw();
    };
    view.querySelectorAll('[data-sel]').forEach(b => b.onclick = e => {
      e.stopPropagation(); haptic(); const a = b.dataset.sel; sel.has(a) ? sel.delete(a) : sel.add(a); draw();
    });
    view.querySelectorAll('[data-open]').forEach(b => b.onclick = () => {
      const g = giftBy(state.cart, b.dataset.open); if (g) giftSheet(g);
    });
  };
  draw();
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
  const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'User';
  const num = v => Number(v || 0).toLocaleString('ru-RU').replace(/,/g, ' ');
  const sumTag = `<span class="sum-ico">${esc(t('common.sum'))}</span>`;
  // Stat tile: glow icon + value on one line, grey label under it (as in the mockup).
  const tile = (id, shape, color, value, label, key, money_ = false) => `<button class="pf-tile" data-row="${id}">
    <div class="pf-tv">${glow(shape, color, 30)}<b id="pf-${key}">${esc(value)}</b>${money_ ? sumTag : ''}</div><span>${esc(label)}</span></button>`;
  const big = user.photo_url
    ? `<img src="${esc(user.photo_url)}" alt="" referrerpolicy="no-referrer">`
    : `<span>${esc(((user.first_name || user.username || '?')[0] || '?').toUpperCase())}</span>`;
  const row = (id, shape, color, label, value = '') => `<button class="menu-row" data-row="${id}">${glow(shape, color, 30)}
    <span class="label">${esc(label)}</span><span class="value">${esc(value)}</span><span class="chev">${icons.chevronRight}</span></button>`;

  view.innerHTML = `
    <div class="pf-hero">
      <div class="pf-ava">${big}</div>
      <h2>${esc(user.username ? user.username : name)}</h2>
      <p>#${esc(user.id)}</p>
    </div>
    <div class="pf-grid">
      ${tile('activity', 'ticket', 'blue', '…', t('pf.all_orders'), 'orders')}
      ${tile('referral', 'users', 'blue', '…', t('pf.total_refs'), 'refs')}
      ${tile('rentals', 'bag', 'green', num(rentals), t('pf.active_now'), 'active')}
      ${tile('balance', 'wallet', 'green', num(user.balance_uzs), t('pf.balance'), 'bal', true)}
      ${tile('premium', 'bag', 'orange', '…', t('pf.purchases'), 'buys')}
      ${tile('top', 'card', 'orange', num(user.spent_uzs), t('pf.spent'), 'spent', true)}
    </div>
    <div class="pf-invite">
      <h3 id="pf-inv-title">${esc(t('pf.invite_title', { p: '…' }))}</h3>
      <button class="pf-perk" data-row="referral">${glow('wallet', 'green', 34)}<div><b>${esc(t('pf.earn_t'))}</b><small id="pf-earn">…</small></div></button>
      <button class="pf-perk" data-row="top">${glow('ticket', 'violet', 34)}<div><b>${esc(t('pf.rank_t'))}</b><small id="pf-rank">…</small></div></button>
      <button class="btn mt" data-row="referral">${esc(t('ref.share'))}</button>
    </div>
    <div class="section-title">${esc(t('pf.settings'))}</div>
    <div class="menu">
      ${row('favorites', 'heart', 'red', t('x.favorites'), String((state.me?.favorites || []).length || ''))}
      ${row('notices', 'bell', 'blue', t('x.bell'), state.me?.unread ? String(state.me.unread) : '')}
      ${row('topup', 'card', 'green', t('profile.topup'))}
      ${row('guide', 'book', 'blue', t('profile.guide'))}
      ${row('lang', 'globe', 'blue', t('profile.lang'), t('lang.name'))}
      ${app.support ? row('support', 'chat', 'blue', t('profile.chat')) : ''}
      ${app.channel ? row('channel', 'bell', 'orange', t('profile.channel'), '@' + app.channel) : ''}
      ${app.offer_url ? row('offer', 'doc', 'orange', t('profile.offer')) : ''}
      ${user.is_admin ? row('admin', 'key', 'red', t('nav.admin')) : ''}
    </div>
    <p class="center muted" style="font-size:12px;line-height:1.5;padding:0 10px;margin-top:16px">${esc(t('profile.safe_note'))}</p>`;
  const actions = {
    lang: langSheet, support: () => openTg(app.support), channel: () => openTg(app.channel),
    rentals: () => switchTab('rentals'), activity: () => switchTab('activity'),
    offer: () => openLink(app.offer_url), balance: () => openView('balance'), topup: () => openView('balance'),
    favorites: () => openView('favorites'), notices: () => openView('notices'),
    referral: () => openView('referral'), top: () => openView('top'), guide: () => openView('guide'),
    premium: () => { state.starsSeg = 'premium'; state.category = 'stars'; switchTab('catalog'); },
    admin: () => (app.admin_panel_url ? openLink(app.admin_panel_url) : switchTab('admin')),
  };
  view.querySelectorAll('[data-row]').forEach(b => b.onclick = () => actions[b.dataset.row]?.());
  const fill = (id, text) => { const el = $(`#${id}`, view); if (el) el.textContent = text; };
  api.orders().then(r => fill('pf-orders', num(r.items.length))).catch(() => fill('pf-orders', '—'));
  api.purchases().then(r => fill('pf-buys', num((r.items || []).length))).catch(() => fill('pf-buys', '—'));
  api.referral().then(r => {
    const p = String(Number(r.percent) || 0);
    fill('pf-refs', num(r.invited));
    fill('pf-inv-title', t('pf.invite_title', { p }));
    fill('pf-earn', t('pf.earn_d', { p, sum: money(r.earned_uzs) }));
  }).catch(() => { fill('pf-refs', '—'); fill('pf-earn', ''); });
  api.top().then(r => fill('pf-rank', t('pf.rank_d', { rank: r.me?.rank ? `#${r.me.rank}` : t('pf.rank_none') })))
    .catch(() => fill('pf-rank', ''));
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

// ------------------------------------------------------------------ mandatory channels
function subscribeGate(channels) {
  let el = $('#subgate');
  if (!el) { el = document.createElement('div'); el.id = 'subgate'; document.body.append(el); }
  lockScroll();
  const draw = (list, note = '') => {
    el.innerHTML = `<div class="sg-card">
      <img class="sg-logo" src="/static/img/logo.webp" alt="">
      <h2>${esc(t('sub.title'))}</h2><p>${esc(t('sub.text'))}</p>
      <div class="sg-list">${list.map(c => `<button class="sg-ch" data-url="${esc(c.url)}">
        <span class="sg-ico">${icons.telegram}</span><b>${esc(c.title)}</b><span class="sg-join">${esc(t('sub.join'))}</span></button>`).join('')}</div>
      ${note ? `<p class="sg-note">${esc(note)}</p>` : ''}
      <button class="btn" id="sg-check">${esc(t('sub.check'))}</button></div>`;
    el.querySelectorAll('[data-url]').forEach(b => b.onclick = () => {
      haptic(); const url = b.dataset.url;
      if (url && tg?.openTelegramLink && url.startsWith('https://t.me/')) tg.openTelegramLink(url); else if (url) openLink(url);
    });
    $('#sg-check', el).onclick = async e => {
      e.target.disabled = true;
      try {
        const r = await api.subscription();
        if (r.ok) {
          haptic('medium'); el.remove(); unlockScroll(); toast(t('sub.ok'));
          state.me = await api.me(); render();
          return;
        }
        try { tg?.HapticFeedback?.notificationOccurred('error'); } catch { /* noop */ }
        draw(r.channels, t('sub.not_yet'));
      } catch (err) { toast(errText(err), true); e.target.disabled = false; }
    };
  };
  draw(channels);
}
window.addEventListener('need-subscribe', e => { if (e.detail?.length) subscribeGate(e.detail); });

// ------------------------------------------------------------------ channel invite popup (after the intro animation)
const PROMO_KEY = 'gr_promo_';
function channelPromo(c) {
  const until = Number((() => { try { return localStorage.getItem(PROMO_KEY + c.username); } catch { return 0; } })() || 0);
  if (until > Date.now() || $('#subgate')) return;
  const remember = days => { try { localStorage.setItem(PROMO_KEY + c.username, String(Date.now() + days * 86400000)); } catch { /* private mode */ } };
  const avatar = c.photo ? `<img src="${esc(c.photo)}" alt="" onerror="this.replaceWith(Object.assign(document.createElement('img'),{src:'/static/img/logo.webp',className:'logo'}))">`
    : '<img class="logo" src="/static/img/logo.webp" alt="">';
  const verified = '<svg class="cp-ver" viewBox="0 0 24 24"><path d="M12 1.8l2.6 1.9 3.2-.2 1 3.1 2.6 1.9-1 3.1 1 3.1-2.6 1.9-1 3.1-3.2-.2L12 22.2l-2.6-1.9-3.2.2-1-3.1L2.6 15.5l1-3.1-1-3.1 2.6-1.9 1-3.1 3.2.2Z" fill="#2b8cff"/><path d="m7.8 12.2 2.8 2.8 5.6-5.8" stroke="#fff" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const html = `<div class="cp">
      <span class="cp-badge">@${esc(c.username)}</span>
      <div class="cp-brand"><span class="cp-ava">${avatar}</span><b>${verified}${esc(c.title)}</b></div>
      <h3>${esc(t('promo.title'))}</h3><p>${esc(t('promo.text'))}</p>
      <button class="btn cp-join" id="cp-join">${esc(t('promo.join'))}</button></div>`;
  openSheet(html, (sheet, close) => {
    sheet.classList.add('promo-sheet');
    sheet.parentElement.classList.add('gift-ov');
    $('.sheet-close', sheet).addEventListener('click', () => remember(1));        // closed: ask again tomorrow
    sheet.parentElement.addEventListener('click', e => { if (e.target === sheet.parentElement) remember(1); });
    $('#cp-join', sheet).onclick = () => {
      haptic('medium'); remember(30);                                              // joined: don't nag for a month
      if (tg?.openTelegramLink) tg.openTelegramLink(c.url); else openLink(c.url);
      close();
    };
  });
}

// ------------------------------------------------------------------ boot
function hideSplash() {
  const el = $('#splash');
  if (!el) return;
  // wait until the intro animation (js/splash.js) has finished, then fade out
  const go = () => { if (!el.isConnected) return; el.classList.add('hide'); setTimeout(() => el.remove(), 380); };
  if (window.__splashDone) go(); else window.addEventListener('splash:done', go, { once: true });
}

// Telegram safe areas (Bot API 8.0+, fullscreen): expose them to CSS as --tg-top / --tg-bottom.
function syncSafeArea() {
  const sa = tg?.safeAreaInset || {}, csa = tg?.contentSafeAreaInset || {};
  const root = document.documentElement.style;
  root.setProperty('--tg-top', `${(sa.top || 0) + (csa.top || 0)}px`);
  root.setProperty('--tg-bottom', `${(sa.bottom || 0) + (csa.bottom || 0)}px`);
}

async function boot() {
  if (tg) {
    tg.ready(); tg.expand();
    try { tg.setHeaderColor('#0F1115'); tg.setBackgroundColor('#0F1115'); tg.setBottomBarColor?.('#0F1115'); } catch { /* old client */ }
    syncSafeArea();
    try { tg.onEvent('safeAreaChanged', syncSafeArea); tg.onEvent('contentSafeAreaChanged', syncSafeArea); } catch { /* old client */ }
    try { tg.disableVerticalSwipes?.(); } catch { /* old client */ }
    tg.BackButton?.onClick(goBack);
  }
  const params = new URLSearchParams(location.search);
  const startParam = tg?.initDataUnsafe?.start_param || '';
  try {
    state.me = await api.me();
  } catch (e) {
    await loadLang(tg?.initDataUnsafe?.user?.language_code || 'uz');
    $('#view').innerHTML = `<div class="card hero mt2"><div class="hero-art">${art.giftBox}</div><h2>RentaGift</h2><p>${esc(errText(e))}</p></div>`;
    hideSplash();
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
  if (state.tab === 'rentals' && params.get('tab') === 'rentals' && !orderId) state.tab = 'activity';
  await render();
  hideSplash();
  if (state.me.subscribe?.length) subscribeGate(state.me.subscribe);
  else if (state.me.channel_promo) {
    const show = () => setTimeout(() => channelPromo(state.me.channel_promo), 450);
    if (!$('#splash') || window.__splashDone) show(); else window.addEventListener('splash:done', show, { once: true });
  }
  if (startParam.startsWith('g_')) api.gift(startParam.slice(2)).then(giftSheet).catch(e => toast(errText(e), true));
}

// Never leave the user stuck on the splash: hide it even if boot fails or hangs.
boot().catch((e) => { console.error(e); hideSplash(); });
setTimeout(hideSplash, 15000);
