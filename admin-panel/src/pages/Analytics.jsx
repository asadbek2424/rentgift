import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Download, TrendingUp, Wallet, Percent, CalendarDays } from 'lucide-react';
import { Card, CardHeader, StatCard, PageHeader, Tabs, Loading, ErrorBox, Empty, fmt, som } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { useApi, getApiBase, getSession, ApiError } from '../data/api.js';

const PERIODS = [{ value: 7, label: '7 kun' }, { value: 30, label: '30 kun' }, { value: 90, label: '90 kun' }, { value: 0, label: 'Hammasi' }];
const CAT = { gift: 'Gift', username: 'Username', number: 'Raqam' };

async function download(kind, days) {
  const res = await fetch(`${getApiBase()}/api/panel/export/${kind}?days=${days}`, { headers: { Authorization: `Bearer ${getSession()}` } });
  if (!res.ok) throw new ApiError(res.status === 403 ? 'Faqat egasi (owner) yuklab oladi' : 'Yuklab bo\'lmadi', res.status);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = `${kind}-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export default function Analytics() {
  const act = useAction();
  const [days, setDays] = useState(30);
  const { data, error, loading, reload } = useApi(`/analytics?days=${days}`);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const { items, total } = data;
  const chart = items.slice(0, 10).map((g) => ({ name: g.name.length > 16 ? `${g.name.slice(0, 15)}…` : g.name, Foyda: g.profit, Tannarx: g.cost }));
  const exp = (kind) => act(() => download(kind, days), '⬇️ CSV yuklandi');

  return (
    <>
      <PageHeader title="Kolleksiyalar tahlili" subtitle="Qaysi kolleksiya ko'proq foyda keltiryapti — tushum, tannarx va sof foyda"
        actions={<Tabs value={days} onChange={setDays} items={PERIODS} />} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} tone="emerald" title="Tushum" value={som(total.revenue)} hint={`${fmt(total.orders)} ijara · ${fmt(total.extensions)} uzaytirish`} />
        <StatCard icon={TrendingUp} tone="amber" title="Sof foyda" value={som(total.profit)} hint={total.discount ? `Promo chegirmalar: ${som(total.discount)}` : 'Tushum − Marketapp tannarxi'} />
        <StatCard icon={Percent} tone="sky" title="O'rtacha marja" value={`${total.margin}%`} hint="Foyda / tushum" />
        <StatCard icon={CalendarDays} tone="violet" title="Ijara kunlari" value={fmt(total.days)} hint={total.days ? `Kuniga ${som(Math.round(total.profit / total.days))} foyda` : ''} />
      </div>

      {items.length ? (
        <>
          <Card className="mt-5 p-5">
            <CardHeader title="Top-10 kolleksiya — foyda" subtitle="so'mda" />
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chart} margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : v)} />
                  <Tooltip formatter={(v) => som(v)} />
                  <Bar dataKey="Tannarx" stackId="a" fill="#94a3b8" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="Foyda" stackId="a" fill="#10b981" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <Card className="mt-5 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="bg-white/40 text-left text-xs uppercase tracking-wide text-slate-500">
                  <tr>{['Kolleksiya', 'Ijara', 'Kun', 'Tushum', 'Tannarx', 'Foyda', 'Marja', 'Foyda/kun'].map((h) => <th key={h} className="px-4 py-3 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody>
                  {items.map((g) => (
                    <tr key={`${g.category}:${g.name}`} className="border-t border-white/50">
                      <td className="px-4 py-2.5 font-semibold">{g.name}{g.category !== 'gift' && <span className="ml-1 text-xs text-slate-500">({CAT[g.category] || g.category})</span>}</td>
                      <td className="px-4 py-2.5">{fmt(g.orders)}{g.extensions ? <span className="text-xs text-slate-500"> +{g.extensions}</span> : null}</td>
                      <td className="px-4 py-2.5">{fmt(g.days)}</td>
                      <td className="px-4 py-2.5">{som(g.revenue)}</td>
                      <td className="px-4 py-2.5 text-slate-500">{som(g.cost)}</td>
                      <td className={`px-4 py-2.5 font-bold ${g.profit < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{som(g.profit)}</td>
                      <td className="px-4 py-2.5">{g.margin}%</td>
                      <td className="px-4 py-2.5">{som(g.perDayProfit)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : <Card className="mt-5"><Empty icon="📊" text="Bu davrda yakunlangan ijara yo'q" /></Card>}

      <Card className="mt-5 p-5">
        <CardHeader title="Excel uchun yuklab olish (CSV)" subtitle={`Tanlangan davr: ${PERIODS.find((p) => p.value === days)?.label}. Excel'da to'g'ridan-to'g'ri ochiladi`} />
        <div className="flex flex-wrap gap-2">
          <button className="btn-dark" onClick={() => exp('orders')}><Download size={15} /> Buyurtmalar</button>
          <button className="btn-light" onClick={() => exp('topups')}><Download size={15} /> Balans to'ldirishlar</button>
          <button className="btn-light" onClick={() => exp('purchases')}><Download size={15} /> Stars / Premium</button>
        </div>
      </Card>
    </>
  );
}
