import { useState } from 'react';
import { Check, X, Wallet, Info, Receipt } from 'lucide-react';
import { Card, CardHeader, PageHeader, Badge, Avatar, Tabs, Modal, Loading, ErrorBox, Empty, som, ago, fmt } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { adminApi, useApi } from '../data/api.js';
import { TOPUP_STATUS, ts } from '../data/status.js';

export default function Topups() {
  const act = useAction();
  const [tab, setTab] = useState('open');
  const [confirm, setConfirm] = useState(null);
  const { data, error, loading, reload } = useApi(`/topups?filter=${tab}`, { refreshMs: 20000, source: 'admin' });

  const run = (x, action) => act(() => adminApi(`/topups/${x.id}/${action}`, { method: 'POST' }),
    action === 'confirm' ? `💰 #${x.id}: ${som(x.amount_uzs)} balansga qo'shildi` : `❌ #${x.id} rad etildi`)
    .then(() => { setConfirm(null); reload(); });

  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorBox error={error} onRetry={reload} />;
  const open = data.items.filter((x) => ['pending', 'review'].includes(x.status));
  const waiting = open.reduce((s, x) => s + x.amount_uzs, 0);

  return (
    <>
      <PageHeader title="Balans to'ldirish" subtitle="Mijoz noyob summani kartaga o'tkazadi — CardXabar xabari kelsa balans o'zi to'ladi. Kelmasa, shu yerda qo'lda tasdiqlang." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Tabs value={tab} onChange={setTab} items={[{ value: 'open', label: 'Ochiq', count: tab === 'open' ? data.items.length : undefined }, { value: 'all', label: 'Barchasi' }]} />
          {data.items.length ? (
            <Card>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px]">
                  <thead><tr className="border-b border-white/60"><th className="th">Mijoz</th><th className="th text-right">Summa</th><th className="th">Holat</th><th className="th">Vaqt</th><th className="th text-right">Amallar</th></tr></thead>
                  <tbody>
                    {data.items.map((x) => {
                      const [label, tone] = TOPUP_STATUS[x.status] || [x.status, 'slate'];
                      const u = x.user || {};
                      return (
                        <tr key={x.id} className="border-b border-white/50 hover:bg-white/40">
                          <td className="td">
                            <div className="flex items-center gap-3">
                              <Avatar name={u.name || String(x.user_id)} size={32} />
                              <div className="min-w-0"><p className="truncate font-medium">{u.name || x.user_id}</p><p className="truncate text-xs text-slate-500">#{x.id} · {u.username ? `@${u.username} · ` : ''}{x.user_id}</p></div>
                            </div>
                          </td>
                          <td className="td text-right"><p className="font-bold">{som(x.amount_uzs)}</p>{x.unique_add_uzs > 0 && <p className="text-[11px] text-slate-500">{fmt(x.base_uzs)} + {x.unique_add_uzs}</p>}</td>
                          <td className="td"><div className="flex flex-wrap gap-1"><Badge tone={tone}>{label}</Badge>{x.has_receipt && <Badge tone="blue"><Receipt size={11} /> chek</Badge>}</div></td>
                          <td className="td text-xs text-slate-500">{ago(ts(x.created_at))}</td>
                          <td className="td">
                            {['pending', 'review'].includes(x.status) || x.status === 'expired' ? (
                              <div className="flex justify-end gap-1.5">
                                <button className="btn-green !px-2.5 !py-1.5 text-xs" onClick={() => setConfirm({ x, action: 'confirm' })}><Check size={14} /> Balansga</button>
                                {x.status !== 'expired' && <button className="btn-light !px-2.5 !py-1.5 text-xs text-rose-600" onClick={() => setConfirm({ x, action: 'reject' })}><X size={14} /> Rad</button>}
                              </div>
                            ) : <span className="block text-right text-xs text-slate-400">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : <Card><Empty icon="💳" text={tab === 'open' ? "Ochiq to'ldirish yo'q" : "Hali to'ldirish bo'lmagan"} /></Card>}
        </div>

        <div className="space-y-5">
          <Card className="p-5">
            <div className="flex items-center gap-2"><Wallet size={18} className="text-emerald-600" /><h3 className="font-semibold">Kutilayotgan summa</h3></div>
            <p className="mt-3 text-3xl font-bold tracking-tight">{som(waiting)}</p>
            <p className="text-xs text-slate-500">{open.length} ta ochiq so'rov</p>
          </Card>
          <Card>
            <CardHeader title="Qanday ishlaydi" />
            <ul className="space-y-2 px-5 pb-5 pt-3 text-sm text-slate-700">
              <li className="flex gap-2"><Info size={15} className="mt-0.5 shrink-0 text-sky-600" /> Har so'rovga +1..99 so'm qo'shiladi — bank xabaridagi summa qaysi mijozniki ekanini aniqlaydi.</li>
              <li className="flex gap-2"><Info size={15} className="mt-0.5 shrink-0 text-sky-600" /> «Balansga» — bank ilovasida pul tushganini ko'rib bosing. Muddati o'tganini ham tasdiqlash mumkin.</li>
              <li className="flex gap-2"><Info size={15} className="mt-0.5 shrink-0 text-sky-600" /> Chek rasmlari adminlarga botda keladi.</li>
            </ul>
          </Card>
        </div>
      </div>

      <Modal
        open={!!confirm}
        onClose={() => setConfirm(null)}
        title={confirm ? `To'ldirish #${confirm.x.id}` : ''}
        footer={confirm && <><button className="btn-light" onClick={() => setConfirm(null)}>Yo'q</button>
          <button className={confirm.action === 'confirm' ? 'btn-green' : 'btn-red'} onClick={() => run(confirm.x, confirm.action)}>{confirm.action === 'confirm' ? "Ha, balansga qo'shish" : 'Ha, rad etish'}</button></>}
      >
        {confirm && <p className="text-sm text-slate-700">{confirm.action === 'confirm'
          ? <>Kartaga <b>{som(confirm.x.amount_uzs)}</b> tushganini tekshirdingizmi? Summa mijoz balansiga qo'shiladi.</>
          : "So'rov rad etilsinmi? Mijozga xabar boradi."}</p>}
      </Modal>
    </>
  );
}
