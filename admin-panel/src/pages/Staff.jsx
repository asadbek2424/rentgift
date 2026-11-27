import { useState } from 'react';
import { UserPlus, Trash2, Crown, Headset, Lock, Info, AlertTriangle } from 'lucide-react';
import { Card, PageHeader, Badge, Avatar, Modal, Loading, ErrorBox } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, useApi } from '../data/api.js';

const ROLES = {
  owner: { label: 'Admin (egasi)', icon: Crown, tone: 'amber', text: "Hamma narsa: narxlar, foyda, karta, sozlamalar, adminlar. Bot xabarlari va tugmalari ham keladi." },
  operator: { label: 'Operator', icon: Headset, tone: 'blue', text: "Faqat buyurtmalar, balans to'ldirish, Stars/Premium, mijozlar va ulash muammolari. Foyda va sozlamalarni ko'rmaydi." },
};

export default function Staff() {
  const act = useAction();
  const { data, error, loading, reload } = useApi('/staff');
  const [form, setForm] = useState(null);   // {id, role}
  const [err, setErr] = useState('');
  const [del, setDel] = useState(null);
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const owner = data.me.role === 'owner';
  const add = async () => {
    setErr('');
    const id = Number(String(form.id).trim());
    if (!Number.isInteger(id) || id <= 0) { setErr("Telegram ID faqat raqamlardan iborat bo'ladi"); return; }
    try {
      const r = await api('/staff', { method: 'POST', body: { id, role: form.role } });
      setForm(null); reload();
      act(async () => true, r.notified ? '✅ Qo\'shildi — botda xabar yuborildi' : "✅ Qo'shildi. U botga /start bosgach /panel orqali kiradi");
    } catch (e) { setErr(e.message); }
  };
  const remove = () => act(() => api(`/staff/${del.id}`, { method: 'DELETE' }), "🗑 Huquq olib tashlandi").then((r) => { setDel(null); r && reload(); });

  return (
    <>
      <PageHeader title="Adminlar" subtitle="Telegram ID ni kiriting — u darhol admin yoki operator bo'ladi"
        actions={owner && <button className="btn-dark" onClick={() => { setErr(''); setForm({ id: '', role: 'owner' }); }}><UserPlus size={16} /> Admin qo'shish</button>} />

      <Card className="mb-5 flex items-start gap-2 p-4 text-sm text-slate-600"><Info size={16} className="mt-0.5 shrink-0 text-sky-600" />
        <span>Telegram ID ni @userinfobot yoki @getmyid_bot orqali bilish mumkin. Qo'shilgan odam botga <b>/start</b> bosgan bo'lishi kerak —
        keyin <b>/panel</b> buyrug'i bilan panelga kiradi. Railway'dagi <code>ADMIN_IDS</code> dagi asosiy adminlarni bu yerdan o'chirib bo'lmaydi.</span></Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {data.items.map((p) => {
          const R = ROLES[p.role] || ROLES.owner;
          return (
            <Card key={p.id} className="p-4">
              <div className="flex items-center gap-3">
                <Avatar name={p.name || String(p.id)} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-semibold">{p.name || `ID ${p.id}`}{p.id === data.me.id && <span className="ml-1 text-xs text-slate-500">(siz)</span>}</p>
                  <p className="truncate text-xs text-slate-500">{p.username ? `@${p.username} · ` : ''}ID {p.id}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone={R.tone}><R.icon size={11} /> {R.label}</Badge>
                {p.fixed && <Badge><Lock size={11} /> Railway (asosiy)</Badge>}
                {!p.startedBot && <Badge tone="red"><AlertTriangle size={11} /> Botga /start bosmagan</Badge>}
              </div>
              {owner && !p.fixed && p.id !== data.me.id && (
                <button className="btn-light mt-3 w-full justify-center text-rose-600" onClick={() => setDel(p)}><Trash2 size={15} /> Huquqni olib tashlash</button>
              )}
            </Card>
          );
        })}
      </div>

      <Modal open={!!form} onClose={() => setForm(null)} title="Admin qo'shish"
        footer={<><button className="btn-light" onClick={() => setForm(null)}>Bekor</button><button className="btn-dark" disabled={!String(form?.id || '').trim()} onClick={add}><UserPlus size={15} /> Qo'shish</button></>}>
        {form && (
          <div className="space-y-3">
            <label className="block text-sm font-medium">Telegram ID
              <input className="input mt-1" inputMode="numeric" placeholder="123456789" value={form.id} autoFocus
                onChange={(e) => setForm({ ...form, id: e.target.value.replace(/[^0-9]/g, '') })} onKeyDown={(e) => e.key === 'Enter' && add()} /></label>
            <p className="text-sm font-medium">Huquq</p>
            {Object.entries(ROLES).map(([k, R]) => (
              <button key={k} onClick={() => setForm({ ...form, role: k })}
                className={`flex w-full items-start gap-3 rounded-xl p-3 text-left transition ${form.role === k ? 'bg-slate-900 text-white' : 'bg-white/60 hover:bg-white/80'}`}>
                <R.icon size={18} className="mt-0.5 shrink-0" />
                <span><b className="block text-sm">{R.label}</b><span className={`text-xs ${form.role === k ? 'text-white/70' : 'text-slate-500'}`}>{R.text}</span></span>
              </button>
            ))}
            {err && <p className="text-sm text-rose-600">{err}</p>}
          </div>
        )}
      </Modal>
      <Modal open={!!del} onClose={() => setDel(null)} title="Huquqni olib tashlash"
        footer={<><button className="btn-light" onClick={() => setDel(null)}>Bekor</button><button className="btn-dark" onClick={remove}>Olib tashlash</button></>}>
        <p className="text-sm">{del?.name || `ID ${del?.id}`} endi panelga kira olmaydi va bot admin xabarlarini olmaydi. Hozirgi sessiyasi ham darhol to'xtaydi.</p>
      </Modal>
    </>
  );
}
