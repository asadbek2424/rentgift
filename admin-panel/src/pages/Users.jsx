import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, Ban, Unlock, Send, PlusCircle, MinusCircle, ShieldCheck, Link2, BellOff } from 'lucide-react';
import { Card, PageHeader, Badge, Avatar, Tabs, Modal, Loading, ErrorBox, Empty, fmt, som, ago, date } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { api, adminApi, useApi } from '../data/api.js';
import { ORDER_STATUS } from '../data/status.js';

const KIND = { topup: "To'ldirish", order: 'Buyurtma', purchase: 'Stars/Premium', refund: 'Qaytarish', referral: 'Referal', admin: 'Admin' };

function UserModal({ id, onClose, onChanged }) {
  const act = useAction();
  const nav = useNavigate();
  const { data: u, error, loading, reload } = useApi(id ? `/users/${id}` : null);
  const [delta, setDelta] = useState(10000);
  const [msg, setMsg] = useState('');

  const balance = (sign) => act(() => adminApi(`/users/${id}/balance`, { method: 'POST', body: { delta: sign * Math.abs(delta) } }),
    (r) => `💰 Yangi balans: ${som(r.balance_uzs)}`).then((r) => { if (r) { reload(); onChanged(); } });
  const block = (on) => act(() => api(`/users/${id}/block`, { method: 'POST', body: { blocked: on } }), on ? '🚫 Bloklandi' : '🔓 Blokdan chiqarildi')
    .then((r) => { if (r) { reload(); onChanged(); } });
  const send = () => act(() => api(`/users/${id}/message`, { method: 'POST', body: { text: msg } }), '📩 Xabar yuborildi').then((r) => r && setMsg(''));

  return (
    <Modal open={!!id} onClose={onClose} title="Mijoz profili"
      footer={u && <button className="btn-light" onClick={() => block(!u.isBlocked)}>{u.isBlocked ? <><Unlock size={15} /> Blokdan chiqarish</> : <><Ban size={15} /> Bloklash</>}</button>}>
      {loading && !u ? <div className="h-40 animate-pulse rounded-xl bg-white/50" /> : error && !u ? <p className="text-sm text-rose-600">{error}</p> : u && (
        <div className="max-h-[65vh] space-y-4 overflow-y-auto pr-1">
          <div className="flex items-center gap-3">
            <Avatar name={u.name || '?'} size={52} />
            <div className="min-w-0">
              <p className="truncate text-lg font-semibold">{u.name}</p>
              <p className="text-sm text-slate-500">ID: {u.id}{u.username ? ` · @${u.username}` : ''}</p>
            </div>
            {u.isBlocked && <Badge tone="red">Bloklangan</Badge>}
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="rounded-xl bg-white/70 p-2"><p className="font-bold text-emerald-700">{som(u.balance)}</p><p className="text-[11px] text-slate-500">Balans</p></div>
            <div className="rounded-xl bg-white/70 p-2"><p className="font-bold text-sky-700">{som(u.spent)}</p><p className="text-[11px] text-slate-500">Jami xarid</p></div>
            <div className="rounded-xl bg-white/70 p-2"><p className="font-bold">{u.invited}</p><p className="text-[11px] text-slate-500">Taklif · {som(u.refEarned)}</p></div>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            <dt className="text-slate-500">Ro'yxatdan o'tgan</dt><dd>{u.createdAt ? date(u.createdAt) : '—'}</dd>
            <dt className="text-slate-500">Oxirgi faollik</dt><dd>{u.lastSeen ? ago(u.lastSeen) : '—'}</dd>
          </dl>

          <div className="rounded-xl bg-white/60 p-3">
            <p className="mb-2 text-sm font-medium">Balansni o'zgartirish</p>
            <div className="flex flex-wrap items-center gap-2">
              <input type="number" min={1} step={1000} className="input !w-32" value={delta} onChange={(e) => setDelta(Math.abs(Number(e.target.value)))} />
              <button className="btn-light" onClick={() => balance(1)}><PlusCircle size={15} /> Qo'shish</button>
              <button className="btn-light" onClick={() => balance(-1)}><MinusCircle size={15} /> Ayirish</button>
            </div>
          </div>

          <div className="rounded-xl bg-white/60 p-3">
            <p className="mb-2 text-sm font-medium">Shaxsiy xabar (bot orqali)</p>
            <textarea className="input min-h-20" placeholder="Xabar matni... (<b>, <i> ishlaydi)" value={msg} onChange={(e) => setMsg(e.target.value)} />
            <button className="btn-dark mt-2" disabled={!msg.trim()} onClick={send}><Send size={15} /> Yuborish</button>
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Buyurtmalar ({u.orders.length})</p>
            {u.orders.length ? (
              <ul className="space-y-1">
                {u.orders.map((o) => {
                  const [label, tone] = ORDER_STATUS[o.status] || [o.status, 'slate'];
                  return (
                    <li key={o.id}>
                      <button className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-white/60" onClick={() => { onClose(); nav(`/orders?order=${o.id}`); }}>
                        <span className="w-12 shrink-0 text-xs text-slate-500">#{o.id}</span>
                        <span className="min-w-0 flex-1 truncate">{o.gift}</span>
                        <span className="text-xs font-semibold">{som(o.amount)}</span>
                        <Badge tone={tone}>{label}</Badge>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : <p className="text-xs text-slate-500">Buyurtma yo'q</p>}
          </div>

          <div>
            <p className="mb-2 text-sm font-semibold">Balans tarixi</p>
            {u.ledger.length ? (
              <ul className="space-y-1 text-sm">
                {u.ledger.map((x) => (
                  <li key={x.id} className="flex items-center gap-2 rounded-lg px-2 py-1">
                    <span className={`w-28 shrink-0 font-semibold ${x.delta >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>{x.delta >= 0 ? '+' : ''}{fmt(x.delta)}</span>
                    <span className="min-w-0 flex-1 truncate text-slate-600">{KIND[x.kind] || x.kind}{x.note ? ` · ${x.note}` : ''}</span>
                    <span className="text-xs text-slate-400">{ago(x.createdAt)}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-xs text-slate-500">Harakat yo'q</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function UsersPage() {
  const act = useAction();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [tab, setTab] = useState(params.get('f') || 'all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);

  useEffect(() => { const p = params.get('q'); if (p !== null && p !== q) { setQ(p); setPage(1); } }, [params]); // eslint-disable-line

  const { data, error, loading, reload } = useApi(`/users?filter=${tab}&q=${encodeURIComponent(q)}&page=${page}`);
  const block = (u, on) => act(() => api(`/users/${u.id}/block`, { method: 'POST', body: { blocked: on } }), on ? `🚫 ${u.name} bloklandi` : `🔓 ${u.name} blokdan chiqarildi`).then((r) => r && reload());

  return (
    <>
      <PageHeader title="Foydalanuvchilar" subtitle="Mijozlar, balanslar, bloklash va shaxsiy xabar" />
      <Card>
        <div className="flex flex-wrap items-center gap-3 p-4">
          <Tabs value={tab} onChange={(v) => { setTab(v); setPage(1); }}
            items={[{ value: 'all', label: 'Barchasi' }, { value: 'customers', label: 'Xaridorlar' }, { value: 'balance', label: 'Balansi bor' }, { value: 'blocked', label: 'Bloklangan' }]} />
          <span className="text-xs text-slate-500">{data ? `${fmt(data.total)} ta` : ''}</span>
          <div className="relative ml-auto w-full sm:w-72">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Ism, Telegram ID yoki @username" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); if (params.get('q')) setParams({}); }} />
          </div>
        </div>

        {loading && !data ? <Loading /> : error && !data ? <div className="p-4"><ErrorBox error={error} onRetry={reload} /></div> : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px]">
                <thead>
                  <tr className="border-y border-white/60">
                    <th className="th">Foydalanuvchi</th><th className="th text-right">Balans</th><th className="th text-right">Jami xarid</th><th className="th text-right">Buyurtma</th>
                    <th className="th">Holat</th><th className="th">Faollik</th><th className="th text-right">Amal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.users.map((u) => (
                    <tr key={u.id} className="cursor-pointer border-b border-white/50 transition hover:bg-white/40" onClick={() => setSelected(u.id)}>
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <Avatar name={u.name || '?'} size={34} />
                          <div className="min-w-0">
                            <p className="truncate font-medium">{u.name}</p>
                            <p className="truncate text-xs text-slate-500">{u.username ? `@${u.username} · ` : ''}{u.id}{u.lang ? ` · ${u.lang.toUpperCase()}` : ''}</p>
                          </div>
                        </div>
                      </td>
                      <td className="td text-right font-semibold text-emerald-700">{u.balance ? som(u.balance) : '—'}</td>
                      <td className="td text-right font-semibold text-sky-700">{u.spent ? som(u.spent) : '—'}</td>
                      <td className="td text-right">{u.orders}</td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1">
                          {u.isAdmin && <Badge tone="violet"><ShieldCheck size={11} /> Admin</Badge>}
                          {u.isBlocked ? <Badge tone="red">Bloklangan</Badge> : u.spent ? <Badge tone="green">Xaridor</Badge> : <Badge>Yangi</Badge>}
                          {u.tgConnected && <Badge tone="blue"><Link2 size={11} /> TG ulangan</Badge>}
                          {u.botBlocked && <Badge tone="amber"><BellOff size={11} /> Botni bloklagan</Badge>}
                        </div>
                      </td>
                      <td className="td text-xs text-slate-500">{u.lastSeen ? ago(u.lastSeen) : '—'}</td>
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <div className="flex justify-end">
                          {!u.isAdmin && <button title={u.isBlocked ? 'Blokdan chiqarish' : 'Bloklash'} onClick={() => block(u, !u.isBlocked)} className={`rounded-lg p-1.5 hover:bg-white/80 ${u.isBlocked ? 'text-emerald-600' : 'text-slate-400 hover:text-rose-500'}`}>{u.isBlocked ? <Unlock size={16} /> : <Ban size={16} />}</button>}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!data.users.length && <Empty icon="🔍" text="Hech kim topilmadi" />}
            </div>
            <div className="flex items-center justify-between px-4 py-3 text-xs text-slate-500">
              <span>{fmt(data.total)} ta foydalanuvchi</span>
              <div className="flex items-center gap-1">
                <button className="btn-light !px-2.5 !py-1 text-xs disabled:opacity-40" disabled={page <= 1} onClick={() => setPage(page - 1)}>Oldingi</button>
                <span className="px-2">{page} / {data.pages}</span>
                <button className="btn-light !px-2.5 !py-1 text-xs disabled:opacity-40" disabled={page >= data.pages} onClick={() => setPage(page + 1)}>Keyingi</button>
              </div>
            </div>
          </>
        )}
      </Card>
      <UserModal id={selected} onClose={() => setSelected(null)} onChanged={reload} />
    </>
  );
}
