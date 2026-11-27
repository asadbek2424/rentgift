import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Link2Off, RotateCcw, BellRing, Send, Clock, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { Card, PageHeader, Badge, Avatar, Modal, Loading, ErrorBox, Empty } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, useApi } from '../data/api.js';

const ERR = {
  login_expired: ['Telegram kirishi eskirgan', 'red'], display_failed: ['Telegram/Fragment rad etdi', 'red'],
  display_limit: ['Fragment cheklovi (3/soat)', 'amber'], wrong_account: ['Boshqa akkaunt tasdiqladi', 'amber'],
  marketapp: ['Marketapp javob bermadi', 'amber'],
};
const ago = (m) => (m == null ? '—' : m < 60 ? `${m} daq` : m < 1440 ? `${Math.round(m / 60)} soat` : `${Math.round(m / 1440)} kun`);

export default function ConnectIssues() {
  const act = useAction();
  const nav = useNavigate();
  const { data, error, loading, reload } = useApi('/connect-issues', { refreshMs: 30000 });
  const [msg, setMsg] = useState(null);   // {userId, name, text}
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const retry = (o) => act(() => api(`/orders/${o.id}/tg-retry`, { method: 'POST' }), `✅ #${o.id} profilga qo'yildi`).then((r) => r && reload());
  const remind = (o) => act(() => api(`/orders/${o.id}/tg-remind`, { method: 'POST' }), '🔔 Eslatma yuborildi').then((r) => r && reload());
  const send = () => act(() => api(`/users/${msg.userId}/message`, { method: 'POST', body: { text: msg.text } }), '📩 Yuborildi').then((r) => r && setMsg(null));
  const items = data.items;
  const stuck = items.filter((o) => (o.minutes ?? 0) >= 15);

  return (
    <>
      <PageHeader title="Ulash muammolari" subtitle="To'langan va ijaraga olingan, lekin hali mijoz profiliga chiqmagan giftlar" />
      <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card className="flex items-center gap-3 p-4"><Link2Off className="text-rose-600" /><div><p className="text-2xl font-bold">{items.length}</p><p className="text-xs text-slate-500">ulanmagan buyurtma</p></div></Card>
        <Card className="flex items-center gap-3 p-4"><Clock className="text-amber-600" /><div><p className="text-2xl font-bold">{stuck.length}</p><p className="text-xs text-slate-500">15 daqiqadan ko'p kutyapti</p></div></Card>
        <Card className="flex items-start gap-2 p-4 text-xs text-slate-600"><Info size={15} className="mt-0.5 shrink-0 text-sky-600" />
          Mijoz Telegram'da tasdiqlasa, server giftni o'zi qo'yadi (ilova yopilgan bo'lsa ham). 15 daqiqada ulanmaganlarga bot bir marta eslatadi.</Card>
      </div>

      {items.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {items.map((o) => {
            const [label, tone] = ERR[o.error] || (o.waiting ? ['Tasdiqlashni kutyapmiz', 'blue'] : ['Mijoz hali boshlamagan', 'slate']);
            return (
              <Card key={o.id} className={`p-4 ${['login_expired', 'display_failed'].includes(o.error) ? 'ring-2 ring-rose-400/50' : ''}`}>
                <div className="flex items-center gap-3">
                  <Avatar name={o.name || String(o.userId)} />
                  <div className="min-w-0 flex-1">
                    <button className="truncate text-left font-semibold hover:underline" onClick={() => nav(`/orders?order=${o.id}`)}>#{o.id} · {o.gift}</button>
                    <p className="truncate text-xs text-slate-500">{o.name}{o.username ? ` · @${o.username}` : ''} · ID {o.userId}</p>
                  </div>
                  <div className="text-right text-xs text-slate-500"><Clock size={12} className="inline" /> {ago(o.minutes)}</div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <Badge tone={tone}>{o.error ? <AlertTriangle size={11} /> : null}{label}</Badge>
                  <Badge>{o.attempts} urinish</Badge>
                  {o.tgReady && <Badge tone="green"><CheckCircle2 size={11} /> Telegram ulangan</Badge>}
                  {o.reminded && <Badge tone="violet"><BellRing size={11} /> eslatildi</Badge>}
                </div>
                {o.lastNote && <p className="mt-2 truncate rounded-lg bg-white/50 px-2.5 py-1.5 text-[11px] text-slate-600" title={o.lastNote}>{o.lastNote}</p>}
                <div className="mt-3 grid grid-cols-3 gap-2 [&>button]:justify-center">
                  <button className="btn-dark" disabled={!o.tgReady} title={o.tgReady ? '' : 'Mijoz hali Telegram kirishini tasdiqlamagan'} onClick={() => retry(o)}><RotateCcw size={15} /> Qayta</button>
                  <button className="btn-light" onClick={() => remind(o)}><BellRing size={15} /> Eslatma</button>
                  <button className="btn-light" onClick={() => setMsg({ userId: o.userId, name: o.name, text: `Assalomu alaykum! «${o.gift}» giftingizni profilga chiqarish uchun ilovada «Telegramni ulash»ni bosing va Telegram'dagi «Kirishga urinish» xabarida «Tasdiqlash»ni bosing. Muammo bo'lsa, shu yerga yozing.` })}><Send size={15} /> Yozish</button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Card><Empty icon="✅" text="Hamma ijaralar mijozlar profilida — muammo yo'q" /></Card>}

      <Modal open={!!msg} onClose={() => setMsg(null)} title={msg ? `${msg.name} ga xabar` : ''}
        footer={<><button className="btn-light" onClick={() => setMsg(null)}>Bekor</button><button className="btn-dark" disabled={!msg?.text?.trim()} onClick={send}><Send size={15} /> Yuborish</button></>}>
        {msg && <textarea className="input min-h-32" value={msg.text} onChange={(e) => setMsg({ ...msg, text: e.target.value })} />}
      </Modal>
    </>
  );
}
