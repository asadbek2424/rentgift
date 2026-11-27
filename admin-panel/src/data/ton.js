// TON Connect for signing rent / Stars / Premium transactions from the admin wallet (WALLET_MODE=tonconnect).
import { useEffect, useState } from 'react';
import { adminApi } from './api.js';

const TC_SRC = 'https://unpkg.com/@tonconnect/ui@2.0.9/dist/tonconnect-ui.min.js';
let instance = null;
let loading = null;
let info = null;   // {manifest_url, admin_wallet_raw, wallet_mode}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) return resolve();
    const el = document.createElement('script');
    el.src = src; el.onload = resolve; el.onerror = () => reject(new Error("TON Connect yuklanmadi"));
    document.head.append(el);
  });
}

export async function walletInfo() {
  if (!info) info = (await adminApi('/me')).app;
  return info;
}

export async function getTonConnect() {
  if (instance) return instance;
  if (!loading) {
    loading = (async () => {
      const app = await walletInfo();
      await loadScript(TC_SRC);
      instance = new window.TON_CONNECT_UI.TonConnectUI({ manifestUrl: app.manifest_url });
      await instance.connectionRestored;
      return instance;
    })().catch((e) => { loading = null; throw e; });
  }
  return loading;
}

export const shortAddr = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-6)}` : '');

export function walletMatches(tc) {
  const raw = tc?.account?.address?.toLowerCase();
  return !!raw && (!info?.admin_wallet_raw || raw === info.admin_wallet_raw.toLowerCase());
}

/** React hook: {account, ok, connect, disconnect, mode, ready} */
export function useWallet() {
  const [state, setState] = useState({ account: null, ok: false, mode: info?.wallet_mode || '', ready: false });
  useEffect(() => {
    let off = () => {};
    let alive = true;
    walletInfo().then((app) => {
      if (!alive) return;
      setState((s) => ({ ...s, mode: app.wallet_mode, ready: true }));
      if (app.wallet_mode === 'hot') return;
      getTonConnect().then((tc) => {
        const paint = () => alive && setState((s) => ({ ...s, account: tc.account, ok: walletMatches(tc) }));
        off = tc.onStatusChange(paint) || (() => {});
        paint();
      }).catch(() => {});
    }).catch(() => {});
    return () => { alive = false; try { off(); } catch { /* noop */ } };
  }, []);
  return {
    ...state,
    connect: async () => (await getTonConnect()).openModal(),
    disconnect: async () => (await getTonConnect()).disconnect(),
  };
}

/** Prepare → sign in the wallet → report the BOC. kind: 'order' | 'purchase'. Returns a status text. */
export async function signTx(kind, id) {
  const prepared = kind === 'purchase' ? await adminApi(`/purchases/${id}/prepare-tx`, { method: 'POST' })
    : await adminApi(`/orders/${id}/prepare-tx`, { method: 'POST' });
  if (prepared.hot) return '🔥 Hot hamyon tranzaksiyani o\'zi yubordi';
  const tc = await getTonConnect();
  if (!tc.account) { await tc.openModal(); throw new Error('Avval hamyonni ulang, keyin qayta bosing'); }
  if (!walletMatches(tc)) throw new Error("Boshqa hamyon ulangan — Marketapp token yaratilgan hamyonni ulang");
  const tx = prepared.transaction;
  const messages = tx.messages.map((m) => {
    const out = { address: m.address, amount: String(m.amount) };
    if (m.payload) out.payload = m.payload;
    if (m.stateInit) out.stateInit = m.stateInit;
    return out;
  });
  const now = Math.floor(Date.now() / 1000);
  const result = await tc.sendTransaction({ validUntil: Math.min(Number(tx.validUntil) || now + 300, now + 600), messages });
  if (kind === 'purchase') await adminApi(`/purchases/${id}/tx-sent`, { method: 'POST', body: { boc: result.boc } });
  else await adminApi(`/orders/${id}/tx-sent`, { method: 'POST', body: { boc: result.boc, wallet: tc.account.address } });
  return '✅ Tranzaksiya yuborildi — blokcheyn tasdig\'i kutilmoqda';
}

export const resetWalletInfo = () => { info = null; };
