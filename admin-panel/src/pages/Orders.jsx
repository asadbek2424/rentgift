import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ClipboardCheck, Check, X, Ban, KeyRound, PenLine, RotateCcw, Undo2, PiggyBank, ImageOff, ZoomIn, Search, Wallet, Link2, Unlink, Clock, AlertTriangle, ExternalLink } from 'lucide-react';
import { Card, CardHeader, PageHeader, Badge, Avatar, Tabs, Modal, Loading, ErrorBox, Empty, som, ago, fmt } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { adminApi, apiBlobUrl, useApi } from '../data/api.js';
import { ORDER_STATUS, CATEGORY, ts } from '../data/status.js';
import { signTx, useWallet, shortAddr } from '../data/ton.js';

const TABS = [
  ['review', 'Chek tekshiruvi'], ['paid', 'Ijaraga olish'], ['sign', 'Imzo / blokcheyn'],
  ['active', 'Faol'], ['problem', 'Muammoli'], ['all', 'Barchasi'],
];

function Receipt({ id, onZoom }) {
  const [src, setSrc] = useState(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url;
    apiBlobUrl(`/orders/${id}/receipt`).then((u) => { url = u; setSrc(u); }).catch(() => setFailed(true));
    return () => url && URL.revokeObjectURL(url);
  }, [id]);
  if (failed) return <div className="grid h-40 place-items-center rounded-xl bg-white/50 text-sm text-slate-500"><ImageOff /> Chek yuklanmadi (PDF bo'lishi mumkin)</div>;
  if (!src) return <div className="h-40 animate-pulse rounded-xl bg-white/50" />;
  return (
    <button className="group relative block h-40 w-full overflow-hidden rounded-xl bg-white" onClick={() => onZoom(src)}>
      <img src={src} alt="Chek" className="h-full w-full object-cover object-top" />
      <span className="absolute inset-0 grid place-items-center bg-slate-900/0 text-white opacity-0 transition group-hover:bg-slate-900/30 group-hover:opacity-100"><ZoomIn /></span>
    </button>
  );
}

function GiftThumb({ o }) {
  const [bad, setBad] = useState(false);
  if (o.image && !bad && (o.category || 'gift') === 'gift') {
    return <img src={o.image} alt="" referrerPolicy="no-referrer" onError={() => setBad(true)} className="h-12 w-12 shrink-0 rounded-xl object-cover" />;
  }
  return <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-600 text-lg text-white">{o.category === 'number' ? '📞' : o.category === 'username' ? '@' : '🎁'}</span>;
}

export default function Orders() {
  const act = useAction();
  const [params, setParams] = useSearchParams();
  const focus = Number(params.get('order')) || 0;
  const [tab, setTab] = useState(params.get('f') || (focus ? 'all' : 'review'));
  const [q, setQ] = useState(focus ? String(focus) : '');
  const [zoom, setZoom] = useState(null);
  const [confirm, setConfirm] = useState(null);   // {o, action, text}
  const [busy, setBusy] = useState(0);
  const wallet = useWallet();
  const { data, error, loading, reload } = useApi(`/orders?filter=${tab}`, { refreshMs: 20000, source: 'admin' });

  useEffect(() => { const f = params.get('f'); if (f && f !== tab) setTab(f); }, [params]); // eslint-disable-line
  useEffect(() => {
    if (!focus || !data) return;
    const el = document.getElementById(`o-${focus}`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focus, data]);

  const items = useMemo(() => {
    const term = q.trim().toLowerCase().replace(/^[#@]/, '');
    return (data?.items || []).filter((o) => !term || [o.id, o.nft_name, o.user_id, o.user?.username, o.user?.name].some((v) => String(v ?? '').toLowerCase().includes(term)));
  }, [data, q]);

  const run = async (o, action) => {
    setBusy(o.id);
    if (action === 'sign') {
      await act(() => signTx('order', o.id), (r) => r);
    } else {
      const labels = { 'confirm-payment': "✅ To'lov tasdiqlandi", 'reject-payment': '❌ Chek rad etildi', cancel: '🚫 Bekor qilindi',
        retry: '🔁 Qayta urinish boshlandi', refunded: "💸 Pul qaytarildi deb belgilandi", tobalance: "💰 Summa mijoz balansiga qaytarildi" };
      await act(() => adminApi(`/orders/${o.id}/${action}`, { method: 'POST' }), labels[action]);
    }
    setBusy(0); setConfirm(null); reload();
  };
  const ask = (o, action, text) => setConfirm({ o, action, text });

  const actions = (o) => {
    const B = ({ cls = 'btn-light', icon: I, children, onClick }) => (
      <button className={`${cls} justify-center whitespace-nowrap`} disabled={busy === o.id} onClick={onClick}><I size={15} /> {children}</button>
    );
    switch (o.status) {
      case 'payment_review':
      case 'awaiting_payment':
        return (<>
          <B cls="btn-green" icon={Check} onClick={() => run(o, 'confirm-payment')}>Pul keldi</B>
          {o.status === 'payment_review' && <B cls="btn-light text-rose-600" icon={X} onClick={() => ask(o, 'reject-payment', "Chek rad etilsinmi? Mijozga qayta yuklash so'raladi.")}>Rad etish</B>}
          <B icon={Ban} onClick={() => ask(o, 'cancel', 'Buyurtma bekor qilinsinmi?')}>Bekor</B>
        </>);
      case 'paid':
        return (<>
          <B cls="btn-dark" icon={KeyRound} onClick={() => run(o, 'sign')}>Ijaraga olish (imzo)</B>
          <B icon={Undo2} onClick={() => ask(o, 'refunded', "Pul mijozga qaytarildimi? Buyurtma yopiladi.")}>Pul qaytarildi</B>
          <B icon={Ban} onClick={() => ask(o, 'cancel', 'Buyurtma bekor qilinsinmi?')}>Bekor</B>
        </>);
      case 'connect_signing':
        return <B cls="btn-dark" icon={PenLine} onClick={() => run(o, 'sign')}>Tez imzolash (ulash)</B>;
      case 'failed':
        return (<>
          <B cls="btn-dark" icon={RotateCcw} onClick={() => run(o, 'retry')}>Qayta urinish</B>
          <B icon={PiggyBank} onClick={() => ask(o, 'tobalance', "Summa mijozning ilova balansiga qaytarilsinmi?")}>Balansga</B>
          <B icon={Undo2} onClick={() => ask(o, 'refunded', 'Pul kartaga qaytarildi deb belgilansinmi?')}>Kartaga qaytarildi</B>
          <B icon={Ban} onClick={() => ask(o, 'cancel', 'Buyurtma bekor qilinsinmi?')}>Bekor</B>
        </>);
      default: return null;
    }
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const c = data.counts || {};
  const hot = wallet.mode === 'hot';

  return (
    <>
      <PageHeader title="Buyurtmalar" subtitle="Chekni tekshiring → Marketapp'da ijaraga oling → mijoz Telegram'ni ulaydi. Hammasi shu yerda." />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <div className="max-w-full overflow-x-auto">
              <Tabs value={tab} onChange={(v) => { setTab(v); setParams({ f: v }); }} items={TABS.map(([value, label]) => ({ value, label, count: value === 'all' ? undefined : c[value] || 0 }))} />
            </div>
            <div className="relative ml-auto w-full sm:w-64">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/70" />
              <input className="input !bg-white/60 pl-9" placeholder="#id, gift, @username" value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>

          {items.length ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <AnimatePresence mode="popLayout">
                {items.map((o) => {
                  const [label, tone] = ORDER_STATUS[o.status] || [o.status, 'slate'];
                  const u = o.user || {};
                  const acts = actions(o);
                  return (
                    <motion.div key={o.id} id={`o-${o.id}`} layout initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.9 }}>
                      <Card className={`p-4 ${o.status === 'failed' ? 'ring-2 ring-rose-400/60' : ''} ${focus === o.id ? 'ring-2 ring-sky-400' : ''}`}>
                        <div className="flex items-center gap-3">
                          <GiftThumb o={o} />
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-semibold">{o.nft_name}</p>
                            <p className="truncate text-xs text-slate-500">#{o.id} · {CATEGORY[o.category] || o.category} · {o.days} kun{o.kind === 'extend' ? ` · uzaytirish #${o.parent_id}` : ''}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold">{som(o.amount_uzs)}</p>
                            <p className="text-[11px] text-slate-500">{o.paid_by === 'balance' ? 'balansdan' : 'karta'}</p>
                          </div>
                        </div>

                        <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/50 px-2.5 py-2">
                          <Avatar name={u.name || String(o.user_id)} size={28} />
                          <div className="min-w-0 flex-1 text-xs">
                            <p className="truncate font-medium text-slate-800">{u.name || o.user_id}</p>
                            <p className="truncate text-slate-500">{u.username ? `@${u.username} · ` : ''}ID {o.user_id}</p>
                          </div>
                          <Badge tone={tone}>{label}</Badge>
                        </div>

                        <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                          <dt className="text-slate-500">TON (xarajat)</dt><dd className="text-right font-medium">{o.ton_total} TON{o.actual_ton ? ` · tx ${o.actual_ton}` : ''}</dd>
                          <dt className="text-slate-500">Tannarx</dt><dd className="text-right font-medium">{som(o.cost_uzs)}</dd>
                          <dt className="text-slate-500">Foyda</dt><dd className="text-right font-bold text-amber-600">{som(o.profit_uzs)}</dd>
                          <dt className="text-slate-500">Yaratilgan</dt><dd className="text-right">{ago(ts(o.created_at))}</dd>
                          {o.end_time && <><dt className="text-slate-500">Tugaydi</dt><dd className="text-right">{new Date(o.end_time).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</dd></>}
                          {o.unique_add_uzs > 0 && <><dt className="text-slate-500">Noyob qo'shimcha</dt><dd className="text-right">+{fmt(o.unique_add_uzs)} so'm</dd></>}
                        </dl>
                        {o.error && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" /> {o.error}</p>}

                        {o.has_receipt && ['payment_review', 'awaiting_payment', 'paid'].includes(o.status) && <div className="mt-3"><Receipt id={o.id} onZoom={setZoom} /></div>}
                        {acts && <div className="mt-3 flex flex-wrap gap-2 [&>button]:flex-1">{acts}</div>}
                      </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          ) : <Card><Empty icon="🧾" text={q ? "Qidiruvga mos buyurtma yo'q" : "Bu bo'limda buyurtma yo'q"} /></Card>}
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2"><Wallet size={18} className="text-sky-600" /><h3 className="font-semibold">Admin hamyoni</h3></div>
            {hot ? (
              <p className="mt-2 text-sm text-slate-600">🔥 <b>Hot rejim</b>: server tranzaksiyalarni o'zi imzolaydi. "Ijaraga olish" bosilsa, to'lov darhol yuboriladi.</p>
            ) : (
              <>
                <p className="mt-1 text-xs text-slate-500">Marketapp token yaratilgan hamyon (Tonkeeper / Telegram Wallet). Ijara va ulash shu yerdan imzolanadi.</p>
                <div className="mt-3 rounded-xl bg-white/60 px-3 py-2.5 text-sm">
                  {wallet.account ? (
                    <div className="flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${wallet.ok ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      <span className="font-mono">{shortAddr(wallet.account.address)}</span>
                      {!wallet.ok && <Badge tone="red">Boshqa hamyon</Badge>}
                    </div>
                  ) : <span className="text-slate-500">Ulanmagan</span>}
                </div>
                {wallet.account
                  ? <button className="btn-light mt-3 w-full justify-center" onClick={wallet.disconnect}><Unlink size={15} /> Uzish</button>
                  : <button className="btn-dark mt-3 w-full justify-center" onClick={() => wallet.connect().catch(() => {})}><Link2 size={15} /> Hamyonni ulash</button>}
              </>
            )}
          </Card>

          <Card>
            <CardHeader title="Jarayon" subtitle="Buyurtma qanday yuradi" />
            <ol className="space-y-3 px-5 pb-5 pt-4 text-sm">
              {[
                [ClipboardCheck, "Mijoz kartaga o'tkazadi, chek yuklaydi (yoki CardXabar o'zi tasdiqlaydi)"],
                [Check, "«Pul keldi» — bank ilovasida tekshirib bosing"],
                [KeyRound, "«Ijaraga olish» — hamyonda imzolaysiz, Marketapp'da ijara boshlanadi"],
                [Clock, 'Blokcheyn tasdig\'idan keyin mijoz «Telegramni ulash»ni bosadi'],
                [ExternalLink, "Gift mijoz profilida — muddat tugashidan 24 soat oldin eslatma"],
              ].map(([I, text], i) => (
                <li key={i} className="flex gap-3"><span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-700"><I size={14} /></span><span className="text-slate-700">{text}</span></li>
              ))}
            </ol>
          </Card>
        </div>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? `Buyurtma #${confirm.o.id}` : ''}
        footer={confirm && <><button className="btn-light" onClick={() => setConfirm(null)}>Yo'q</button><button className="btn-red" disabled={busy === confirm.o.id} onClick={() => run(confirm.o, confirm.action)}>Ha, bajarish</button></>}
      >
        {confirm && <p className="text-sm text-slate-700">{confirm.text}</p>}
      </Modal>

      <Modal open={!!zoom} onClose={() => setZoom(null)} title="Chek">
        {zoom && <img src={zoom} alt="Chek" className="max-h-[70vh] w-full rounded-xl object-contain" />}
      </Modal>
    </>
  );
}

