import { useEffect, useMemo, useState } from 'react';
import { Bot, CreditCard, Wallet, Zap, ShieldAlert, Flame, DatabaseBackup, Save, RotateCcw, CheckCircle2, XCircle, Info, History, Lock } from 'lucide-react';
import { Card, PageHeader, Badge, Toggle, Loading, ErrorBox, ago } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, useApi } from '../data/api.js';

const ICONS = { bot: Bot, pay: CreditCard, balance: Wallet, auto: Zap, safety: ShieldAlert, hot: Flame, backup: DatabaseBackup };
const show = (v) => (typeof v === 'boolean' ? (v ? 'Yoqilgan' : "O'chiq") : v === '' || v === null || v === undefined ? '— (bo\'sh)' : String(v));

function Field({ f, value, onChange, onReset }) {
  const input = (() => {
    if (f.type === 'bool') return null;
    if (f.type === 'choice') {
      return <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{f.choices.map((c) => <option key={c} value={c}>{c}</option>)}</select>;
    }
    const numeric = f.type === 'int' || f.type === 'float';
    return <input className="input" inputMode={numeric ? 'decimal' : undefined} value={value ?? ''} onChange={(e) => onChange(e.target.value)}
      placeholder={f.type === 'url' ? 'https://...' : f.type === 'username' ? 'username (@ siz)' : ''} />;
  })();
  return (
    <div className="py-3.5">
      {f.type === 'bool' ? (
        <Toggle checked={!!value} onChange={onChange} label={f.label} />
      ) : (
        <label className="block text-sm">
          <span className="mb-1 flex flex-wrap items-center gap-2 font-medium text-slate-800">{f.label}</span>
          {input}
        </label>
      )}
      <p className="mt-1.5 flex gap-1.5 text-xs leading-relaxed text-slate-600"><Info size={13} className="mt-0.5 shrink-0 text-sky-600" />{f.help}</p>
      <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
        <span>Railway qiymati: <b className="text-slate-700">{show(f.env)}</b></span>
        {f.overridden && <Badge tone="blue">paneldan o'zgartirilgan</Badge>}
        {f.overridden && <button type="button" className="inline-flex items-center gap-1 text-sky-700 hover:underline" onClick={onReset}><RotateCcw size={11} /> Railway qiymatiga qaytarish</button>}
      </div>
    </div>
  );
}

export default function BotSettings() {
  const act = useAction();
  const { data, error, loading, reload } = useApi('/config');
  const [form, setForm] = useState({});
  const [fieldError, setFieldError] = useState(null);

  useEffect(() => { if (data) setForm(Object.fromEntries(data.fields.map((f) => [f.key, f.value]))); }, [data]);
  const byGroup = useMemo(() => {
    const m = {};
    (data?.fields || []).forEach((f) => { (m[f.group] ||= []).push(f); });
    return m;
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const dirty = (g) => (byGroup[g] || []).filter((f) => String(form[f.key]) !== String(f.value));
  const saveGroup = (g) => {
    const values = Object.fromEntries(dirty(g).map((f) => [f.key, form[f.key]]));
    setFieldError(null);
    return act(async () => {
      try { return await api('/config', { method: 'POST', body: { values } }); }
      catch (e) { setFieldError(e.message); throw e; }
    }, (r) => (r.changed.length ? `💾 Saqlandi: ${r.changed.length} ta sozlama — darhol ishlaydi` : "O'zgarish yo'q")).then((r) => r && reload());
  };
  const reset = (key) => act(() => api('/config/reset', { method: 'POST', body: { key } }), "↩️ Railway qiymatiga qaytarildi").then((r) => r && reload());
  const label = (key) => data.fields.find((f) => f.key === key)?.label || key;

  return (
    <>
      <PageHeader title="Bot sozlamalari" subtitle="Railway'ga kirmasdan o'zgartiriladigan sozlamalar. Saqlangan zahoti ishlaydi — botni qayta ishga tushirish shart emas." />

      <Card className="mb-5 p-5">
        <div className="mb-3 flex items-center gap-2"><CheckCircle2 size={18} className="text-emerald-600" /><h3 className="font-semibold">Tizim holati</h3></div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {data.status.map((s) => (
            <div key={s.name} className="flex items-start gap-2 rounded-xl bg-white/60 px-3 py-2.5">
              {s.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-600" /> : <XCircle size={16} className="mt-0.5 shrink-0 text-rose-600" />}
              <div className="min-w-0"><p className="text-sm font-medium">{s.name}</p><p className="truncate text-xs text-slate-500" title={s.detail}>{s.detail}</p></div>
            </div>
          ))}
        </div>
        <p className="mt-3 flex gap-1.5 text-xs text-slate-500"><Lock size={13} className="mt-0.5 shrink-0" />
          Maxfiy kalitlar (BOT_TOKEN, MARKETAPP_API_TOKEN, hamyon, HOT_WALLET_MNEMONIC, USERBOT_SESSION, ADMIN_IDS, DATABASE_URL) xavfsizlik uchun faqat Railway'da o'zgartiriladi — bu yerda faqat holati ko'rinadi.</p>
      </Card>

      {fieldError && <p className="mb-4 rounded-xl bg-rose-500/15 px-4 py-2.5 text-sm text-rose-800">❌ {fieldError}</p>}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        {data.groups.map((g) => {
          const Icon = ICONS[g.id] || Bot;
          const d = dirty(g.id);
          return (
            <Card key={g.id} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-2"><Icon size={18} className="text-sky-600" /><div><h3 className="font-semibold">{g.title}</h3><p className="text-xs text-slate-500">{g.hint}</p></div></div>
                {d.length > 0 && <Badge tone="amber">{d.length} ta o'zgarish</Badge>}
              </div>
              <div className="mt-1 divide-y divide-white/70">
                {(byGroup[g.id] || []).map((f) => (
                  <Field key={f.key} f={f} value={form[f.key]} onChange={(v) => setForm({ ...form, [f.key]: v })} onReset={() => reset(f.key)} />
                ))}
              </div>
              <div className="mt-3 flex justify-end gap-2">
                {d.length > 0 && <button className="btn-light" onClick={() => setForm({ ...form, ...Object.fromEntries(d.map((f) => [f.key, f.value])) })}>Bekor qilish</button>}
                <button className="btn-dark" disabled={!d.length} onClick={() => saveGroup(g.id)}><Save size={15} /> Saqlash</button>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="mt-5 p-5">
        <div className="mb-3 flex items-center gap-2"><History size={18} className="text-sky-600" /><h3 className="font-semibold">O'zgarishlar tarixi</h3></div>
        {data.history.length ? (
          <ul className="space-y-1.5 text-sm">
            {data.history.map((h, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-white/40">
                <Badge tone="violet">Admin {h.admin}</Badge>
                <span className="font-medium">{label(h.key)}</span>
                <span className="text-slate-500">{show(h.old)} → <b className="text-slate-800">{show(h.new)}</b></span>
                <span className="ml-auto text-xs text-slate-400">{ago(new Date(h.at).getTime())}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-sm text-slate-500">Hali paneldan o'zgartirilmagan — hamma qiymatlar Railway'dan olinmoqda.</p>}
      </Card>
    </>
  );
}
