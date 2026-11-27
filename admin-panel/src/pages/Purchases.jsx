import { useState } from 'react';
import { PenLine, RotateCcw, CheckCheck, Undo2, Star, Crown, AlertTriangle } from 'lucide-react';
import { Card, PageHeader, Badge, Avatar, Tabs, Modal, Loading, ErrorBox, Empty, som, ago, fmt } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { adminApi, useApi } from '../data/api.js';
import { PURCHASE_STATUS, ts } from '../data/status.js';
import { signTx } from '../data/ton.js';

export default function Purchases() {
  const act = useAction();
  const [tab, setTab] = useState('open');
  const [busy, setBusy] = useState(0);
  const [refund, setRefund] = useState(null);
  const { data, error, loading, reload } = useApi(`/purchases?filter=${tab}`, { refreshMs: 15000, source: 'admin' });

  const run = async (x, action) => {
    setBusy(x.id);
    const labels = { retry: '🔁 Qayta yuborildi', done: '✅ Bajarildi deb belgilandi', refund: "💸 Pul mijoz balansiga qaytarildi" };
    if (action === 'sign') await act(() => signTx('purchase', x.id), (r) => r);
    else await act(() => adminApi(`/purchases/${x.id}/${action}`, { method: 'POST' }), labels[action]);
    setBusy(0); setRefund(null); reload();
  };

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;

  return (
    <>
      <PageHeader title="Stars va Premium" subtitle="Fragment orqali istalgan @username'ga Telegram Stars yoki Premium — balansdan to'lanadi" />
      <div className="mb-4"><Tabs value={tab} onChange={setTab} items={[{ value: 'open', label: 'Navbatda' }, { value: 'all', label: 'Barchasi' }]} /></div>
      {data.items.length ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.items.map((x) => {
            const [label, tone] = PURCHASE_STATUS[x.status] || [x.status, 'slate'];
            const stars = x.kind === 'stars';
            const u = x.user || {};
            return (
              <Card key={x.id} hover className={`p-4 ${x.status === 'failed' ? 'ring-2 ring-rose-400/60' : ''}`}>
                <div className="flex items-center gap-3">
                  <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl text-white shadow ${stars ? 'bg-gradient-to-br from-amber-300 to-orange-500' : 'bg-gradient-to-br from-violet-400 to-indigo-600'}`}>{stars ? <Star size={22} /> : <Crown size={22} />}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{stars ? `${fmt(x.quantity)} Stars` : `Premium · ${x.quantity} oy`}</p>
                    <p className="truncate text-xs text-slate-500">→ @{x.recipient}{x.recipient_name ? ` (${x.recipient_name})` : ''}</p>
                  </div>
                  <div className="text-right"><p className="text-sm font-bold">{som(x.price_uzs)}</p><p className="text-[11px] text-slate-500">{x.cost_ton} TON</p></div>
                </div>
                <div className="mt-3 flex items-center gap-2 rounded-xl bg-white/50 px-2.5 py-2">
                  <Avatar name={u.name || String(x.user_id)} size={26} />
                  <p className="min-w-0 flex-1 truncate text-xs"><span className="font-medium">{u.name || x.user_id}</span> <span className="text-slate-500">#{x.id} · {ago(ts(x.created_at))}</span></p>
                  <Badge tone={tone}>{label}</Badge>
                </div>
                {x.error && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-700"><AlertTriangle size={13} className="mt-0.5 shrink-0" />{x.error}</p>}
                <div className="mt-3 flex flex-wrap gap-2 [&>button]:flex-1 [&>button]:justify-center">
                  {x.status === 'signing' && <button className="btn-dark" disabled={busy === x.id} onClick={() => run(x, 'sign')}><PenLine size={15} /> Hamyonda imzolash</button>}
                  {x.status === 'failed' && <button className="btn-light" disabled={busy === x.id} onClick={() => run(x, 'retry')}><RotateCcw size={15} /> Qayta</button>}
                  {x.status === 'failed' && <button className="btn-green" disabled={busy === x.id} onClick={() => run(x, 'done')}><CheckCheck size={15} /> Bajarildi</button>}
                  {['signing', 'failed', 'pending'].includes(x.status) && <button className="btn-light text-rose-600" disabled={busy === x.id} onClick={() => setRefund(x)}><Undo2 size={15} /> Qaytarish</button>}
                </div>
              </Card>
            );
          })}
        </div>
      ) : <Card><Empty icon="⭐" text={tab === 'open' ? "Navbatda xarid yo'q" : "Hali xarid bo'lmagan"} /></Card>}

      <Modal open={!!refund} onClose={() => setRefund(null)} title={refund ? `Xarid #${refund.id}` : ''}
        footer={refund && <><button className="btn-light" onClick={() => setRefund(null)}>Yo'q</button><button className="btn-red" onClick={() => run(refund, 'refund')}>Ha, qaytarish</button></>}>
        {refund && <p className="text-sm text-slate-700"><b>{som(refund.price_uzs)}</b> mijoz balansiga qaytarilsinmi? Xarid yopiladi.</p>}
      </Modal>
    </>
  );
}
