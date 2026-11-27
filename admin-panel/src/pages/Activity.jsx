import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CreditCard, KeyRound, Link2, CheckCircle2, XCircle, AlertTriangle, Undo2, Clock, Circle, Bot, User, ShieldCheck } from 'lucide-react';
import { Card, PageHeader, Badge, Tabs, Loading, ErrorBox, Empty, ago, date } from '../components/ui.jsx';
import { useApi } from '../data/api.js';
import { ORDER_STATUS } from '../data/status.js';

const ICON = {
  payment_review: [CreditCard, 'bg-amber-500/15 text-amber-600'], paid: [CreditCard, 'bg-sky-500/15 text-sky-600'],
  renting: [KeyRound, 'bg-sky-500/15 text-sky-600'], awaiting_link: [Link2, 'bg-violet-500/15 text-violet-600'],
  connecting: [Link2, 'bg-violet-500/15 text-violet-600'], connect_signing: [KeyRound, 'bg-indigo-500/15 text-indigo-600'],
  active: [CheckCircle2, 'bg-emerald-500/15 text-emerald-600'], expired: [Clock, 'bg-slate-500/15 text-slate-600'],
  cancelled: [XCircle, 'bg-slate-500/15 text-slate-600'], failed: [AlertTriangle, 'bg-rose-500/15 text-rose-600'],
  refunded: [Undo2, 'bg-slate-500/15 text-slate-600'], extended: [CheckCircle2, 'bg-emerald-500/15 text-emerald-600'],
};
const actorLabel = (a = '') => {
  if (a.startsWith('admin:')) return [ShieldCheck, `Admin ${a.slice(6)}`];
  if (a.startsWith('user')) return [User, 'Mijoz'];
  if (['worker', 'system', 'auto', 'userbot', 'events'].some((k) => a.startsWith(k))) return [Bot, a === 'userbot' ? 'CardXabar' : 'Tizim'];
  return [Circle, a || '—'];
};

export default function Activity() {
  const nav = useNavigate();
  const [who, setWho] = useState('all');
  const { data, error, loading, reload } = useApi('/activity?limit=200', { refreshMs: 30000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const events = data.events.filter((e) => who === 'all' || (who === 'admin' ? e.actor.startsWith('admin') : !e.actor.startsWith('admin')));

  return (
    <>
      <PageHeader title="Faoliyat logi" subtitle="Har bir buyurtma holati o'zgarishi: kim, qachon, nimadan nimaga" />
      <div className="mb-4"><Tabs value={who} onChange={setWho} items={[{ value: 'all', label: 'Hammasi' }, { value: 'admin', label: 'Admin amallari' }, { value: 'auto', label: 'Tizim / mijoz' }]} /></div>
      <Card className="p-5">
        {events.length ? (
          <ol className="relative ml-3 space-y-1 border-l border-white/80 pl-6">
            {events.map((e) => {
              const [Icon, cls] = ICON[e.to] || [Circle, 'bg-slate-500/15 text-slate-600'];
              const [ActorIcon, actor] = actorLabel(e.actor);
              const [toLabel, tone] = ORDER_STATUS[e.to] || [e.to, 'slate'];
              return (
                <li key={e.id} className="relative">
                  <span className={`absolute -left-[38px] top-3 grid h-7 w-7 place-items-center rounded-full ring-4 ring-white/60 ${cls}`}><Icon size={14} /></span>
                  <button className="w-full rounded-xl p-3 text-left hover:bg-white/40" onClick={() => nav(`/orders?order=${e.orderId}`)}>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="flex items-center gap-1 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-slate-700"><ActorIcon size={12} /> {actor}</span>
                      <p className="text-sm"><b>#{e.orderId}</b> {e.gift}</p>
                      <span className="ml-auto text-xs text-slate-500" title={date(e.createdAt)}>{ago(e.createdAt)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>{(ORDER_STATUS[e.from] || [e.from])[0]}</span> → <Badge tone={tone}>{toLabel}</Badge>
                      {e.note && <span className="truncate">· {e.note}</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ol>
        ) : <Empty icon="📜" text="Hali hodisa yo'q" />}
      </Card>
    </>
  );
}
