// Balance (top-ups), Stars / Premium, referral and top rating screens.
import { api } from './api.js';
import { art, icons } from './icons.js';
import { clock, dateTime, money, t } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const tg = window.Telegram?.WebApp;
const num = v => Number(String(v ?? '').replace(/[^\d]/g, '')) || 0;
const sm = (svg, size = 18) => svg.replace('<svg', `<svg width="${size}" height="${size}"`);

async function askConfirm(text) {
  return new Promise(res => (tg?.showConfirm ? tg.showConfirm(text, res) : res(confirm(text))));
}

async function refreshMe(h) {
  try { h.state.me = await api.me(); } catch { /* keep */ }
}

// ------------------------------------------------------------------ balance
function balanceCard(h, balance, extra = '') {
  return `<div class="wallet-card"><div class="wallet-top">${sm(icons.wallet, 20)}<b>${h.esc(h.state.me.app.name)}</b><span class="chip-mini"></span></div>
    <div class="wallet-label">${h.esc(t('wallet.current'))}</div><div class="wallet-sum">${money(balance)}</div>
    <p>${h.esc(t('wallet.card_note'))}</p>${extra}</div>`;
}

function features(h) {
  const f = (icon, k) => `<div class="feat">${sm(icon, 18)}<b>${h.esc(t(`wallet.f_${k}`))}</b><span>${h.esc(t(`wallet.f_${k}_d`))}</span></div>`;
  return `<div class="feats">${f(icons.bolt || icons.star, 'fast')}${f(icons.shield, 'safe')}${f(icons.wallet, 'one')}</div>`;
}

function ledgerRow(h, r) {
  const plus = r.delta_uzs > 0;
  return `<div class="ledger"><div><b>${h.esc(t(`wallet.k_${r.kind}`))}${r.ref_id ? ` #${r.ref_id}` : ''}</b><span>${h.esc(dateTime(r.created_at))}</span></div>
    <b class="${plus ? 'plus' : 'minus'}">${plus ? '+' : '−'}${money(Math.abs(r.delta_uzs))}</b></div>`;
}

export async function balanceView(view, h) {
  view.innerHTML = `<div class="skeleton" style="height:170px"></div><div class="skeleton mt" style="height:220px"></div>`;
  let data;
  try { data = await api.balance(); } catch (e) { view.innerHTML = `<div class="empty">${h.esc(h.errText(e))}</div>`; return; }
  if (h.state.view?.name !== 'balance') return;
  h.state.me.user.balance_uzs = data.balance_uzs;
  const open = data.topups.find(x => x.status === 'pending');
  const app = h.state.me.app;
  const presets = [20000, 50000, 100000, 200000, 500000].filter(v => v >= app.topup_min && v <= app.topup_max);
  let amount = presets[0] || app.topup_min;
  view.innerHTML = balanceCard(h, data.balance_uzs)
    + (open ? `<button class="card resume" id="resume"><div><b>${h.esc(t('wallet.waiting'))}</b><span>${money(open.amount_uzs)} · #${open.id}</span></div>${icons.chevronRight}</button>` : '')
    + `<div class="card"><div class="section-title" style="margin-top:0"><span class="n-dot">1</span>${h.esc(t('wallet.choose'))}</div>
      <div class="amounts">${presets.map(v => `<button class="amount ${v === amount ? 'active' : ''}" data-amt="${v}">${Number(v).toLocaleString('ru-RU')}</button>`).join('')}</div>
      <div class="input-sum"><input class="input" id="amt" inputmode="numeric" value="${amount}"><span>${h.esc(t('common.sum'))}</span></div>
      <p class="note">${h.esc(t('wallet.limits', { min: money(app.topup_min), max: money(app.topup_max) }))}</p>
      <button class="btn mt" id="go">${h.esc(t('wallet.create', { amount: money(amount) }))}</button></div>`
    + features(h)
    + `<div class="section-title">${h.esc(t('wallet.history'))}</div>
      <div class="card" style="padding:4px 16px">${data.history.length ? data.history.map(r => ledgerRow(h, r)).join('') : `<p class="note center">${h.esc(t('wallet.empty'))}</p>`}</div>`;
  const input = $('#amt', view), go = $('#go', view);
  const sync = () => {
    amount = num(input.value);
    view.querySelectorAll('[data-amt]').forEach(b => b.classList.toggle('active', Number(b.dataset.amt) === amount));
    go.textContent = t('wallet.create', { amount: money(amount) });
    go.disabled = amount < app.topup_min || amount > app.topup_max;
  };
  view.querySelectorAll('[data-amt]').forEach(b => b.onclick = () => { input.value = b.dataset.amt; h.haptic(); sync(); });
  input.oninput = sync;
  $('#resume', view)?.addEventListener('click', () => h.openView('topup', { id: open.id }));
  go.onclick = async () => {
    go.disabled = true;
    try { const top = await api.topup(amount); h.haptic('medium'); h.openView('topup', { id: top.id }); }
    catch (e) { h.toast(h.errText(e), true); go.disabled = false; }
  };
  sync();
}

export async function topupView(view, h, id) {
  view.innerHTML = `<div class="skeleton" style="height:320px"></div>`;
  let top;
  try { top = await api.topupGet(id); } catch (e) { view.innerHTML = `<div class="empty">${h.esc(h.errText(e))}</div>`; return; }
  if (h.state.view?.id !== id) return;
  const card = h.state.me.card || {};
  if (top.status === 'paid') {
    await refreshMe(h);
    view.innerHTML = `<div class="card hero"><div class="hero-art">${art.giftBox}</div><h2>${h.esc(t('wallet.credited', { amount: money(top.amount_uzs) }))}</h2>
      <p>${h.esc(t('wallet.current'))}: <b>${money(h.state.me.user.balance_uzs)}</b></p>
      <button class="btn mt2" id="to-stars">${h.esc(t('nav.stars'))}</button><button class="btn secondary mt" id="to-cat">${h.esc(t('rentals.browse'))}</button></div>`;
    $('#to-stars', view).onclick = () => h.switchTab('stars');
    $('#to-cat', view).onclick = () => h.switchTab('catalog');
    h.renderTopbar();
    return;
  }
  if (top.status !== 'pending') {
    view.innerHTML = `<div class="card center"><p style="margin:0">${h.esc(t(`wallet.st_${top.status}`))} · ${money(top.amount_uzs)}</p>
      <button class="btn mt" id="again">${h.esc(t('wallet.topup'))}</button></div>`;
    $('#again', view).onclick = () => h.openView('balance');
    return;
  }
  view.innerHTML = `<div class="card">
      <div class="timer-label">${h.esc(t('pay.time_left'))}</div><div class="timer" data-until="${h.esc(top.expires_at)}">--:--</div>
      <div class="section-title" style="margin-top:12px">${h.esc(t('wallet.pay_title'))}</div>
      <div class="copy-line"><div><div class="label">${h.esc(t('pay.amount'))}</div><div class="value">${money(top.amount_uzs)}</div></div>
        <button class="copy-btn" data-copy="${top.amount_uzs}">${h.esc(t('common.copy'))}</button></div>
      <div class="copy-line"><div><div class="label">${h.esc(t('pay.card'))}</div><div class="value">${h.esc(card.number || '—')}</div></div>
        <button class="copy-btn" data-copy="${h.esc((card.number || '').replace(/\s/g, ''))}">${h.esc(t('common.copy'))}</button></div>
      ${card.holder ? `<div class="kv mt"><span>${h.esc(t('pay.holder'))}</span><b>${h.esc(card.holder)}</b></div>` : ''}
      ${card.bank ? `<div class="kv"><span>${h.esc(t('pay.bank'))}</span><b>${h.esc(card.bank)}</b></div>` : ''}
      ${h.exactBox(top.amount_uzs, top.unique_add_uzs || 0)}
      <div class="waiting"><div class="spinner"></div><p>${h.esc(t('wallet.waiting'))}</p></div>
      <button class="btn ghost" id="cancel">${h.esc(t('wallet.cancel'))}</button></div>`;
  view.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => h.copy(b.dataset.copy));
  $('#cancel', view).onclick = async () => {
    if (!await askConfirm(t('wallet.cancel_confirm'))) return;
    try { await api.topupCancel(id); h.openView('balance'); } catch (e) { h.toast(h.errText(e), true); }
  };
  const tick = () => view.querySelectorAll('[data-until]').forEach(el => { el.textContent = clock((new Date(el.dataset.until) - Date.now()) / 1000); });
  tick(); h.state.timers.push(setInterval(tick, 1000));
  h.state.poll = setInterval(async () => {
    if (document.hidden || h.state.view?.id !== id) return;
    try { const fresh = await api.topupGet(id); if (fresh.status !== 'pending') { h.haptic('medium'); h.render(); } } catch { /* offline */ }
  }, 4000);
}

function purchaseRow(h, p) {
  const what = p.kind === 'stars' ? `${Number(p.quantity).toLocaleString('ru-RU')} ⭐` : `Premium · ${t('stars.months', { n: p.quantity })}`;
  const color = { done: 'green', refunded: '', failed: 'orange' }[p.status] ?? 'blue';
  return `<div class="row-card static"><div class="thumb icon-thumb ${p.kind}">${sm(icons.star, 24)}</div>
    <div class="grow"><div class="title">${h.esc(what)} → @${h.esc(p.recipient)}</div><div class="sub">#${p.id} · ${money(p.price_uzs)} · ${h.esc(dateTime(p.created_at))}</div>
    <div style="margin-top:6px"><span class="badge ${color}">${h.esc(t(`stars.st_${p.status}`))}</span></div></div></div>`;
}

async function purchasesList(h, kind) {
  try {
    const items = (await api.purchases()).items.filter(p => p.kind === kind);
    return items.length ? `<div class="list">${items.map(p => purchaseRow(h, p)).join('')}</div>` : `<p class="note center">${h.esc(t('stars.empty'))}</p>`;
  } catch { return ''; }
}

// ------------------------------------------------------------------ Stars / Premium (mockup: "Kimga?" chip, radio packs, sticky CTA)
const STAR_ICON = n => {
  const one = '<path d="M12 2.8 14.7 8.4l6.1.8-4.5 4.2 1.1 6-5.4-2.9-5.4 2.9 1.1-6-4.5-4.2 6.1-.8Z"/>';
  const g = (x, y, s, o = 1) => `<g transform="translate(${x} ${y}) scale(${s})" opacity="${o}">${one}</g>`;
  const body = n >= 500 ? g(-2, 3, .8, .55) + g(6, 3, .8, .75) + g(1, -1, 1) : n >= 100 ? g(4, 2, .85, .7) + g(-1, 0, 1) : g(0, 0, 1);
  return `<svg class="pk-star" viewBox="-2 -2 30 28"><defs><linearGradient id="pkg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe27a"/><stop offset="1" stop-color="#f5a10b"/></linearGradient></defs>
    <g fill="url(#pkg)" stroke="#fff3c4" stroke-width=".8" stroke-linejoin="round">${body}</g></svg>`;
};
const MAIN_PACKS = [50, 100, 500];

function whoBox(h) {
  return `<div class="sp-label">${h.esc(t('stars.who'))}</div><div id="who"></div>`;
}

// Recipient: defaults to the user himself (if he has a username); X switches to an @username input with live check.
function bindWho(view, h, kind, onChange) {
  const box = $('#who', view);
  const me = h.state.me.user;
  let current = null, seq = 0;
  const chip = r => {
    const self = me.username && r.username.toLowerCase() === me.username.toLowerCase();
    const initial = h.esc((r.name || r.username || '?').trim()[0]?.toUpperCase() || '?');
    const okUrl = u => /^(https:\/\/|data:image\/)/.test(u || '');
    const src = okUrl(r.photo) ? r.photo : self && okUrl(me.photo_url) ? me.photo_url : '';
    const ava = src ? `<img src="${h.esc(src)}" alt="" referrerpolicy="no-referrer" data-i="${initial}" onerror="this.parentNode.textContent=this.dataset.i">`
      : `<span>${initial}</span>`;
    box.innerHTML = `<div class="who-chip"><span class="who-ava">${ava}</span><b>${h.esc(r.name || '@' + r.username)}</b>
      <small>${self ? h.esc(t('stars.you')) : '@' + h.esc(r.username)}</small><button class="who-x" aria-label="change">${icons.close}</button></div>`;
    $('.who-x', box).onclick = () => { h.haptic(); input(''); };
  };
  const input = (value) => {
    current = null; onChange(null);
    box.innerHTML = `<div class="who-input">${icons.search}<input id="rcp" placeholder="${h.esc(t('stars.enter_user'))}" autocomplete="off" autocapitalize="off" value="${h.esc(value)}"></div>
      <p class="who-msg" id="rcp-msg"></p>`;
    const el = $('#rcp', box), msg = $('#rcp-msg', box);
    let timer;
    const run = async () => {
      const v = el.value.trim().replace(/^@/, '');
      if (v.length < 4) { msg.textContent = ''; return; }
      const mine = ++seq; msg.className = 'who-msg'; msg.textContent = t('stars.checking');
      try {
        const r = await api.recipient(kind, v);
        if (mine !== seq) return;
        current = r; chip(r); onChange(r);
      } catch (e) { if (mine === seq) { msg.className = 'who-msg bad'; msg.textContent = h.errText(e); } }
    };
    el.oninput = () => { clearTimeout(timer); timer = setTimeout(run, 600); };
    el.onkeydown = e => { if (e.key === 'Enter') { clearTimeout(timer); run(); } };
    if (!value) setTimeout(() => el.focus(), 50);
  };
  if (me.username) {
    // optimistic chip for yourself, then confirm with Fragment
    current = { username: me.username, name: [me.first_name, me.last_name].filter(Boolean).join(' ') || me.username, photo: '' };
    chip(current); onChange(current);
    api.recipient(kind, me.username).then(r => { if (current?.username === me.username) { current = { ...current, ...r }; chip(current); onChange(current); } })
      .catch(e => { if (current?.username === me.username) { input('@' + me.username); $('#rcp-msg', box).className = 'who-msg bad'; $('#rcp-msg', box).textContent = h.errText(e); } });
  } else input('');
  return () => current;
}

export async function starsView(view, h) {
  const seg = h.state.starsSeg || 'stars';
  const stillHere = () => h.state.tab === 'catalog' && h.state.category === 'stars' && !h.state.view && (h.state.starsSeg || 'stars') === seg;
  view.innerHTML = `<div class="skeleton" style="height:90px"></div><div class="skeleton mt" style="height:300px"></div>`;
  let info;
  try { info = seg === 'stars' ? await api.stars() : await api.premium(); }
  catch (e) { view.innerHTML = `<div class="empty"><p>${h.esc(h.errText(e))}</p><button class="btn secondary small" id="retry" style="margin:0 auto">${h.esc(t('common.retry'))}</button></div>`;
    $('#retry', view).onclick = () => starsView(view, h); return; }
  if (!stillHere()) return;
  const balance = h.state.me.user.balance_uzs || 0;
  const fmtN = n => Number(n).toLocaleString('ru-RU').replace(/,/g, ' ');
  const row = (key, value, title, price, extra = '', badge = '') => `<button class="pk-row" data-${key}="${value}">
    <span class="radio"></span>${extra}<b>${title}</b>${badge}<em>${h.esc(money(price))}</em></button>`;

  let body;
  if (seg === 'stars') {
    const main = info.packs.filter(p => MAIN_PACKS.includes(p.quantity));
    const more = info.packs.filter(p => !MAIN_PACKS.includes(p.quantity));
    body = `<div class="sp-head"><h2>${h.esc(t('stars.page_title'))} <span class="sp-emoji">${STAR_ICON(1)}</span></h2><p>${h.esc(t('stars.page_sub'))}</p></div>
      ${whoBox(h)}
      <div class="sp-label">${h.esc(t('stars.pick_pack'))}</div>
      <div class="pk-list">${main.map(p => row('q', p.quantity, `${fmtN(p.quantity)} Stars`, p.price_uzs, STAR_ICON(p.quantity))).join('')}
        <div id="more-packs" hidden>${more.map(p => row('q', p.quantity, `${fmtN(p.quantity)} Stars`, p.price_uzs, STAR_ICON(p.quantity))).join('')}</div>
        <button class="pk-more" id="toggle-more">${h.esc(t('stars.all_packs'))} ${icons.chevronDown}</button>
        <button class="pk-more" id="toggle-custom">${h.esc(t('stars.custom'))} ${icons.chevronDown}</button>
        <div id="custom" hidden><div class="pk-custom ${''}"><input class="input" id="qty" inputmode="numeric" placeholder="${h.esc(t('stars.min_max', { min: info.min, max: fmtN(info.max) }))}"><span>Stars</span></div>
          <p class="who-msg" id="qty-price"></p></div></div>`;
  } else {
    const base = info.plans.find(p => p.months === 3);
    const disc = p => (base && p.months > 3 ? Math.round((1 - (p.price_uzs / p.months) / (base.price_uzs / 3)) * 100) : 0);
    const best = Math.max(0, ...info.plans.map(disc));
    body = `<div class="sp-head"><h2>${h.esc(t('stars.prem_title'))} <span class="sp-emoji prem">${icons.star}</span></h2><p>${h.esc(t('stars.prem_sub'))}</p></div>
      ${whoBox(h)}
      <div class="sp-label">${h.esc(t('stars.plan'))}${best ? ` <span class="pk-badge">-${best}%</span>` : ''}</div>
      <div class="pk-list">${info.plans.map(p => row('m', p.months, h.esc(t('stars.months', { n: p.months })), p.price_uzs, '',
        disc(p) > 0 ? `<span class="pk-badge">-${disc(p)}%</span>` : `<small class="pk-sub">${h.esc(t('stars.per_month', { amount: money(Math.round(p.price_uzs / p.months)) }))}</small>`)).join('')}</div>`;
  }
  view.innerHTML = `<div class="sp-wrap">${body}
    <p class="sp-bal">${h.esc(t('stars.balance_line', { amount: money(balance) }))} · <button class="link-btn" id="topup">${h.esc(t('stars.topup_link'))}</button></p>
    <button class="link-btn sp-hist" id="hist">${h.esc(t('stars.history'))}</button><div id="plist" hidden></div></div>
    <div class="sp-cta"><button class="btn" id="buy" disabled>${h.esc(t('stars.choose'))}</button></div>`;

  let qty = 0, price = 0, quoteSeq = 0, recipient = null;
  const buy = $('#buy', view);
  const paint = () => {
    if (!qty || !price) { buy.disabled = true; buy.textContent = t('stars.choose'); return; }
    const self = recipient && h.state.me.user.username && recipient.username.toLowerCase() === h.state.me.user.username.toLowerCase();
    buy.textContent = seg === 'stars' ? t('stars.cta', { n: fmtN(qty), amount: money(price) })
      : t(self ? 'stars.cta_self' : 'stars.cta_gift', { amount: money(price) });
    buy.disabled = !recipient;
  };
  bindWho(view, h, seg, r => { recipient = r; paint(); });
  const select = (attr, value) => view.querySelectorAll(`[data-${attr}]`).forEach(b => b.classList.toggle('active', Number(b.dataset[attr]) === value));

  if (seg === 'stars') {
    const qInput = $('#qty', view), qPrice = $('#qty-price', view);
    const pick = q => { qty = q; price = info.packs.find(p => p.quantity === q)?.price_uzs || 0; select('q', q); qInput.value = ''; qPrice.textContent = ''; h.haptic(); paint(); };
    view.querySelectorAll('[data-q]').forEach(b => b.onclick = () => pick(Number(b.dataset.q)));
    $('#toggle-more', view).onclick = e => { const m = $('#more-packs', view); m.hidden = !m.hidden; e.currentTarget.classList.toggle('open', !m.hidden); };
    $('#toggle-custom', view).onclick = e => { const c = $('#custom', view); c.hidden = !c.hidden; e.currentTarget.classList.toggle('open', !c.hidden); if (!c.hidden) qInput.focus(); };
    let timer;
    qInput.oninput = () => {
      clearTimeout(timer); select('q', -1); qty = 0; price = 0; paint();
      timer = setTimeout(async () => {
        const q = num(qInput.value);
        if (q < info.min || q > info.max) { qPrice.className = 'who-msg bad'; qPrice.textContent = q ? t('stars.min_max', { min: info.min, max: fmtN(info.max) }) : ''; return; }
        const mine = ++quoteSeq; qPrice.className = 'who-msg'; qPrice.textContent = t('stars.checking');
        try { const r = await api.starsQuote(q); if (mine === quoteSeq) { qty = q; price = r.price_uzs; qPrice.textContent = `${fmtN(q)} Stars = ${money(price)}`; paint(); } }
        catch (e) { if (mine === quoteSeq) { qPrice.className = 'who-msg bad'; qPrice.textContent = h.errText(e); } }
      }, 450);
    };
    pick(MAIN_PACKS.find(q => info.packs.some(p => p.quantity === q)) || info.packs[0]?.quantity);
  } else {
    const pick = m => { qty = m; price = info.plans.find(p => p.months === m).price_uzs; select('m', m); h.haptic(); paint(); };
    view.querySelectorAll('[data-m]').forEach(b => b.onclick = () => pick(Number(b.dataset.m)));
    if (info.plans[0]) pick(info.plans[0].months);
  }

  $('#topup', view).onclick = () => h.openView('balance');
  $('#hist', view).onclick = async () => {
    const box = $('#plist', view); box.hidden = !box.hidden;
    if (!box.hidden) box.innerHTML = await purchasesList(h, seg);
  };
  buy.onclick = async () => {
    const r = recipient;
    if (!r || !qty) return;
    if ((h.state.me.user.balance_uzs || 0) < price) { h.toast(t('stars.low'), true); h.openView('balance'); return; }
    const what = seg === 'stars' ? `${fmtN(qty)} ⭐` : `Premium ${t('stars.months', { n: qty })}`;
    if (!await askConfirm(t('stars.confirm', { what, to: r.username, amount: money(price) }))) return;
    buy.disabled = true;
    try {
      await api.purchase(seg, r.username, qty);
      h.haptic('medium'); h.toast(t('stars.sent'));
      await refreshMe(h); h.renderTopbar();
      const box = $('#plist', view); box.hidden = false; box.innerHTML = await purchasesList(h, seg);
      buy.disabled = false;
    } catch (e) {
      h.toast(h.errText(e), true); buy.disabled = false;
      if (e.code === 'low_balance') h.openView('balance');
    }
  };
}

// ------------------------------------------------------------------ referral / top
export async function referralView(view, h) {
  view.innerHTML = `<div class="skeleton" style="height:240px"></div>`;
  let r;
  try { r = await api.referral(); } catch (e) { view.innerHTML = `<div class="empty">${h.esc(h.errText(e))}</div>`; return; }
  view.innerHTML = `<div class="ref-hero">${sm(icons.users || icons.user, 34)}<h2>${h.esc(t('ref.title'))}</h2><p>${h.esc(t('ref.text', { p: r.percent }))}</p></div>
    <div class="stat-row"><div class="stat"><span>${h.esc(t('ref.invited'))}</span><b>${r.invited}</b></div>
      <div class="stat"><span>${h.esc(t('ref.earned'))}</span><b style="color:#ffc27a">${money(r.earned_uzs)}</b></div></div>
    <div class="card"><div class="label muted" style="font-size:13px">${h.esc(t('ref.link'))}</div>
      <div class="ref-link">${h.esc(r.link || '—')}</div>
      <div class="pair mt"><button class="btn secondary" id="copy">${h.esc(t('ref.copy'))}</button><button class="btn" id="share">${h.esc(t('ref.share'))}</button></div>
      <p class="note">${h.esc(t('ref.how'))}</p></div>`;
  $('#copy', view).onclick = () => r.link && h.copy(r.link);
  $('#share', view).onclick = () => {
    if (!r.link) return;
    const url = `https://t.me/share/url?url=${encodeURIComponent(r.link)}&text=${encodeURIComponent(t('ref.share_text'))}`;
    if (tg?.openTelegramLink) tg.openTelegramLink(url); else window.open(url, '_blank', 'noopener');
  };
}

export async function topView(view, h) {
  view.innerHTML = `<div class="skeleton" style="height:300px"></div>`;
  let data;
  try { data = await api.top(); } catch (e) { view.innerHTML = `<div class="empty">${h.esc(h.errText(e))}</div>`; return; }
  const medal = n => (n === 1 ? '🥇' : n === 2 ? '🥈' : n === 3 ? '🥉' : `#${n}`);
  view.innerHTML = `<div class="ref-hero gold">${sm(icons.trophy || icons.star, 34)}<h2>${h.esc(t('top.title'))}</h2>
      <p>${h.esc(data.me.rank ? t('top.you', { rank: data.me.rank }) : t('top.none'))}</p></div>
    <div class="card" style="padding:6px 14px">${data.items.length ? data.items.map(i => `<div class="rank ${i.me ? 'me' : ''}">
      <span class="pos">${medal(i.rank)}</span><b>${h.esc(i.name)}</b><em>${money(i.spent_uzs)}</em></div>`).join('')
      : `<p class="note center">${h.esc(t('top.empty'))}</p>`}</div>`;
}
