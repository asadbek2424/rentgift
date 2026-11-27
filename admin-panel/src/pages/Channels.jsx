import { useState } from 'react';
import { Plus, Trash2, ShieldCheck, ExternalLink, Radio, AlertTriangle, Info, CheckCircle2 } from 'lucide-react';
import { Card, PageHeader, Badge, Modal, Toggle, Loading, ErrorBox, Empty, fmt } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, useApi } from '../data/api.js';

export default function Channels() {
  const act = useAction();
  const { data, error, loading, reload } = useApi('/channels');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ input: '', invite_link: '' });
  const [err, setErr] = useState('');
  const [confirm, setConfirm] = useState(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const add = async () => {
    setErr('');
    try {
      await api('/channels', { method: 'POST', body: form });
      setOpen(false); setForm({ input: '', invite_link: '' }); reload();
    } catch (e) { setErr(e.message); }
  };
  const toggle = (c, on) => act(() => api(`/channels/${c.chat_id}/toggle`, { method: 'POST', body: { enabled: on } }),
    on ? '✅ Majburiy qilindi' : "⏸ Vaqtincha o'chirildi").then((r) => r && reload());
  const active = data.channels.filter((c) => c.enabled !== false).length;
  const bot = data.botUsername ? `@${data.botUsername}` : 'botni';

  return (
    <>
      <PageHeader title="Majburiy kanallar" subtitle="Mijoz botdan va Mini App'dan foydalanishdan oldin shu kanallarga obuna bo'lishi shart"
        actions={<button className="btn-dark" disabled={!data.botReady} onClick={() => { setErr(''); setOpen(true); }}><Plus size={16} /> Kanal qo'shish</button>} />

      {!data.botReady && <Card className="mb-5 flex items-center gap-3 p-4"><AlertTriangle className="shrink-0 text-amber-600" /><p className="text-sm">Bot ishlamayapti (BOT_TOKEN yoki RUN_BOT) — kanal qo'shib va obunani tekshirib bo'lmaydi.</p></Card>}

      <div className="mb-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-600">1</span>
          <div><p className="font-semibold">Botni kanalga admin qiling</p><p className="text-sm text-slate-600">Kanal → Administratorlar → {bot} ni qo'shing. Hech qanday maxsus huquq kerak emas — Telegram obunani faqat adminlarga ko'rsatadi.</p></div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-600">2</span>
          <div><p className="font-semibold">Kanal havolasini qo'shing</p><p className="text-sm text-slate-600">Ochiq kanal: @username yoki https://t.me/username. Yopiq kanal: ID (-100…) va taklif havolasi.</p></div>
        </Card>
        <Card className="flex items-start gap-3 p-4">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-600"><ShieldCheck size={18} /></span>
          <div><p className="font-semibold">Tayyor</p><p className="text-sm text-slate-600">Obuna bo'lmaganlarga «Obuna bo'ling → ✅ Tekshirish» chiqadi. Adminlarga hech qachon chiqmaydi.</p></div>
        </Card>
      </div>

      {data.channels.length ? (
        <>
          <p className="mb-3 text-sm text-white/85">{active ? `${active} ta kanal majburiy` : "Hamma kanallar vaqtincha o'chiq — bot hammaga ochiq"}</p>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.channels.map((c) => (
              <Card hover key={c.chat_id} className={`p-5 ${c.bot_admin === false ? 'ring-2 ring-rose-400/60' : ''}`}>
                <div className="flex items-start gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-sky-400 to-blue-600 text-white"><Radio size={20} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{c.title}</p>
                    <p className="truncate text-xs text-slate-500">{c.username ? `@${c.username}` : 'yopiq kanal'} · {c.chat_id}</p>
                  </div>
                  {c.enabled === false ? <Badge>O'chiq</Badge> : <Badge tone="green">Majburiy</Badge>}
                </div>
                {c.bot_admin === false && <p className="mt-3 flex gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-2 text-xs text-rose-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" />Bot bu kanalda admin emas — obuna tekshirilmaydi (mijozlar o'tkazib yuboriladi). Botni qayta admin qiling.</p>}
                {c.bot_admin === true && <p className="mt-3 flex items-center gap-1.5 text-xs text-emerald-700"><CheckCircle2 size={13} /> Bot admin — obuna tekshirilmoqda</p>}
                <div className="mt-2 border-t border-white/60 pt-1"><Toggle checked={c.enabled !== false} onChange={(v) => toggle(c, v)} label="Majburiy obuna" /></div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-slate-600">{c.members != null ? <><b>{fmt(c.members)}</b> obunachi</> : <span className="text-xs text-slate-400">obunachilar soni noma'lum</span>}</span>
                  <div className="flex gap-1">
                    {c.url && <a href={c.url} target="_blank" rel="noreferrer" title="Kanalni ochish" className="rounded-lg p-1.5 text-slate-500 hover:bg-white/80"><ExternalLink size={16} /></a>}
                    <button title="O'chirish" onClick={() => setConfirm(c)} className="rounded-lg p-1.5 text-slate-500 hover:bg-white/80 hover:text-rose-500"><Trash2 size={16} /></button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </>
      ) : <Card><Empty icon="📡" text="Majburiy kanal yo'q — bot hammaga ochiq" /></Card>}

      <Modal open={open} onClose={() => setOpen(false)} title="Majburiy kanal qo'shish"
        footer={<><button className="btn-light" onClick={() => setOpen(false)}>Bekor qilish</button><button className="btn-dark" disabled={!form.input.trim()} onClick={add}>Qo'shish</button></>}>
        <div className="space-y-3">
          <label className="block text-sm"><span className="mb-1 block text-slate-600">Kanal</span>
            <input className="input" autoFocus placeholder="@kanal, https://t.me/kanal yoki -100… ID" value={form.input} onChange={(e) => setForm({ ...form, input: e.target.value })} /></label>
          <label className="block text-sm"><span className="mb-1 block text-slate-600">Taklif havolasi (faqat yopiq kanal uchun, ixtiyoriy)</span>
            <input className="input" placeholder="https://t.me/+AbCdEf..." value={form.invite_link} onChange={(e) => setForm({ ...form, invite_link: e.target.value })} /></label>
          <p className="flex gap-1.5 rounded-xl bg-white/60 p-3 text-xs leading-relaxed text-slate-600"><Info size={14} className="mt-0.5 shrink-0 text-sky-600" />
            Avval {bot} ni kanalga admin qiling. Yopiq kanal ID sini bilish uchun kanaldan biror xabarni @userinfobot ga forward qiling. Taklif havolasi berilmasa, bot o'zi yaratadi (buning uchun «Foydalanuvchilarni taklif qilish» huquqi kerak).</p>
          {err && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700">{err}</p>}
        </div>
      </Modal>

      <Modal open={!!confirm} onClose={() => setConfirm(null)} title="Kanalni o'chirish"
        footer={<><button className="btn-light" onClick={() => setConfirm(null)}>Yo'q</button><button className="btn-red" onClick={() => act(() => api(`/channels/${confirm.chat_id}`, { method: 'DELETE' }), "Kanal o'chirildi").then((r) => { if (r) { setConfirm(null); reload(); } })}>Ha, o'chirish</button></>}>
        <p className="text-sm"><b>{confirm?.title}</b> majburiy kanallar ro'yxatidan o'chirilsinmi? Mijozlardan endi bu kanalga obuna so'ralmaydi.</p>
      </Modal>
    </>
  );
}
