// Admin panel: payment review, wallet signing (TON Connect), settings.
import { api } from './api.js';
import { icons } from './icons.js';
import { dateTime, money, t } from './i18n.js';

const $ = (sel, root = document) => root.querySelector(sel);
const tg = window.Telegram?.WebApp;
const TC_SRC = 'https://unpkg.com/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js';
let tonConnect = null;
let filter = 'review';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script'); el.src = src; el.onload = resolve; el.onerror = reject; document.head.append(el);
  });
}

async function getTonConnect(manifestUrl) {
  if (tonConnect) return tonConnect;
  await loadScript(TC_SRC);
  tonConnect = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl });
  await tonConnect.connectionRestored;
  return tonConnect;
}

const short = a => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : '');

export async function adminView(view, h) {
  const { state, esc, giftImage, statusBadge, toast, errText, render } = h;
  const app = state.me.app;
  const hot = app.wallet_mode === 'hot';
  view.innerHTML = `<div class="skeleton" style="height:90px"></div><div class="skeleton mt" style="height:300px"></div>`;
  let stats, data;
  try {
    [stats, data] = await Promise.all([api.admin.stats(), api.admin.orders(filter)]);
  } catch (e) { view.innerHTML = `<div class="empty">${esc(errText(e))}</div>`; return; }
  if (state.tab !== 'admin') return;

  const tabs = ['review', 'paid', 'sign', 'active', 'problem', 'all'];
  const chips = tabs.map(k => `<button class="chip ${k === filter ? 'active' : ''}" data-f="${k}">${esc(t(`admin.tab_${k}`))}${data.counts[k] ? ` · ${data.counts[k]}` : ''}</button>`).join('');

  const actions = o => {
    const b = (act, key, cls = 'secondary') => `<button class="btn small ${cls}" data-act="${act}" data-id="${o.id}">${esc(t(`admin.${key}`))}</button>`;
    switch (o.status) {
      case 'payment_review': return (o.has_receipt ? b('receipt', 'receipt') : '') + b('confirm-payment', 'btn_confirm', 'green') + b('reject-payment', 'btn_reject', 'danger') + b('cancel', 'btn_cancel', 'ghost');
      case 'awaiting_payment': return b('confirm-payment', 'btn_confirm', 'green') + b('cancel', 'btn_cancel', 'ghost');
      case 'paid': return b('sign', 'btn_rent', '') + b('refunded', 'btn_refunded') + b('cancel', 'btn_cancel', 'ghost');
      case 'connect_signing': return b('sign', 'btn_sign', '');
      case 'failed': return b('retry', 'btn_retry') + b('refunded', 'btn_refunded') + b('cancel', 'btn_cancel', 'ghost');
      default: return '';
    }
  };
  const card = o => {
    const u = o.user || {};
    const who = `${esc(u.name || o.user_id)}${u.username ? ` · @${esc(u.username)}` : ''}`;
    return `<div class="card admin-card" id="o-${o.id}">
      <div class="row"><div class="thumb" style="width:54px;height:54px;border-radius:14px;overflow:hidden;flex:none">${giftImage(o.image, o.nft_name)}</div>
        <div style="flex:1;min-width:0"><b>#${o.id} · ${esc(o.nft_name)}${o.kind === 'extend' ? ` <span class="accent">(+${esc(t('ext.label'))} #${o.parent_id})</span>` : ''}</b><div style="margin-top:5px">${statusBadge(o.status)}</div></div></div>
      <div class="meta">${esc(t('admin.user'))}: ${who}<br>${o.days} ${esc(t('common.days'))} · <b style="color:#fff">${money(o.amount_uzs)}</b> · ${esc(o.ton_total)} TON
        <br>${esc(t('admin.cost'))}: ${money(o.cost_uzs)} · ${esc(t('admin.profit'))}: <b style="color:#ffc27a">${money(o.profit_uzs)}</b>${o.actual_ton ? ` · tx ${esc(o.actual_ton)} TON` : ''}
        <br>${esc(dateTime(o.created_at))}${o.end_time ? ` → ${esc(dateTime(o.end_time))}` : ''}${o.error ? `<br><span style="color:#ff98a2">⚠ ${esc(o.error)}</span>` : ''}</div>
      <div class="receipt-box"></div>
      <div class="actions">${actions(o)}</div></div>`;
  };

  const walletCard = hot
    ? `<div class="card"><div class="kv"><span>${esc(t('admin.wallet'))}</span><b>${esc(t('admin.hot_mode'))}</b></div>
        <div class="kv"><span>Address</span><b style="font-size:12px">${esc(short(app.admin_wallet))}</b></div></div>`
    : `<div class="card"><div class="kv"><span>${esc(t('admin.wallet'))}</span><b id="w-addr" style="font-size:12px">—</b></div>
        <p class="note warn hidden" id="w-warn">${esc(t('admin.wrong_wallet'))}</p>
        <button class="btn secondary mt" id="w-btn">${icons.wallet.replace('<svg', '<svg width="18" height="18"')} ${esc(t('admin.connect_wallet'))}</button></div>`;

  const s = stats.settings;
  view.innerHTML = `
    <div class="stat-row"><div class="stat"><span>${esc(t('admin.revenue'))}</span><b>${money(stats.revenue_uzs)}</b></div>
      <div class="stat"><span>${esc(t('admin.profit_total'))}</span><b style="color:#ffc27a">${money(stats.profit_uzs)}</b></div>
      <div class="stat"><span>${esc(t('admin.current_rate'))} · 1 TON</span><b>${stats.rate ? money(stats.rate) : '—'}</b></div>
      <div class="stat"><span>USD</span><b>${stats.uzs_per_usd ? esc(t('admin.usd_rate', { v: Number(stats.uzs_per_usd).toLocaleString('ru-RU') })) : '—'}</b></div></div>
    ${walletCard}
    <div class="chips mt2">${chips}</div>
    <div id="orders">${data.items.length ? data.items.map(card).join('') : `<div class="empty">${esc(t('admin.empty'))}</div>`}</div>
    <div class="section-title">${esc(t('admin.pricing'))}</div>
    <div class="card form-grid">
      <p class="note" style="margin:0">${esc(t('admin.pricing_hint'))}</p>
      ${stats.observed_fee_percent ? `<div class="hint-box"><span>${esc(t('admin.observed_fee', { fee: stats.observed_fee_percent }))}</span>
        <button class="btn small secondary" id="use-fee">${esc(t('admin.use_observed'))}</button></div>` : ''}
      <div class="pair"><label>${esc(t('admin.fee'))}<input class="input" id="s-fee" inputmode="decimal" value="${esc(s.fee_percent)}"></label>
        <label>${esc(t('admin.markup'))}<input class="input" id="s-markup" inputmode="decimal" value="${esc(s.markup_percent)}"></label></div>
      <div class="pair"><label>${esc(t('admin.service_fee'))}<input class="input" id="s-service" inputmode="numeric" value="${esc(s.service_fee_uzs)}"></label>
        <label>${esc(t('admin.min_days'))}<input class="input" id="s-mindays" inputmode="numeric" value="${esc(s.min_rent_days)}"></label></div>
      <div class="pair"><label>${esc(t('admin.profit_fixed'))}<input class="input" id="s-fixed" inputmode="numeric" value="${esc(s.profit_fixed_uzs)}"></label>
        <label>${esc(t('admin.round_to'))}<input class="input" id="s-round" inputmode="numeric" value="${esc(s.round_to)}"></label></div>
      <div class="pair"><label>${esc(t('admin.rate_mode'))}<select class="input" id="s-mode"><option value="auto">${esc(t('admin.rate_auto'))}</option><option value="manual">${esc(t('admin.rate_manual'))}</option></select></label>
        <label>${esc(t('admin.manual_rate'))}<input class="input" id="s-rate" inputmode="decimal" value="${esc(s.manual_rate)}"></label></div>
      <div class="calc"><b>${esc(t('admin.calc'))}</b>
        <div class="pair mt"><label style="display:grid;gap:6px;font-size:12.5px;color:var(--muted)">${esc(t('admin.calc_input'))}<input class="input" id="c-ton" inputmode="decimal" value="0.05"></label>
          <label style="display:grid;gap:6px;font-size:12.5px;color:var(--muted)">${esc(t('admin.calc_days'))}<input class="input" id="c-days" inputmode="numeric" value="3"></label></div>
        <div id="calc-out" class="mt"></div></div>
    </div>
    <div class="section-title">${esc(t('admin.settings'))}</div>
    <div class="card form-grid">
      <label>${esc(t('admin.card_number'))}<input class="input" id="s-card" inputmode="numeric" value="${esc(s.card_number)}"></label>
      <label>${esc(t('admin.card_holder'))}<input class="input" id="s-holder" value="${esc(s.card_holder)}"></label>
      <label>${esc(t('admin.card_bank'))}<input class="input" id="s-bank" value="${esc(s.card_bank)}"></label>
    </div>
    <button class="btn mt" id="s-save">${esc(t('admin.save'))}</button>
    <div class="section-title">${esc(t('admin.stats'))}</div>
    <div class="card form-grid">
      <button class="btn secondary" id="do-backup">${esc(t('admin.backup'))}</button>
      <p class="note" style="margin:0">${esc(t('admin.broadcast_hint'))}</p>
    </div>`;
  $('#s-mode', view).value = s.rate_mode;

  view.querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; render(); });
  $('#s-save', view).onclick = async () => {
    try {
      await api.admin.settings({ markup_percent: $('#s-markup', view).value || '0', fee_percent: $('#s-fee', view).value || '0',
        profit_fixed_uzs: $('#s-fixed', view).value || '0', round_to: $('#s-round', view).value || '10',
        service_fee_uzs: $('#s-service', view).value || '0', min_rent_days: $('#s-mindays', view).value || '1',
        rate_mode: $('#s-mode', view).value, manual_rate: $('#s-rate', view).value || '0', card_number: $('#s-card', view).value,
        card_holder: $('#s-holder', view).value, card_bank: $('#s-bank', view).value });
      toast(t('admin.saved'));
      state.me = await api.me();
      state.gifts = []; state.giftsLoaded = false; state.collections = null;   // prices changed
    } catch (e) { toast(errText(e), true); }
  };

  $('#do-backup', view).onclick = async e => {
    e.target.disabled = true;
    try { const r = await api.admin.backup(); toast(t('admin.backup_done', { file: r.file })); }
    catch (err) { toast(errText(err), true); }
    e.target.disabled = false;
  };

  // ---- live price calculator (same formula as the server)
  const numVal = id => Number(($(id, view)?.value || '0').replace(',', '.').replace(/\s/g, '')) || 0;
  const calc = () => {
    const base = numVal('#c-ton'), fee = numVal('#s-fee'), p = numVal('#s-markup'), fixed = numVal('#s-fixed');
    const service = numVal('#s-service'), days = Math.max(1, Math.round(numVal('#c-days')) || 1);
    const round = Math.max(1, numVal('#s-round') || 10);
    const rate = $('#s-mode', view).value === 'manual' ? numVal('#s-rate') : Number(stats.rate || 0);
    const usd = Number(stats.uzs_per_usd || 0);
    const costTonDay = base * (1 + fee / 100), costUzs = costTonDay * rate * days;
    const perDay = Math.ceil((costTonDay * rate * (1 + p / 100) + fixed) / round) * round;
    const rent = perDay * days, client = rent + service;
    const fmtUsd = v => (usd ? ` · $${(v / usd).toFixed(2)}` : '');
    $('#calc-out', view).innerHTML = rate ? `
      <div class="kv"><span>${esc(t('admin.calc_base'))}</span><b>${base} TON · ${money(Math.round(base * rate))}${fmtUsd(base * rate)}</b></div>
      <div class="kv"><span>${esc(t('admin.calc_fee', { p: fee }))}</span><b>+${(costTonDay - base).toFixed(4).replace(/\.?0+$/, '')} TON</b></div>
      <div class="kv"><span>${esc(t('price.rent', { per: money(perDay), days }))}</span><b>${money(rent)}</b></div>
      <div class="kv"><span>${esc(t('price.fee'))}</span><b>${money(service)}</b></div>
      <div class="kv total"><span>${esc(t('admin.calc_client'))}</span><b>${money(client)}${fmtUsd(client)}</b></div>
      <div class="kv"><span>${esc(t('admin.calc_cost'))}</span><b>${money(Math.round(costUzs))}</b></div>
      <div class="kv profit"><span>${esc(t('admin.calc_profit'))}</span><b>+${money(Math.round(client - costUzs))}</b></div>` : `<p class="note">—</p>`;
  };
  ['#c-ton', '#c-days', '#s-fee', '#s-markup', '#s-fixed', '#s-service', '#s-round', '#s-rate'].forEach(id => $(id, view)?.addEventListener('input', calc));
  $('#s-mode', view).addEventListener('change', calc);
  $('#use-fee', view)?.addEventListener('click', () => { $('#s-fee', view).value = stats.observed_fee_percent; calc(); });
  calc();

  // ---- wallet
  let tc = null;
  const walletOk = () => {
    const raw = tc?.account?.address?.toLowerCase();
    return !!raw && (!app.admin_wallet_raw || raw === app.admin_wallet_raw.toLowerCase());
  };
  const paintWallet = () => {
    if (hot || !$('#w-addr', view)) return;
    const raw = tc?.account?.address;
    $('#w-addr', view).textContent = raw ? short(raw) : '—';
    $('#w-warn', view).classList.toggle('hidden', !raw || walletOk());
    $('#w-btn', view).innerHTML = raw ? esc(t('admin.disconnect')) : `${icons.wallet.replace('<svg', '<svg width="18" height="18"')} ${esc(t('admin.connect_wallet'))}`;
  };
  if (!hot) {
    getTonConnect(app.manifest_url).then(instance => { tc = instance; tc.onStatusChange(paintWallet); paintWallet(); })
      .catch(() => { /* reported when the admin presses the button */ });
    $('#w-btn', view).onclick = async () => {
      if (!tc) { try { tc = await getTonConnect(app.manifest_url); tc.onStatusChange(paintWallet); } catch { toast(t('error.wallet'), true); return; } }
      if (tc.account) await tc.disconnect(); else await tc.openModal();
    };
  }

  const sign = async id => {
    const prepared = await api.admin.prepare(id);
    if (prepared.hot) return;
    if (!tc) tc = await getTonConnect(app.manifest_url);
    if (!tc.account) { await tc.openModal(); toast(t('admin.connect_wallet')); return 'retry'; }
    if (!walletOk()) { toast(t('admin.wrong_wallet'), true); return 'retry'; }
    const tx = prepared.transaction;
    const messages = tx.messages.map(m => {
      const out = { address: m.address, amount: String(m.amount) };
      if (m.payload) out.payload = m.payload;
      if (m.stateInit) out.stateInit = m.stateInit;
      return out;
    });
    const validUntil = Math.min(Number(tx.validUntil) || Math.floor(Date.now() / 1000) + 300, Math.floor(Date.now() / 1000) + 600);
    const result = await tc.sendTransaction({ validUntil, messages });
    await api.admin.sent(id, result.boc, tc.account.address);
    toast(t('admin.tx_sent'));
  };

  view.querySelectorAll('[data-act]').forEach(btn => btn.onclick = async () => {
    const { act, id } = btn.dataset;
    if (act === 'receipt') {
      const box = $(`#o-${id} .receipt-box`, view);
      try { const url = await api.admin.receiptBlob(id); box.innerHTML = `<img class="receipt-img" src="${url}" alt="">`; btn.remove(); }
      catch (e) { toast(errText(e), true); }
      return;
    }
    const confirmKey = act === 'cancel' ? 'admin.confirm_cancel' : act === 'refunded' ? 'admin.confirm_refunded' : null;
    if (confirmKey) {
      const ok = await new Promise(res => (tg?.showConfirm ? tg.showConfirm(t(confirmKey), res) : res(confirm(t(confirmKey)))));
      if (!ok) return;
    }
    btn.disabled = true;
    try {
      if (act === 'sign') await sign(Number(id));
      else await api.admin.action(id, act);
      render();
    } catch (e) {
      toast(errText(e) + (e.detail ? ` (${e.detail})` : ''), true);
      btn.disabled = false;
    }
  });

  if (state.adminFocus) {
    const el = $(`#o-${state.adminFocus}`, view);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    else if (filter !== 'all') { filter = 'all'; state.adminFocus = state.adminFocus; return render(); }
    state.adminFocus = null;
  }
}
