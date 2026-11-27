import { useEffect, useState } from 'react';
import { CreditCard, Save, DatabaseBackup, Wallet, Server, Bot, Link2, Unlink, ExternalLink, Info } from 'lucide-react';
import { Card, PageHeader, Badge, Loading, ErrorBox } from '../components/ui.jsx';
import { useAction } from '../components/Layout.jsx';
import { adminApi, getApiBase, setApiBase, useApi } from '../data/api.js';
import { useWallet, shortAddr } from '../data/ton.js';

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2"><Icon size={18} className="text-sky-600" /><div><h3 className="font-semibold">{title}</h3>{subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}</div></div>
      {children}
    </Card>
  );
}

export default function SettingsPage() {
  const act = useAction();
  const { data: s, error, loading, reload } = useApi('/stats', { source: 'admin' });
  const dash = useApi('/dashboard');
  const wallet = useWallet();
  const [card, setCard] = useState(null);
  const [api, setApi] = useState(getApiBase());

  useEffect(() => { if (s && !card) setCard({ card_number: s.settings.card_number, card_holder: s.settings.card_holder, card_bank: s.settings.card_bank }); }, [s]); // eslint-disable-line

  if (loading && !s) return <Loading />;
  if (error && !s) return <ErrorBox error={error} onRetry={reload} />;
  if (!card) return <Loading />;
  const d = dash.data || {};

  return (
    <>
      <PageHeader title="Sozlamalar" subtitle="To'lov kartasi, hamyon, zaxira nusxa va ulanish" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Section icon={CreditCard} title="To'lov kartasi" subtitle="Mijozlar shu kartaga o'tkazadi (Mini App va botda ko'rinadi)">
          <div className="space-y-3">
            <label className="block text-sm"><span className="mb-1 block text-slate-600">Karta raqami</span><input className="input font-mono" inputMode="numeric" value={card.card_number} onChange={(e) => setCard({ ...card, card_number: e.target.value })} /></label>
            <label className="block text-sm"><span className="mb-1 block text-slate-600">Karta egasi</span><input className="input" value={card.card_holder} onChange={(e) => setCard({ ...card, card_holder: e.target.value })} /></label>
            <label className="block text-sm"><span className="mb-1 block text-slate-600">Bank</span><input className="input" value={card.card_bank} onChange={(e) => setCard({ ...card, card_bank: e.target.value })} /></label>
            <div className="flex justify-end"><button className="btn-dark" onClick={() => act(() => adminApi('/settings', { method: 'POST', body: card }), '💳 Karta saqlandi')}><Save size={16} /> Saqlash</button></div>
          </div>
        </Section>

        <Section icon={Wallet} title="Admin hamyoni" subtitle={s.wallet_mode === 'hot' ? 'Hot rejim — server o\'zi imzolaydi' : 'TON Connect — har to\'lovni o\'zingiz tasdiqlaysiz'}>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Rejim</dt><dd><Badge tone={s.wallet_mode === 'hot' ? 'amber' : 'blue'}>{s.wallet_mode}</Badge></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Marketapp hamyoni</dt><dd className="font-mono">{shortAddr(s.admin_wallet) || '—'}</dd></div>
            {s.hot_balance != null && <div className="flex justify-between gap-3"><dt className="text-slate-500">Hot balans</dt><dd className="font-semibold">{s.hot_balance} TON</dd></div>}
            {s.wallet_mode !== 'hot' && <div className="flex justify-between gap-3"><dt className="text-slate-500">Brauzerda ulangan</dt><dd className="font-mono">{wallet.account ? shortAddr(wallet.account.address) : '—'} {wallet.account && !wallet.ok && <Badge tone="red">boshqa</Badge>}</dd></div>}
          </dl>
          {s.wallet_mode !== 'hot' && (wallet.account
            ? <button className="btn-light mt-4" onClick={wallet.disconnect}><Unlink size={15} /> Uzish</button>
            : <button className="btn-dark mt-4" onClick={() => wallet.connect().catch(() => {})}><Link2 size={15} /> Hamyonni ulash</button>)}
        </Section>

        <Section icon={Bot} title="Bot holati">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Bot</dt><dd>{d.botUsername ? <a className="inline-flex items-center gap-1 text-sky-700 hover:underline" href={`https://t.me/${d.botUsername}`} target="_blank" rel="noreferrer">@{d.botUsername} <ExternalLink size={12} /></a> : <Badge tone="amber">ishlamayapti</Badge>}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">CardXabar avto-tasdiq</dt><dd><Badge tone={d.userbot === 'on' ? 'green' : 'amber'}>{d.userbot || '—'}</Badge></dd></div>
            <div className="flex justify-between gap-3"><dt className="text-slate-500">Rejim</dt><dd>{d.demo ? <Badge tone="amber">DEMO</Badge> : <Badge tone="green">Jonli</Badge>}</dd></div>
          </dl>
          <p className="mt-3 flex gap-1.5 text-xs text-slate-500"><Info size={13} className="mt-0.5 shrink-0" /> Botda: /admin, /panel, /broadcast, /backup, /userbot, /notices, /order 12, /balance.</p>
        </Section>

        <Section icon={DatabaseBackup} title="Zaxira nusxa" subtitle="Baza nusxasi serverda saqlanadi va adminlarga Telegram'da fayl qilib yuboriladi">
          <button className="btn-dark" onClick={() => act(() => adminApi('/backup', { method: 'POST' }), (r) => `💾 Zaxira tayyor: ${r.file}`)}><DatabaseBackup size={16} /> Hozir zaxira olish</button>
        </Section>

        <Section icon={Server} title="Bot server manzili" subtitle="Panel qaysi backend'ga ulanishi (Railway'dagi WEBAPP_URL)">
          <div className="flex gap-2">
            <input className="input" placeholder="https://....up.railway.app" value={api} onChange={(e) => setApi(e.target.value)} />
            <button className="btn-light shrink-0" onClick={() => { setApiBase(api.trim()); location.reload(); }}>Saqlash</button>
          </div>
          <p className="mt-1 text-xs text-slate-500">Bo'sh qoldirilsa, Vercel'dagi VITE_API_URL ishlatiladi.</p>
        </Section>
      </div>
    </>
  );
}
