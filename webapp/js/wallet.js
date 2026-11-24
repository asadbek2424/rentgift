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
      <p class="note warn">${h.esc(t('wallet.exact', { amount: money(top.amount_uzs), add: top.unique_add_uzs }))}</p>
      <p class="note" style="color:#6fe39a">🤖 ${h.esc(t('wallet.auto'))}</p>
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

// ------------------------------------------------------------------ Stars / Premium
function recipientBox(h, kind) {
  return `<div class="card"><div class="section-title" style="margin-top:0"><span class="n-dot">1</span>${h.esc(t('stars.to'))}</div>
    <div class="recip"><input class="input" id="rcp" placeholder="@username" autocomplete="off" autocapitalize="off">
      <button class="btn small secondary" id="rcp-check">${h.esc(t('stars.check'))}</button></div>
    <div class="recip-row"><button class="chip" id="rcp-me">${h.esc(t('stars.me'))}</button><span id="rcp-found" class="found"></span></div></div>`;
}

function bindRecipient(view, h, kind, onChange) {
  const input = $('#rcp', view), found = $('#rcp-found', view);
  let ok = null, seq = 0;
  const check = async () => {
    const value = input.value.trim();
    ok = null; onChange(null);
    if (!value) { found.textContent = ''; return; }
    const mine = ++seq;
    found.className = 'found'; found.textContent = '…';
    try {
      const r = await api.recipient(kind, value);
      if (mine !== seq) return;
      ok = r; found.className = 'found ok'; found.textContent = t('stars.found', { name: r.name }); onChange(r);
    } catch (e) { if (mine === seq) { found.className = 'found bad'; found.textContent = h.errText(e); } }
  };
  $('#rcp-check', view).onclick = check;
  input.addEventListener('change', check);
  input.addEventListener('input', () => { ok = null; found.textContent = ''; onChange(null); });
  $('#rcp-me', view).onclick = () => {
    const me = h.state.me.user.username;
    if (!me) { h.toast(t('stars.no_username'), true); return; }
    input.value = '@' + me; check();
  };
  return () => ok;
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

export async function starsView(view, h) {
  const seg = h.state.starsSeg || 'stars';
  const balance = h.state.me.user.balance_uzs || 0;
  view.innerHTML = `<div class="skeleton" style="height:160px"></div><div class="skeleton mt" style="height:260px"></div>`;
  let info;
  try { info = seg === 'stars' ? await api.stars() : await api.premium(); }
  catch (e) { view.innerHTML = `<div class="empty">${h.esc(h.errText(e))}</div>`; return; }
  if (h.state.tab !== 'stars' || h.state.view || (h.state.starsSeg || 'stars') !== seg) return;
  const hero = seg === 'stars'
    ? `<div class="star-hero"><div><h2>${h.esc(t('stars.title'))}</h2><p>${h.esc(t('stars.subtitle'))}</p>
        <div class="wallet-label">${h.esc(t('stars.your_balance'))}</div><div class="wallet-sum">${money(balance)}</div>
        <small>${h.esc(t('stars.rate', { v: Number(info.per_star_uzs).toLocaleString('ru-RU', { maximumFractionDigits: 1 }) }))}</small>
        <button class="btn small mt" id="topup">${h.esc(t('stars.topup'))}</button></div><div class="star-art">${art.star || sm(icons.star, 90)}</div></div>`
    : `<div class="star-hero premium"><div><h2>${h.esc(t('stars.premium_title'))}</h2><p>${h.esc(t('stars.premium_sub'))}</p>
        <div class="wallet-label">${h.esc(t('stars.your_balance'))}</div><div class="wallet-sum">${money(balance)}</div>
        <button class="btn small mt" id="topup">${h.esc(t('stars.topup'))}</button></div><div class="star-art">${art.star || sm(icons.star, 90)}</div></div>`;
  const picker = seg === 'stars'
    ? `<div class="card"><div class="section-title" style="margin-top:0"><span class="n-dot">2</span>${h.esc(t('stars.how_many'))}</div>
        <div class="packs">${info.packs.map(p => `<button class="pack" data-q="${p.quantity}"><span>⭐</span><b>${Number(p.quantity).toLocaleString('ru-RU')}</b><small>${money(p.price_uzs)}</small></button>`).join('')}</div>
        <div class="input-sum mt"><input class="input" id="qty" inputmode="numeric" placeholder="${h.esc(t('stars.other'))}"><span>Stars</span></div>
        <p class="note">${h.esc(t('stars.min_max', { min: info.min, max: Number(info.max).toLocaleString('ru-RU') }))}</p></div>`
    : `<div class="card"><div class="section-title" style="margin-top:0"><span class="n-dot">2</span>${h.esc(t('stars.plan'))}</div>
        <div class="plans">${info.plans.map(p => `<button class="plan" data-m="${p.months}"><span class="radio"></span><b>${h.esc(t('stars.months', { n: p.months }))}</b><em>${money(p.price_uzs)}</em></button>`).join('')}</div></div>`;
  view.innerHTML = hero + recipientBox(h, seg) + picker
    + `<button class="btn mt" id="buy" disabled>${h.esc(t('stars.choose'))}</button>`
    + `<div class="section-title">${h.esc(t('stars.orders'))}</div><div id="plist"><div class="skeleton" style="height:70px"></div></div>`;
  $('#topup', view).onclick = () => h.openView('balance');
  let qty = 0, price = 0, quoteSeq = 0;
  const buy = $('#buy', view);
  const getRecipient = bindRecipient(view, h, seg, () => paint());
  function paint() {
    const r = getRecipient();
    if (!qty || !price) { buy.disabled = true; buy.textContent = t('stars.choose'); return; }
    buy.textContent = t(seg === 'stars' ? 'stars.send' : 'stars.buy', { amount: money(price) });
    buy.disabled = !r;
  }
  if (seg === 'stars') {
    const qInput = $('#qty', view);
    const quote = async q => {
      qty = q; price = 0; paint();
      view.querySelectorAll('[data-q]').forEach(b => b.classList.toggle('active', Number(b.dataset.q) === q));
      if (q < info.min || q > info.max) return;
      const pack = info.packs.find(p => p.quantity === q);
      if (pack) price = pack.price_uzs;
      paint();
      const mine = ++quoteSeq;
      try { const r = await api.starsQuote(q); if (mine === quoteSeq) { price = r.price_uzs; paint(); } }
      catch (e) { if (mine === quoteSeq) h.toast(h.errText(e), true); }
    };
    view.querySelectorAll('[data-q]').forEach(b => b.onclick = () => { qInput.value = ''; h.haptic(); quote(Number(b.dataset.q)); });
    let timer;
    qInput.oninput = () => { clearTimeout(timer); timer = setTimeout(() => quote(num(qInput.value)), 450); };
  } else {
    view.querySelectorAll('[data-m]').forEach(b => b.onclick = () => {
      qty = Number(b.dataset.m); price = info.plans.find(p => p.months === qty).price_uzs; h.haptic();
      view.querySelectorAll('[data-m]').forEach(x => x.classList.toggle('active', x === b)); paint();
    });
  }
  buy.onclick = async () => {
    const r = getRecipient();
    if (!r || !qty) return;
    if ((h.state.me.user.balance_uzs || 0) < price) {
      h.toast(t('stars.low'), true); h.openView('balance'); return;
    }
    const what = seg === 'stars' ? `${qty} ⭐` : `Premium ${t('stars.months', { n: qty })}`;
    if (!await askConfirm(t('stars.confirm', { what, to: r.username, amount: money(price) }))) return;
    buy.disabled = true;
    try {
      await api.purchase(seg, r.username, qty);
      h.haptic('medium'); h.toast(t('stars.sent'));
      await refreshMe(h); h.render();
    } catch (e) {
      h.toast(h.errText(e), true); buy.disabled = false;
      if (e.code === 'low_balance') h.openView('balance');
    }
  };
  $('#plist', view).innerHTML = await purchasesList(h, seg);
  const pending = view.querySelector('.badge.blue');
  if (pending) {
    h.state.poll = setInterval(async () => {
      if (document.hidden || h.state.tab !== 'stars' || h.state.view) return;
      const box = $('#plist', view); if (box) box.innerHTML = await purchasesList(h, seg);
      if (!view.querySelector('.badge.blue')) { clearInterval(h.state.poll); refreshMe(h).then(() => h.renderTopbar()); }
    }, 5000);
  }
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
