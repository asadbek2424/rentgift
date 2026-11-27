import { useRef, useState } from 'react';
import { Send, Users, ShoppingBag, KeyRound, Bold, Italic, Link2, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Card, CardHeader, PageHeader, Badge, Loading, ErrorBox, fmt, ago } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, useApi } from '../data/api.js';

const SEGMENTS = [
  { id: 'all', label: 'Barcha foydalanuvchilar', icon: Users, hint: 'Botni bloklamaganlar' },
  { id: 'customers', label: 'Buyurtma berganlar', icon: ShoppingBag, hint: 'Kamida bitta buyurtma' },
  { id: 'active', label: 'Faol ijarachilar', icon: KeyRound, hint: 'Hozir ijarasi bor' },
];

export default function Broadcast() {
  const act = useAction();
  const { data, error, loading, reload } = useApi('/broadcast', { refreshMs: 4000 });
  const [segment, setSegment] = useState('all');
  const [text, setText] = useState('');
  const [btnText, setBtnText] = useState('');
  const [btnUrl, setBtnUrl] = useState('');
  const ta = useRef(null);

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  const reach = data.counts[segment] || 0;
  const st = data.status;
  const wrap = (tag) => {
    const el = ta.current; if (!el) return;
    const { selectionStart: a, selectionEnd: b } = el;
    setText(`${text.slice(0, a)}<${tag}>${text.slice(a, b) || 'matn'}</${tag}>${text.slice(b)}`);
  };
  const send = () => act(
    () => api('/broadcast', { method: 'POST', body: { text, segment, button_text: btnText.trim(), button_url: btnUrl.trim() } }),
    `📤 ${fmt(reach)} kishiga yuborilmoqda...`,
  ).then((r) => { if (r) { setText(''); reload(); } });
  const preview = (text || 'Xabar matni...').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/&lt;(\/?)(b|i|u|code)&gt;/g, '<$1$2>');

  return (
    <>
      <PageHeader title="Xabar tarqatish" subtitle="Bot orqali tanlangan guruhga xabar (va tugma) yuborish. Rasm/video uchun botda /broadcast ishlating." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card className="p-5 xl:col-span-3">
          {!data.botReady && <p className="mb-4 flex items-center gap-2 rounded-xl bg-amber-500/15 px-3 py-2 text-sm text-amber-800"><AlertCircle size={16} /> Bot ishlamayapti — BOT_TOKEN va RUN_BOT ni tekshiring.</p>}
          <h3 className="font-semibold">Kimga?</h3>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            {SEGMENTS.map(({ id, label, icon: Icon, hint }) => (
              <button key={id} onClick={() => setSegment(id)} className={`rounded-xl border px-3 py-2.5 text-left text-sm transition ${segment === id ? 'border-sky-500 bg-white/90 shadow-sm' : 'border-white/70 bg-white/45 hover:bg-white/70'}`}>
                <span className="flex items-center gap-2"><Icon size={16} className={segment === id ? 'text-sky-600' : 'text-slate-400'} /><span className="flex-1 font-medium">{label}</span></span>
                <span className="mt-1 flex justify-between text-xs text-slate-500"><span>{hint}</span><b>{fmt(data.counts[id] || 0)}</b></span>
              </button>
            ))}
          </div>

          <h3 className="mt-6 font-semibold">Xabar</h3>
          <div className="mt-2 overflow-hidden rounded-xl border border-white/80 bg-white/70">
            <div className="flex gap-1 border-b border-white/80 px-2 py-1.5 text-slate-500">
              <button title="Qalin" className="rounded-md p-1.5 hover:bg-white" onClick={() => wrap('b')}><Bold size={15} /></button>
              <button title="Qiya" className="rounded-md p-1.5 hover:bg-white" onClick={() => wrap('i')}><Italic size={15} /></button>
              <span className="ml-auto self-center text-xs">{text.length} / 4000</span>
            </div>
            <textarea ref={ta} maxLength={4000} className="min-h-40 w-full resize-y bg-transparent p-3 text-sm outline-none" placeholder="Masalan: 🎁 Yangi kolleksiya giftlari ijarada! 3 kunlik ijarada xizmat haqi yo'q." value={text} onChange={(e) => setText(e.target.value)} />
          </div>

          <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            <input className="input" placeholder="Tugma matni (ixtiyoriy)" maxLength={40} value={btnText} onChange={(e) => setBtnText(e.target.value)} />
            <div className="relative"><Link2 size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input className="input pl-9" placeholder="https://t.me/..." value={btnUrl} onChange={(e) => setBtnUrl(e.target.value)} /></div>
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-slate-600">Qabul qiluvchilar: <b>{fmt(reach)}</b> · taxminan {Math.max(1, Math.ceil(reach / 18 / 60))} daqiqa</p>
            <button className="btn-dark" disabled={!text.trim() || !reach || st.running || !data.botReady || (btnText && !btnUrl)} onClick={send}><Send size={16} /> Yuborish</button>
          </div>
        </Card>

        <div className="space-y-5 xl:col-span-2">
          <Card className="p-5">
            <p className="mb-3 text-sm font-semibold">Telegram'da ko'rinishi</p>
            <div className="rounded-2xl bg-[#8fb6d9] p-4">
              <div className="max-w-[85%]">
                <div className="whitespace-pre-wrap break-words rounded-2xl rounded-bl-md bg-white px-3.5 py-2.5 text-sm shadow-sm" dangerouslySetInnerHTML={{ __html: preview }} />
                {btnText && <div className="mt-1 rounded-xl bg-white/60 py-2 text-center text-sm font-medium text-sky-800">{btnText}</div>}
              </div>
            </div>
          </Card>

          <Card>
            <CardHeader title="Oxirgi tarqatish" subtitle={st.startedAt ? ago(st.startedAt) : "Bu sessiyada hali yuborilmagan"} />
            {st.total ? (
              <div className="px-5 pb-5 pt-4">
                <div className="flex items-center gap-2 text-sm">
                  {st.running ? <Badge tone="blue"><Loader2 size={11} className="animate-spin" /> Yuborilmoqda</Badge> : <Badge tone="green"><CheckCircle2 size={11} /> Tugadi</Badge>}
                  <span className="text-slate-500">{SEGMENTS.find((s) => s.id === st.segment)?.label}</span>
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/70"><div className="h-full rounded-full bg-gradient-to-r from-sky-400 to-blue-600 transition-all" style={{ width: `${Math.round((st.done / st.total) * 100)}%` }} /></div>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center text-sm">
                  <div className="rounded-xl bg-white/60 p-2"><p className="font-bold text-emerald-700">{fmt(st.ok)}</p><p className="text-[11px] text-slate-500">yetkazildi</p></div>
                  <div className="rounded-xl bg-white/60 p-2"><p className="font-bold text-rose-600">{fmt(st.fail)}</p><p className="text-[11px] text-slate-500">xato</p></div>
                  <div className="rounded-xl bg-white/60 p-2"><p className="font-bold">{fmt(st.done)}/{fmt(st.total)}</p><p className="text-[11px] text-slate-500">jarayon</p></div>
                </div>
              </div>
            ) : <p className="px-5 pb-5 pt-3 text-sm text-slate-500">Yuborilgandan keyin bu yerda jarayon ko'rinadi.</p>}
          </Card>
        </div>
      </div>
    </>
  );
}
