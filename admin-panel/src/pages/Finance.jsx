import { useEffect, useMemo, useState } from 'react';
import { Wallet, TrendingUp, Coins, DollarSign, Calculator, Save, Percent, Info, Flame } from 'lucide-react';
import { Card, CardHeader, StatCard, PageHeader, Loading, ErrorBox, som, fmt } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { adminApi, useApi } from '../data/api.js';

const FIELDS = [
  ['fee_percent', 'Marketapp komissiyasi, %', 'Ijara narxi ustiga qo\'shiladi'],
  ['service_fee_uzs', "Xizmat haqi, so'm", 'Har buyurtmaga qat\'iy summa — asosiy foydangiz'],
  ['min_rent_days', 'Minimal ijara, kun', 'Mijoz eng kamida necha kunga oladi'],
  ['markup_percent', 'Ijaraga ustama, %', 'Odatda 0'],
  ['profit_fixed_uzs', "Ustama, so'm / kun", 'Odatda 0'],
  ['round_to', 'Yaxlitlash', 'Kunlik narx shu songa yuqoriga yaxlitlanadi'],
  ['stars_markup_percent', 'Stars ustamasi, %', ''],
  ['premium_markup_percent', 'Premium ustamasi, %', ''],
  ['referral_percent', 'Referal bonusi, %', "Do'st to'lovidan taklif qilganga"],
];
const num = (v) => Number(String(v ?? '0').replace(',', '.').replace(/\s/g, '')) || 0;

export default function Finance() {
  const act = useAction();
  const { data: s, error, loading, reload } = useApi('/stats', { source: 'admin' });
  const [form, setForm] = useState(null);
  const [calc, setCalc] = useState({ ton: '0.05', days: '3' });

  useEffect(() => { if (s && !form) setForm({ ...s.settings }); }, [s]); // eslint-disable-line

  const out = useMemo(() => {
    if (!form || !s) return null;
    const base = num(calc.ton), fee = num(form.fee_percent), p = num(form.markup_percent), fixed = num(form.profit_fixed_uzs);
    const service = num(form.service_fee_uzs), days = Math.max(1, Math.round(num(calc.days)) || 1), round = Math.max(1, num(form.round_to) || 10);
    const rate = form.rate_mode === 'manual' ? num(form.manual_rate) : Number(s.rate || 0);
    if (!rate) return null;
    const costTonDay = base * (1 + fee / 100), costUzs = costTonDay * rate * days;
    const perDay = Math.ceil((costTonDay * rate * (1 + p / 100) + fixed) / round) * round;
    const rent = perDay * days, client = rent + service;
    return { base, rate, perDay, days, rent, service, client, costUzs, profit: client - costUzs, usd: Number(s.uzs_per_usd || 0) };
  }, [form, calc, s]);

  if (loading && !s) return <Loading />;
  if (error && !s) return <ErrorBox error={error} onRetry={reload} />;
  if (!form) return <Loading />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = () => act(() => adminApi('/settings', { method: 'POST', body: Object.fromEntries(
    ['fee_percent', 'markup_percent', 'profit_fixed_uzs', 'service_fee_uzs', 'min_rent_days', 'round_to', 'rate_mode', 'manual_rate',
      'stars_markup_percent', 'premium_markup_percent', 'referral_percent'].map((k) => [k, String(form[k] ?? '')])) }), '💾 Narx sozlamalari saqlandi')
    .then((r) => r && reload());

  return (
    <>
      <PageHeader title="Narx va moliya" subtitle="Mijoz narxi = Marketapp narxi × (1 + komissiya) × kurs × kun + xizmat haqi" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} tone="emerald" title="Jami tushum" value={som(s.revenue_uzs)} hint="Bajarilgan ijaralar" />
        <StatCard icon={TrendingUp} tone="amber" title="Jami sof foyda" value={som(s.profit_uzs)} hint="Tushum − Marketapp xarajati" />
        <StatCard icon={Coins} tone="sky" title="1 TON kursi" value={s.rate ? som(s.rate) : '—'} hint={form.rate_mode === 'manual' ? "Qo'lda" : 'Avto: CoinGecko × CBU'} />
        <StatCard icon={s.hot_balance != null ? Flame : DollarSign} tone="violet" title={s.hot_balance != null ? 'Hot hamyon' : '1 USD'} value={s.hot_balance != null ? `${s.hot_balance} TON` : s.uzs_per_usd ? som(Math.round(s.uzs_per_usd)) : '—'} hint={`Mijozlar balansi: ${som(s.balances_uzs)}`} />
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="p-5 xl:col-span-3">
          <div className="flex items-center gap-2"><Percent size={18} className="text-sky-600" /><h3 className="font-semibold">Narx sozlamalari</h3></div>
          {s.observed_fee_percent && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-800">
              <span><Info size={14} className="inline" /> Haqiqiy Marketapp komissiyasi: <b>{s.observed_fee_percent}%</b></span>
              <button className="btn-light !py-1 text-xs" onClick={() => setForm({ ...form, fee_percent: s.observed_fee_percent })}>Shuni qo'llash</button>
            </div>
          )}
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map(([k, label, hint]) => (
              <label key={k} className="block text-sm">
                <span className="mb-1 block text-slate-600">{label}</span>
                <input className="input" inputMode="decimal" value={form[k] ?? ''} onChange={set(k)} />
                {hint && <span className="mt-0.5 block text-[11px] text-slate-500">{hint}</span>}
              </label>
            ))}
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Kurs rejimi</span>
              <select className="input" value={form.rate_mode} onChange={set('rate_mode')}>
                <option value="auto">Avto (CoinGecko × CBU)</option>
                <option value="manual">Qo'lda</option>
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-slate-600">Qo'lda kurs (1 TON, so'm)</span>
              <input className="input" inputMode="decimal" disabled={form.rate_mode !== 'manual'} value={form.manual_rate ?? ''} onChange={set('manual_rate')} />
            </label>
          </div>
          <div className="mt-5 flex justify-end"><button className="btn-dark" onClick={save}><Save size={16} /> Saqlash</button></div>
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="Kalkulyator" subtitle="Marketapp narxi va kunlarni kiriting — mijoz narxi va foydangiz" right={<Calculator size={18} className="text-sky-600" />} />
          <div className="grid grid-cols-2 gap-3 px-5 pt-4">
            <label className="block text-sm"><span className="mb-1 block text-slate-600">Marketapp, TON/kun</span><input className="input" inputMode="decimal" value={calc.ton} onChange={(e) => setCalc({ ...calc, ton: e.target.value })} /></label>
            <label className="block text-sm"><span className="mb-1 block text-slate-600">Kunlar</span><input className="input" inputMode="numeric" value={calc.days} onChange={(e) => setCalc({ ...calc, days: e.target.value })} /></label>
          </div>
          {out ? (
            <dl className="mx-5 my-4 divide-y divide-white/70 rounded-xl bg-white/60 px-4 text-sm">
              {[
                ['Asl narx', `${out.base} TON · ${som(Math.round(out.base * out.rate))}`],
                ['Kunlik narx (mijoz)', som(out.perDay)],
                [`Ijara: ${som(out.perDay)} × ${out.days}`, som(out.rent)],
                ['Xizmat haqi', som(out.service)],
              ].map(([k, v]) => <div key={k} className="flex justify-between gap-3 py-2"><dt className="text-slate-500">{k}</dt><dd className="font-medium">{v}</dd></div>)}
              <div className="flex justify-between gap-3 py-2.5"><dt className="font-semibold">Mijoz to'laydi</dt><dd className="text-base font-bold text-emerald-700">{som(out.client)}{out.usd ? <span className="ml-1 text-xs text-slate-500">${(out.client / out.usd).toFixed(2)}</span> : null}</dd></div>
              <div className="flex justify-between gap-3 py-2"><dt className="text-slate-500">Sizning xarajatingiz</dt><dd>{som(Math.round(out.costUzs))}</dd></div>
              <div className="flex justify-between gap-3 py-2.5"><dt className="font-semibold">Foyda</dt><dd className="font-bold text-amber-600">+{som(Math.round(out.profit))}</dd></div>
            </dl>
          ) : <p className="px-5 py-6 text-sm text-slate-500">Kurs mavjud emas — qo'lda kurs kiriting.</p>}
          <p className="px-5 pb-5 text-[11px] text-slate-500">Hisob server formulasi bilan bir xil. {fmt(1)} TON = {s.rate ? som(s.rate) : '—'}.</p>
        </Card>
      </div>
    </>
  );
}
