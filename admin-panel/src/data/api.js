// ============================================================
// GiftRent admin panel → bot backend (FastAPI)
//   /api/panel/*  — login, dashboard, users, activity log, broadcast
//   /api/admin/*  — orders, top-ups, Stars/Premium, pricing, settings, TON transactions
// Backend address: VITE_API_URL at build time (Vercel → Environment Variables),
// or ?api=... in the bot's /panel link, or the "Bot server manzili" field on the login page.
// ============================================================
import { useCallback, useEffect, useRef, useState } from 'react';

const SESSION_KEY = 'gr_admin_session';
const API_KEY = 'gr_admin_api';
const ADMIN_KEY = 'gr_admin_me';

const safe = (fn, d = null) => { try { return fn(); } catch { return d; } };

export const getApiBase = () => (safe(() => localStorage.getItem(API_KEY)) || import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
export const setApiBase = (url) => safe(() => (url ? localStorage.setItem(API_KEY, url.replace(/\/$/, '')) : localStorage.removeItem(API_KEY)));
export const getSession = () => safe(() => localStorage.getItem(SESSION_KEY));
export const getAdmin = () => safe(() => JSON.parse(localStorage.getItem(ADMIN_KEY) || 'null'));
export function setSession(session, admin) {
  safe(() => { localStorage.setItem(SESSION_KEY, session); localStorage.setItem(ADMIN_KEY, JSON.stringify(admin || null)); });
}
export function clearSession() {
  safe(() => { localStorage.removeItem(SESSION_KEY); localStorage.removeItem(ADMIN_KEY); });
}

export class ApiError extends Error {
  constructor(message, status, code) { super(message); this.status = status; this.code = code; }
}

// Error codes from the bot backend → readable Uzbek text.
const ERRORS = {
  auth: 'Sessiya tugadi, qayta kiring', bad_code: "Login, parol yoki kod noto'g'ri", too_many: "Ko'p urinish — biroz kuting",
  not_found: 'Topilmadi', order_not_found: 'Buyurtma topilmadi', bad_state: "Buyurtma holati o'zgargan — sahifani yangilang",
  generic: 'Xatolik yuz berdi', gift_unavailable: 'Gift endi ijaraga berilmaydi', listing_stale: "E'lon o'zgargan",
  price_changed: "Marketapp narxi kotirovkadan oshdi — imzolash to'xtatildi", wallet: 'Hamyon xatosi', marketapp: 'Marketapp xatosi',
  rate_unavailable: "Kursni olib bo'lmadi", no_password: "Parol o'rnatilmagan", no_card: "Karta ko'rsatilmagan",
  link_rejected: 'Havola rad etildi', display_failed: "Profilga ulab bo'lmadi"
};

async function request(prefix, path, { method = 'GET', body } = {}) {
  const token = getSession();
  const base = getApiBase();
  let res;
  try {
    res = await fetch(`${base}${prefix}${path}`, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(base ? "Serverga ulanib bo'lmadi. Internet yoki server manzilini tekshiring." : "Bot server manzili ko'rsatilmagan", 0, 'network');
  }
  const data = await res.json().catch(() => ({}));
  const isAuthCall = prefix === '/api/panel' && ['/auth', '/login', '/request-code', '/info'].includes(path);
  if (res.status === 401 && !isAuthCall) {
    clearSession();
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
  }
  if (!res.ok) {
    const d = data?.detail || {};
    const code = typeof d === 'object' ? d.code : undefined;
    const msg = (typeof d === 'object' && d.error) || ERRORS[code] || (typeof d === 'string' ? d : `Xatolik (${res.status})`);
    throw new ApiError(d.detail ? `${msg} (${d.detail})` : msg, res.status, code);
  }
  return data;
}

/** Panel endpoints: /api/panel/... */
export const api = (path, opts) => request('/api/panel', path, opts);
/** Existing admin endpoints: /api/admin/... */
export const adminApi = (path, opts) => request('/api/admin', path, opts);

export async function apiBlobUrl(path) {
  const res = await fetch(`${getApiBase()}/api/admin${path}`, { headers: { Authorization: `Bearer ${getSession()}` } });
  if (!res.ok) throw new ApiError('Rasm yuklanmadi', res.status);
  return URL.createObjectURL(await res.blob());
}

// Data hook: { data, error, loading, reload }. `source` picks /api/panel (default) or /api/admin.
export function useApi(path, { refreshMs, source = 'panel' } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const alive = useRef(true);
  const load = useCallback(async (silent) => {
    if (!path) return;
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await (source === 'admin' ? adminApi(path) : api(path));
      if (alive.current) setState({ data, error: null, loading: false });
    } catch (e) {
      if (alive.current) setState((s) => ({ ...s, error: e.message, loading: false }));
    }
  }, [path, source]);
  useEffect(() => {
    alive.current = true;
    load();
    const t = refreshMs ? setInterval(() => { if (!document.hidden) load(true); }, refreshMs) : null;
    const onRefresh = () => load(true); // 🔄 button in the header
    window.addEventListener('panel:refresh', onRefresh);
    return () => { alive.current = false; if (t) clearInterval(t); window.removeEventListener('panel:refresh', onRefresh); };
  }, [load, refreshMs]);
  return { ...state, reload: () => load(true) };
}
