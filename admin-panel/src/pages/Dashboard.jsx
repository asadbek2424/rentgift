import { useNavigate } from 'react-router-dom';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend } from 'recharts';
import { Users, Activity, Wallet, TrendingUp, KeyRound, ClipboardCheck, AlertTriangle, PenLine, Crown, ShoppingBag, Star, UserPlus } from 'lucide-react';
import { Card, CardHeader, StatCard, PageHeader, Badge, Avatar, Loading, ErrorBox, Empty, fmt, som, ago } from '../components/ui.jsx';
import { useApi } from '../data/api.js';
import { ORDER_STATUS } from '../data/status.js';

const COLORS = ['#0ea5e9', '#6366f1', '#10b981', '#f59e0b', '#f43f5e', '#06b6d4', '#a855f7', '#84cc16'];
const CAT = { gift: 'Giftlar', username: 'Username', number: 'Raqamlar' };

function greeting() {
  const h = new Date().getHours();
  if (h < 5) return 'Xayrli tun';
  if (h < 12) return 'Xayrli tong';
  if (h < 18) return 'Xayrli kun';
  return 'Xayrli kech';
}
const pct = (a, b) => (b ? Math.round(((a - b) / b) * 100) : undefined);
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n));

export default function Dashboard() {
  const nav = useNavigate();
  const { data: d, error, loading, reload } = useApi('/dashboard', { refreshMs: 60000 });
  if (loading && !d) return <Loading />;
  if (error && !d) return <ErrorBox error={error} onRetry={reload} />;

  const cats = d.byCategory.map((c, i) => ({ ...c, label: CAT[c.name] || c.name, color: COLORS[i % COLORS.length] }));
  const colls = d.byCollection.slice(0, 6).map((c, i) => ({ ...c, color: COLORS[(i + 2) % COLORS.length] }));
  const queue = [
    { key: 'review', label: 'Chek tekshiruvi', value: d.review, icon: ClipboardCheck, tone: 'amber', to: '/orders?f=review' },
    { key: 'paid', label: 'Ijaraga olish', value: d.toRent, icon: KeyRound, tone: 'sky', to: '/orders?f=paid' },
    { key: 'sign', label: 'Imzo kutmoqda', value: d.toSign, icon: PenLine, tone: 'violet', to: '/orders?f=sign' },
    { key: 'problem', label: 'Muammoli', value: d.problems, icon: AlertTriangle, tone: 'rose', to: '/orders?f=problem' },
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}! 👋`}
        subtitle="GiftRent — gift, username va raqam ijarasi bugungi holati"
        actions={<button className="btn-dark" onClick={() => nav('/orders')}><ShoppingBag size={16} /> Buyurtmalar</button>}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} tone="emerald" title="Shu oy tushum" value={som(d.monthRevenue)} change={pct(d.monthRevenue, d.prevRevenue)} hint={`Jami: ${som(d.totalRevenue)}`} />
        <StatCard icon={TrendingUp} tone="amber" title="Shu oy sof foyda" value={som(d.monthProfit)} change={pct(d.monthProfit, d.prevProfit)} hint={`Jami: ${som(d.totalProfit)}`} />
        <StatCard icon={KeyRound} tone="sky" title="Faol ijaralar" value={fmt(d.activeRentals)} hint="Hozir mijozlar profilida" />
        <StatCard icon={Users} tone="violet" title="Foydalanuvchilar" value={fmt(d.totalUsers)} hint={`Bugun: +${fmt(d.newToday)} · faol ${fmt(d.activeToday)}`} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {queue.map((q) => (
          <button key={q.key} className="text-left" onClick={() => nav(q.to)}>
            <StatCard icon={q.icon} tone={q.tone} title={q.label} value={fmt(q.value)} hint={q.value ? 'Bosing — ro\'yxatni ochish' : 'Navbat bo\'sh'} />
          </button>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <CardHeader title="Tushum va foyda" subtitle="Oxirgi 14 kun (so'm)" />
          <div className="h-64 px-2 pb-3 pt-4">
            <ResponsiveContainer>
              <AreaChart data={d.activity}>
                <defs>
                  <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.45} /><stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} /></linearGradient>
                  <linearGradient id="gPro" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#f59e0b" stopOpacity={0.45} /><stop offset="100%" stopColor="#f59e0b" stopOpacity={0} /></linearGradient>
                </defs>
                <CartesianGrid vertical={false} stroke="rgba(100,116,139,.15)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" />
                <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" width={44} tickFormatter={short} />
                <Tooltip formatter={(v) => som(v)} contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,.12)' }} />
                <Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="revenue" name="Tushum" stroke="#0284c7" strokeWidth={2} fill="url(#gRev)" />
                <Area type="monotone" dataKey="profit" name="Foyda" stroke="#d97706" strokeWidth={2} fill="url(#gPro)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Nima ijaraga olinmoqda" subtitle="Bajarilgan buyurtmalar bo'yicha" />
          {cats.length ? (
            <>
              <div className="relative mx-auto h-44 w-44">
                <ResponsiveContainer>
                  <PieChart>
                    <Pie data={cats} dataKey="value" innerRadius={52} outerRadius={78} paddingAngle={2} stroke="none" isAnimationActive={false}>
                      {cats.map((c) => <Cell key={c.name} fill={c.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, n, p) => [v, p.payload.label]} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div><p className="text-2xl font-bold">{fmt(cats.reduce((s, c) => s + c.value, 0))}</p><p className="text-[11px] text-slate-500">ijara</p></div>
                </div>
              </div>
              <ul className="space-y-1.5 px-5 pb-3 pt-2">
                {cats.map((c) => (
                  <li key={c.name} className="flex items-center gap-2 text-sm">
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: c.color }} />
                    <span className="flex-1 truncate text-slate-600">{c.label}</span>
                    <span className="font-semibold">{fmt(c.value)}</span>
                  </li>
                ))}
              </ul>
              {colls.length > 0 && (
                <div className="border-t border-white/60 px-5 pb-5 pt-3">
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Top kolleksiyalar</p>
                  {colls.map((c) => (
                    <div key={c.name} className="mb-1.5 flex items-center gap-2 text-sm">
                      <span className="flex-1 truncate text-slate-600" title={c.name}>{c.name}</span>
                      <div className="h-1.5 w-20 overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full" style={{ width: `${Math.round((c.value / colls[0].value) * 100)}%`, background: c.color }} /></div>
                      <span className="w-6 text-right font-semibold">{c.value}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          ) : <Empty text="Hali bajarilgan ijara yo'q" />}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-3">
        <Card className="xl:col-span-1">
          <CardHeader title="Buyurtmalar va yangi mijozlar" subtitle="Oxirgi 14 kun" />
          <div className="h-56 px-2 pb-3 pt-4">
            <ResponsiveContainer>
              <BarChart data={d.activity} barGap={3}>
                <CartesianGrid vertical={false} stroke="rgba(100,116,139,.15)" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={10} stroke="#64748b" />
                <YAxis tickLine={false} axisLine={false} fontSize={11} stroke="#64748b" width={28} allowDecimals={false} />
                <Tooltip cursor={{ fill: 'rgba(255,255,255,.35)' }} contentStyle={{ borderRadius: 12, border: 'none' }} />
                <Bar dataKey="orders" name="Buyurtmalar" fill="#38bdf8" radius={[6, 6, 0, 0]} />
                <Bar dataKey="newUsers" name="Yangi mijozlar" fill="#6366f1" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        <Card>
          <CardHeader title="Diqqat talab qiladi" subtitle="Chek, ijara, imzo va muammolar" right={<button className="btn-light !py-1.5 text-xs" onClick={() => nav('/orders')}>Barchasi</button>} />
          {d.pending.length ? (
            <ul className="px-2 pb-2 pt-3">
              {d.pending.map((p) => {
                const [label, tone] = ORDER_STATUS[p.status] || [p.status, 'slate'];
                return (
                  <li key={p.id}>
                    <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/40" onClick={() => nav(`/orders?order=${p.id}`)}>
                      <Avatar name={p.name || '?'} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">#{p.id} · {p.gift}</p>
                        <p className="truncate text-xs text-slate-500">{p.name} · {ago(p.createdAt)}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{som(p.amount)}</p>
                        <Badge tone={tone}>{label}</Badge>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : <Empty icon="✅" text="Hamma narsa joyida — navbat bo'sh" />}
        </Card>

        <Card>
          <CardHeader title="TOP mijozlar" subtitle="Jami xarid bo'yicha" right={<Crown size={18} className="text-amber-500" />} />
          {d.top.length ? (
            <ul className="px-2 pb-2 pt-3">
              {d.top.map((u, i) => (
                <li key={u.id}>
                  <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left hover:bg-white/40" onClick={() => nav(`/users?q=${u.id}`)}>
                    <span className={`grid h-7 w-7 place-items-center rounded-lg text-xs font-bold ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-slate-300 text-slate-700' : i === 2 ? 'bg-orange-300 text-white' : 'bg-white/70 text-slate-500'}`}>{i + 1}</span>
                    <Avatar name={u.name} size={32} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{u.name}</p>
                      <p className="truncate text-xs text-slate-500">{u.username ? `@${u.username}` : u.id} · balans {som(u.balance)}</p>
                    </div>
                    <span className="text-sm font-bold text-sky-700">{som(u.spent)}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty text="Hali xarid yo'q" />}
        </Card>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <button className="text-left" onClick={() => nav('/topups')}>
          <Card hover className="flex items-center gap-3 p-4"><Wallet size={18} className="text-emerald-600" /><p className="text-sm text-slate-700">Ochiq balans to'ldirishlar: <b>{d.openTopups}</b></p></Card>
        </button>
        <button className="text-left" onClick={() => nav('/purchases')}>
          <Card hover className="flex items-center gap-3 p-4"><Star size={18} className="text-amber-500" /><p className="text-sm text-slate-700">Stars / Premium navbatda: <b>{d.openPurchases}</b></p></Card>
        </button>
        <button className="text-left" onClick={() => nav('/users?f=balance')}>
          <Card hover className="flex items-center gap-3 p-4"><UserPlus size={18} className="text-violet-600" /><p className="text-sm text-slate-700">Mijozlar balanslari: <b>{som(d.balances)}</b></p></Card>
        </button>
      </div>
      {d.demo && <p className="mt-4 text-center text-xs text-white/80"><Activity size={12} className="inline" /> DEMO rejim: katalog soxta, pul harakati yo'q.</p>}
    </>
  );
}
