import { useState, createContext, useContext, useCallback, useRef } from 'react';
import { NavLink, useLocation, useNavigate, Outlet, Navigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LayoutDashboard, Wallet, Users, Megaphone, ScrollText, Settings, Search, Bot, Menu, X, LogOut, RefreshCw,
  ShoppingBag, Star, Calculator, ExternalLink, SlidersHorizontal, Radio, Link2Off, TicketPercent, PieChart,
} from 'lucide-react';
import { Avatar, Toast } from './ui.jsx';
import { useApi, getSession, getAdmin, clearSession, api } from '../data/api.js';

const NAV = (c = {}) => [
  { group: 'Asosiy', items: [
    { to: '/', label: "Umumiy ko'rinish", icon: LayoutDashboard },
    { to: '/finance', label: 'Narx va moliya', icon: Calculator, owner: true },
    { to: '/analytics', label: 'Kolleksiyalar tahlili', icon: PieChart, owner: true },
  ] },
  { group: 'Savdo', items: [
    { to: '/orders', label: 'Buyurtmalar', icon: ShoppingBag, badge: (c.review || 0) + (c.toRent || 0) + (c.toSign || 0) + (c.problems || 0) },
    { to: '/connect-issues', label: 'Ulash muammolari', icon: Link2Off, badge: c.connectIssues },
    { to: '/topups', label: "Balans to'ldirish", icon: Wallet, badge: c.openTopups },
    { to: '/purchases', label: 'Stars va Premium', icon: Star, badge: c.openPurchases },
  ] },
  { group: 'Mijozlar', items: [
    { to: '/users', label: 'Foydalanuvchilar', icon: Users },
    { to: '/promos', label: 'Promo-kodlar', icon: TicketPercent, owner: true },
    { to: '/broadcast', label: 'Xabar tarqatish', icon: Megaphone, owner: true },
    { to: '/channels', label: 'Majburiy kanallar', icon: Radio, owner: true },
  ] },
  { group: 'Tizim', items: [
    { to: '/activity', label: 'Faoliyat logi', icon: ScrollText },
    { to: '/bot-settings', label: 'Bot sozlamalari', icon: SlidersHorizontal, owner: true },
    { to: '/settings', label: 'Karta va hamyon', icon: Settings, owner: true },
  ] },
];

// Toast va umumiy hisoblagichlar (badge) — barcha sahifalar uchun
const ToastCtx = createContext(() => {});
export const useToast = () => useContext(ToastCtx);
// operator: orders / top-ups / purchases / users only (the server enforces it too)
export const role = (c = {}) => c.role || getAdmin()?.role || 'owner';
const CountsCtx = createContext({ reload: () => {} });
export const useCounts = () => useContext(CountsCtx);

// Amal bajarish: muvaffaqiyat/xatolik toast'i bilan
export function useAction() {
  const toast = useToast();
  const counts = useCounts();
  return useCallback(async (fn, okMsg) => {
    try {
      const r = await fn();
      if (okMsg) toast(typeof okMsg === 'function' ? okMsg(r) : okMsg);
      counts.reload?.();
      return r;
    } catch (e) {
      toast(`❌ ${e.message}`);
      return null;
    }
  }, [toast, counts]);
}

function Sidebar({ counts, onNavigate }) {
  const userbotOn = counts.userbot === 'on';
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 px-3 pb-6 pt-1">
        <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-900 shadow-lg">
          <img src="./logo.webp" alt="" className="h-7 w-7" />
        </span>
        <div>
          <p className="text-sm font-bold text-slate-900">RentaGift Admin</p>
          <p className="text-xs text-slate-500">Gift ijarasi boshqaruvi</p>
        </div>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto pr-1">
        {NAV(counts).map((g) => ({ ...g, items: g.items.filter((it) => !it.owner || role(counts) !== 'operator') })).filter((g) => g.items.length).map((g) => (
          <div key={g.group}>
            <p className="mb-1.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-slate-500/80">{g.group}</p>
            <ul className="space-y-0.5">
              {g.items.map(({ to, label, icon: Icon, badge }) => (
                <li key={to}>
                  <NavLink
                    to={to}
                    end={to === '/'}
                    onClick={onNavigate}
                    className={({ isActive }) => `group relative flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${isActive ? 'font-semibold text-slate-900' : 'text-slate-600 hover:bg-white/40 hover:text-slate-900'}`}
                  >
                    {({ isActive }) => (
                      <>
                        {isActive && <motion.span layoutId="nav-active" className="absolute inset-0 rounded-xl bg-white/80 shadow-sm" transition={{ type: 'spring', stiffness: 400, damping: 32 }} />}
                        <Icon size={17} className="relative" />
                        <span className="relative flex-1">{label}</span>
                        {badge > 0 && <span className="relative rounded-full bg-sky-500 px-1.5 text-[11px] font-semibold text-white">{badge}</span>}
                      </>
                    )}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="mt-4 rounded-xl bg-white/60 p-3">
        <div className="flex items-center gap-2">
          <Bot size={16} className="text-sky-600" />
          <p className="text-xs font-semibold text-slate-800">Bot holati</p>
          <span className={`ml-auto h-2 w-2 rounded-full ${counts.loaded ? 'bg-emerald-500' : 'bg-slate-400'}`} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {counts.loaded ? `${counts.demo ? 'DEMO · ' : ''}Hamyon: ${counts.walletMode === 'hot' ? 'hot (avto)' : 'TON Connect'}` : '...'}
        </p>
        {counts.loaded && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
            <span className={`h-1.5 w-1.5 rounded-full ${userbotOn ? 'bg-emerald-500' : 'bg-amber-500'}`} />
            CardXabar avto-tasdiq: {userbotOn ? 'yoniq' : "o'chiq"}
          </p>
        )}
        {counts.botUsername && (
          <a href={`https://t.me/${counts.botUsername}`} target="_blank" rel="noreferrer" className="mt-2 flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline">
            @{counts.botUsername} <ExternalLink size={11} />
          </a>
        )}
      </div>
    </div>
  );
}

export default function Layout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [toast, setToast] = useState(null);
  const [q, setQ] = useState('');
  const toastTimer = useRef();
  const dash = useApi(getSession() ? '/dashboard' : null, { refreshMs: 60000 });
  const showToast = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  if (!getSession()) return <Navigate to="/login" replace />;
  const admin = getAdmin() || { name: 'Admin' };
  const counts = { ...(dash.data || {}), loaded: !!dash.data, reload: dash.reload };

  const logout = async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    clearSession();
    navigate('/login');
  };

  return (
    <ToastCtx.Provider value={showToast}>
      <CountsCtx.Provider value={counts}>
        <div className="flex min-h-full gap-5 p-3 sm:p-5">
          <aside className="glass sticky top-5 hidden h-[calc(100vh-2.5rem)] w-64 shrink-0 rounded-2xl p-4 lg:block">
            <Sidebar counts={counts} />
          </aside>

          <AnimatePresence>
            {mobileOpen && (
              <motion.div className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-sm lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setMobileOpen(false)}>
                <motion.aside className="glass-strong h-full w-72 rounded-r-2xl p-4" initial={{ x: -300 }} animate={{ x: 0 }} exit={{ x: -300 }} onClick={(e) => e.stopPropagation()}>
                  <button className="absolute right-3 top-3 rounded-lg p-1 text-slate-500" onClick={() => setMobileOpen(false)}><X size={18} /></button>
                  <Sidebar counts={counts} onNavigate={() => setMobileOpen(false)} />
                </motion.aside>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="min-w-0 flex-1">
            <header className="glass mb-6 flex items-center gap-3 rounded-2xl px-3 py-2.5 sm:px-4">
              <button className="rounded-lg p-1.5 text-slate-600 hover:bg-white/60 lg:hidden" onClick={() => setMobileOpen(true)}><Menu size={20} /></button>
              <form className="relative max-w-xl flex-1" onSubmit={(e) => { e.preventDefault(); navigate(/^#?\d{1,7}$/.test(q.trim()) ? `/orders?order=${q.trim().replace('#', '')}` : `/users?q=${encodeURIComponent(q)}`); }}>
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input className="input pl-9" placeholder="Mijoz ismi, Telegram ID, @username yoki #buyurtma..." value={q} onChange={(e) => setQ(e.target.value)} />
              </form>
              <div className="ml-auto flex items-center gap-2">
                <button title="Yangilash" className="rounded-xl bg-white/60 p-2 text-slate-600 hover:bg-white" onClick={() => { dash.reload(); window.dispatchEvent(new Event('panel:refresh')); }}><RefreshCw size={18} /></button>
                <div className="hidden items-center gap-2 rounded-xl bg-white/60 py-1 pl-1 pr-3 sm:flex">
                  <Avatar name={admin.name || 'Admin'} size={30} />
                  <div className="leading-tight">
                    <p className="text-sm font-semibold">{admin.name || 'Admin'}</p>
                    <p className="text-[11px] text-slate-500">{role(counts) === 'operator' ? 'Operator' : 'Egasi (owner)'}</p>
                  </div>
                </div>
                <button title="Chiqish" className="rounded-xl bg-white/60 p-2 text-slate-600 hover:bg-white hover:text-rose-600" onClick={logout}><LogOut size={18} /></button>
              </div>
            </header>

            <motion.main key={location.pathname} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22 }}>
              <Outlet />
            </motion.main>
          </div>
        </div>
        <Toast message={toast} />
      </CountsCtx.Provider>
    </ToastCtx.Provider>
  );
}
