import { useEffect, useMemo, useState } from 'react';
import { Wallet, TrendingUp, Coins, DollarSign, Calculator, Save, Percent, Info, Flame } from 'lucide-react';
import { Card, CardHeader, StatCard, PageHeader, Loading, ErrorBox, som, fmt } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { adminApi, useApi } from '../data/api.js';

const FIELDS = [
  ['fee_percent', 'Marketapp komissiyasi, %', 'Marketapp ijara narxi ustiga oladigan haq (xarajatingiz)'],
  ['min_rent_days', 'Minimal ijara, kun', "1 qo'ysangiz — har bir gift Marketapp'dagi o'z minimumi bilan (1 yoki 3 kun). Kattaroq son hammasiga majburiy minimum bo'ladi"],
  ['round_to', 'Yaxlitlash', 'Kunlik narx shu songa yuqoriga yaxlitlanadi'],
  ['username_markup_percent', 'Username ustamasi, %', "Ijaradagi @username'lar uchun. Bo'sh = giftlar foizi bilan bir xil"],
  ['number_markup_percent', 'Anonim raqam ustamasi, %', "+888 raqamlar uchun. Bo'sh = giftlar foizi bilan bir xil"],
  ['stars_markup_percent', 'Stars ustamasi, %', 'Dollar narxi + tarmoq komissiyasi ustiga'],
  ['premium_markup_percent', 'Premium ustamasi, %', 'Dollar narxi + tarmoq komissiyasi ustiga'],
  ['stars_usd_per_1000', '1 000 Stars narxi, $', "Fragment: 1 000 = $15. So'm narxi CBU dollar kursi bilan o'zgaradi. 0 = jonli TON narxi"],
  ['premium_usd_3', 'Premium 3 oy, $', 'Fragment: $11.99'],
  ['premium_usd_6', 'Premium 6 oy, $', 'Fragment: $15.99'],
  ['premium_usd_12', 'Premium 12 oy, $', 'Fragment: $28.99'],
  ['fragment_fee_ton', 'Tarmoq komissiyasi, TON', "Har Stars/Premium xaridida: 0.1 TON ketadi, ~0.045 qaytadi → 0.055. Jonli kursda so'mga aylanib narxga qo'shiladi"],
  ['referral_percent', 'Referal bonusi, %', "Do'st to'lovidan taklif qilganga"],
];
const num = (v) => Number(String(v ?? '0').replace(',', '.').replace(/\s/g, '')) || 0;
// service fee: in TON (follows the live rate) when set, otherwise the fixed so'm amount
const feeUzs = (f, rate) => (num(f.service_fee_ton) > 0 ? Math.ceil((num(f.service_fee_ton) * rate) / Math.max(1, num(f.round_to) || 10)) * Math.max(1, num(f.round_to) || 10) : num(f.service_fee_uzs));

export default function Finance() {
  const act = useAction();
  const { data: s, error, loading, reload } = useApi('/stats', { source: 'admin' });
  const [form, setForm] = useState(null);
  const [calc, setCalc] = useState({ ton: '0.05', days: '3' });

  useEffect(() => { if (s && !form) setForm({ ...s.settings }); }, [s]); // eslint-disable-line

  const out = useMemo(() => {
    if (!form || !s) return null;
    const base = num(calc.ton), fee = num(form.fee_percent), p = num(form.markup_percent);
    const days = Math.max(1, Math.round(num(calc.days)) || 1), round = Math.max(1, num(form.round_to) || 10);
    const rate = form.rate_mode === 'manual' ? num(form.manual_rate) : Number(s.rate || 0);
    if (!rate) return null;
    const service = feeUzs(form, rate);
    const costTonDay = base * (1 + fee / 100), costUzs = costTonDay * rate * days;
    const perDay = Math.ceil((costTonDay * rate * (1 + p / 100)) / round) * round;
    const rent = perDay * days, client = rent + service;
    return { base, rate, perDay, days, rent, service, client, costUzs, profit: client - costUzs, usd: Number(s.uzs_per_usd || 0) };
  }, [form, calc, s]);

  if (loading && !s) return <Loading />;
  if (error && !s) return <ErrorBox error={error} onRetry={reload} />;
  if (!form) return <Loading />;

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const save = () => act(() => adminApi('/settings', { method: 'POST', body: Object.fromEntries(
    ['fee_percent', 'markup_percent', 'service_fee_uzs', 'service_fee_ton', 'min_rent_days', 'round_to', 'rate_mode', 'manual_rate',
      'stars_markup_percent', 'premium_markup_percent', 'referral_percent',
      'username_markup_percent', 'number_markup_percent', 'stars_usd_per_1000', 'premium_usd_3', 'premium_usd_6', 'premium_usd_12', 'fragment_fee_ton'].map((k) => [k, String(form[k] ?? '')])) }), '💾 Narx sozlamalari saqlandi')
    .then((r) => r && reload());

  return (
    <>
      <PageHeader title="Narx va moliya" subtitle="Mijoz narxi = Marketapp narxi (TON) × jonli kurs × (1 + ustama %) × kun + xizmat haqi. Kurs har daqiqada yangilanadi — narxlarni qo'lda o'zgartirish shart emas." />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={Wallet} tone="emerald" title="Jami tushum" value={som(s.revenue_uzs)} hint="Bajarilgan ijaralar" />
        <StatCard icon={TrendingUp} tone="amber" title="Jami sof foyda" value={som(s.profit_uzs)} hint="Tushum − Marketapp xarajati" />
        <StatCard icon={Coins} tone="sky" title="1 TON kursi" value={s.rate ? som(s.rate) : '—'} hint={form.rate_mode === 'manual' ? "Qo'lda" : 'Avto, har daqiqada: CoinGecko × CBU'} />
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
          {(() => {
            const rate = form.rate_mode === 'manual' ? num(form.manual_rate) : Number(s.rate || 0);
            const p = num(form.markup_percent), exTon = 0.1, exUzs = exTon * rate, d = 3;
            const day = Math.ceil((exUzs * (1 + p / 100)) / Math.max(1, num(form.round_to) || 10)) * Math.max(1, num(form.round_to) || 10);
            const svc = feeUzs(form, rate);
            return (
              <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-2">
                <div className="rounded-2xl border border-sky-300/70 bg-gradient-to-br from-white/80 to-sky-50/70 p-4 shadow-sm">
                  <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-sky-500 text-white"><Percent size={16} /></span>
                    <div><p className="text-sm font-semibold">Giftlarga ustama, %</p><p className="text-[11px] text-slate-500">Marketapp narxi (TON → so'm, jonli kurs) ustiga qo'shiladi</p></div></div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <div className="relative w-28"><input className="input pr-7 text-lg font-bold" inputMode="decimal" value={form.markup_percent ?? ''} onChange={set('markup_percent')} />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bold text-slate-500">%</span></div>
                    {[0, 10, 20, 30, 50].map((v) => (
                      <button key={v} type="button" onClick={() => setForm({ ...form, markup_percent: String(v) })}
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${num(form.markup_percent) === v ? 'bg-sky-600 text-white' : 'bg-white/80 text-slate-600 hover:bg-white'}`}>{v}%</button>
                    ))}
                  </div>
                  {rate > 0 && <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    Misol: gift <b>{exTon} TON/kun</b> = <b>{fmt(Math.round(exUzs))} so'm</b> (hozirgi kurs) → +{p}% → mijozga <b>{fmt(day)} so'm/kun</b>; {d} kun = <b>{fmt(day * d)} so'm</b>.
                  </p>}
                </div>
                <div className="rounded-2xl border border-emerald-300/70 bg-gradient-to-br from-white/80 to-emerald-50/70 p-4 shadow-sm">
                  <div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-emerald-500 text-white"><Coins size={16} /></span>
                    <div><p className="text-sm font-semibold">Xizmat haqi (har buyurtmaga)</p><p className="text-[11px] text-slate-500">TON'da qo'ysangiz, jonli kurs bo'yicha so'mga aylanadi</p></div></div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <label className="block text-xs text-slate-600">TON'da<input className="input mt-1 font-bold" inputMode="decimal" placeholder="masalan 0.01" value={form.service_fee_ton ?? ''} onChange={set('service_fee_ton')} /></label>
                    <label className={`block text-xs text-slate-600 ${num(form.service_fee_ton) > 0 ? 'opacity-50' : ''}`}>yoki so'mda<input className="input mt-1 font-bold" inputMode="numeric" disabled={num(form.service_fee_ton) > 0} value={form.service_fee_uzs ?? ''} onChange={set('service_fee_uzs')} /></label>
                  </div>
                  <p className="mt-3 rounded-xl bg-white/70 px-3 py-2 text-xs leading-relaxed text-slate-700">
                    {num(form.service_fee_ton) > 0
                      ? <>Hozir: <b>{form.service_fee_ton} TON ≈ {fmt(svc)} so'm</b>. Kurs o'zgarsa, summa ham o'zi o'zgaradi.</>
                      : <>Hozir qat'iy: <b>{fmt(svc)} so'm</b>. TON maydonini to'ldirsangiz, kursga bog'lanadi.</>}
                  </p>
                </div>
              </div>
            );
          })()}
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
