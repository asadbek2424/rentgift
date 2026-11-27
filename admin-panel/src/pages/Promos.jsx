import { useState } from 'react';
import { Plus, Trash2, TicketPercent, Pencil, Info } from 'lucide-react';
import { Card, PageHeader, Badge, Modal, Toggle, Loading, ErrorBox, Empty, fmt, som, date } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, useApi } from '../data/api.js';

const EMPTY = { code: '', type: 'percent', percent: 10, amount: 5000, maxUses: 0, perUser: 1, category: '', active: true, note: '', expiresAt: '' };
const CATS = { '': 'Hammasi', gift: 'Gift', username: 'Username', number: 'Raqam' };

export default function Promos() {
  const act = useAction();
  const { data, error, loading, reload } = useApi('/promos');
  const [form, setForm] = useState(null);
  const [err, setErr] = useState('');
  const [del, setDel] = useState(null);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const set = (k) => (e) => setForm({ ...form, [k]: e?.target ? (e.target.type === 'number' ? Number(e.target.value) : e.target.value) : e });
  const edit = (p) => { setErr(''); setForm({ ...EMPTY, ...p, type: p.percent ? 'percent' : 'amount', percent: p.percent || 10, amount: p.amount || 5000,
    expiresAt: p.expiresAt ? p.expiresAt.slice(0, 10) : '' }); };
  const save = async () => {
    setErr('');
    const body = { code: form.code, percent: form.type === 'percent' ? form.percent : 0, amount: form.type === 'amount' ? form.amount : 0,
      maxUses: form.maxUses || 0, perUser: form.perUser ?? 1, category: form.category, active: form.active, note: form.note,
      expiresAt: form.expiresAt ? `${form.expiresAt}T23:59:59+05:00` : null };
    try { await api('/promos', { method: 'POST', body }); setForm(null); reload(); } catch (e) { setErr(e.message); }
  };
  const toggle = (p, on) => act(() => api('/promos', { method: 'POST', body: { ...p, active: on } }), on ? '✅ Yoqildi' : "⏸ O'chirildi").then((r) => r && reload());
  const remove = () => act(() => api(`/promos/${del.code}`, { method: 'DELETE' }), "🗑 O'chirildi").then((r) => { setDel(null); r && reload(); });
  const items = data.items;

  return (
    <>
      <PageHeader title="Promo-kodlar" subtitle="Mijoz gift oynasida «Promo-kod» ni bosib kiritadi — chegirma darhol narxda ko'rinadi"
        actions={<button className="btn-dark" onClick={() => { setErr(''); setForm({ ...EMPTY }); }}><Plus size={16} /> Yangi promo-kod</button>} />
      <Card className="mb-5 flex items-start gap-2 p-4 text-sm text-slate-600"><Info size={16} className="mt-0.5 shrink-0 text-sky-600" />
        Chegirma faqat sizning foydangizdan (ustama + xizmat haqi) olinadi — tannarxdan pastga tushmaydi, ya'ni promo hech qachon zarar keltirmaydi.
        Bekor qilingan buyurtma foydalanishni qaytaradi.</Card>

      {items.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {items.map((p) => {
            const expired = p.expiresAt && new Date(p.expiresAt) < new Date();
            return (
              <Card key={p.code} className={`p-4 ${!p.active || expired ? 'opacity-60' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className="grid h-11 w-11 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600"><TicketPercent size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="font-mono text-lg font-bold tracking-wider">{p.code}</p>
                    <p className="text-xs text-slate-500">{p.percent ? `−${p.percent}%` : `−${som(p.amount)}`} · {CATS[p.category] || p.category}</p>
                  </div>
                  <Toggle checked={p.active} onChange={(v) => toggle(p, v)} />
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  <Badge tone="green">{fmt(p.used)}{p.maxUses ? ` / ${fmt(p.maxUses)}` : ''} ishlatildi</Badge>
                  <Badge>{p.perUser ? `1 mijozga ${p.perUser} marta` : 'Cheksiz'}</Badge>
                  {p.expiresAt && <Badge tone={expired ? 'red' : 'amber'}>{expired ? 'Muddati tugagan' : `${date(p.expiresAt)} gacha`}</Badge>}
                  {p.discountTotal > 0 && <Badge tone="violet">Jami chegirma {som(p.discountTotal)}</Badge>}
                </div>
                {p.note && <p className="mt-2 text-xs text-slate-500">{p.note}</p>}
                <div className="mt-3 grid grid-cols-2 gap-2 [&>button]:justify-center">
                  <button className="btn-light" onClick={() => edit(p)}><Pencil size={15} /> Tahrirlash</button>
                  <button className="btn-light text-rose-600" onClick={() => setDel(p)}><Trash2 size={15} /> O'chirish</button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Card><Empty icon="🎟" text="Hali promo-kod yo'q. «Yangi promo-kod» ni bosing" /></Card>}

      <Modal open={!!form} onClose={() => setForm(null)} title={form?.createdAt ? `${form.code} — tahrirlash` : 'Yangi promo-kod'}
        footer={<><button className="btn-light" onClick={() => setForm(null)}>Bekor</button><button className="btn-dark" disabled={!form?.code?.trim()} onClick={save}>Saqlash</button></>}>
        {form && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">Kod
              <input className="input mt-1 font-mono uppercase tracking-wider" value={form.code} disabled={!!form.createdAt} maxLength={24}
                placeholder="YANGI10" onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') })} /></label>
            <div className="grid grid-cols-2 gap-2">
              {[['percent', 'Foiz (%)'], ['amount', "So'm"]].map(([k, l]) => (
                <button key={k} className={form.type === k ? 'btn-dark justify-center' : 'btn-light justify-center'} onClick={() => setForm({ ...form, type: k })}>{l}</button>))}
            </div>
            {form.type === 'percent'
              ? <label className="block text-sm font-medium">Chegirma, % (1–90)<input type="number" min={1} max={90} className="input mt-1" value={form.percent} onChange={set('percent')} /></label>
              : <label className="block text-sm font-medium">Chegirma, so'm<input type="number" min={100} step={500} className="input mt-1" value={form.amount} onChange={set('amount')} /></label>}
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Jami limit<input type="number" min={0} className="input mt-1" value={form.maxUses} onChange={set('maxUses')} /><span className="text-xs text-slate-500">0 = cheksiz</span></label>
              <label className="block text-sm font-medium">1 mijozga<input type="number" min={0} className="input mt-1" value={form.perUser} onChange={set('perUser')} /><span className="text-xs text-slate-500">0 = cheksiz</span></label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium">Qaysi bo'lim<select className="input mt-1" value={form.category} onChange={set('category')}>
                {Object.entries(CATS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label className="block text-sm font-medium">Amal qilish muddati<input type="date" className="input mt-1" value={form.expiresAt} onChange={set('expiresAt')} /></label>
            </div>
            <label className="block text-sm font-medium">Izoh (faqat sizga)<input className="input mt-1" value={form.note} maxLength={200} onChange={set('note')} placeholder="Masalan: kanal uchun aksiya" /></label>
            <Toggle checked={form.active} onChange={(v) => setForm({ ...form, active: v })} label="Faol" />
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        )}
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title="Promo-kodni o'chirish"
        footer={<><button className="btn-light" onClick={() => setDel(null)}>Bekor</button><button className="btn-dark" onClick={remove}>O'chirish</button></>}>
        <p className="text-sm">«{del?.code}» o'chiriladi. Avval yaratilgan buyurtmalarga ta'sir qilmaydi.</p>
      </Modal>
    </>
  );
}
