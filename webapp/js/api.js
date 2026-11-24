// Thin API client: every request carries Telegram's signed initData.
const tg = window.Telegram?.WebApp;

export class ApiError extends Error {
  constructor(code, status, detail) { super(code); this.code = code; this.status = status; this.detail = detail; }
}

async function request(method, path, body) {
  const headers = { 'X-Telegram-Init-Data': tg?.initData || '' };
  let payload;
  if (body instanceof FormData) payload = body;
  else if (body !== undefined) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body); }
  let res;
  try {
    res = await fetch(path, { method, headers, body: payload });
  } catch {
    throw new ApiError('generic', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const d = data?.detail || {};
    throw new ApiError(typeof d === 'object' && d.code ? d.code : 'generic', res.status, d.detail);
  }
  return data;
}

export const api = {
  me: () => request('GET', '/api/me'),
  setLang: lang => request('POST', '/api/me/lang', { lang }),
  collections: () => request('GET', '/api/collections'),
  attributes: collection => request('GET', '/api/attributes' + (collection ? `?collection=${encodeURIComponent(collection)}` : '')),
  gifts: (params = {}) => request('GET', '/api/gifts?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v))),
  gift: address => request('GET', `/api/gifts/${encodeURIComponent(address)}`),
  quote: (nft, days) => request('GET', `/api/quote?${new URLSearchParams({ nft, days })}`),
  createOrder: (nft_address, days) => request('POST', '/api/orders', { nft_address, days }),
  orders: () => request('GET', '/api/orders'),
  order: id => request('GET', `/api/orders/${id}`),
  cancel: id => request('POST', `/api/orders/${id}/cancel`),
  receipt: (id, file) => { const f = new FormData(); f.append('file', file); return request('POST', `/api/orders/${id}/receipt`, f); },
  link: (id, url) => request('POST', `/api/orders/${id}/link`, { url }),
  extendQuote: (id, days) => request('GET', `/api/orders/${id}/extend-quote` + (days ? `?days=${days}` : '')),
  extend: (id, days) => request('POST', `/api/orders/${id}/extend`, { days }),
  tgConnect: id => request('POST', `/api/orders/${id}/tg-connect`),
  tgStatus: id => request('GET', `/api/orders/${id}/tg-status`),
  admin: {
    orders: filter => request('GET', `/api/admin/orders?filter=${filter}`),
    stats: () => request('GET', '/api/admin/stats'),
    backup: () => request('POST', '/api/admin/backup'),
    settings: body => request('POST', '/api/admin/settings', body),
    action: (id, action) => request('POST', `/api/admin/orders/${id}/${action}`),
    prepare: id => request('POST', `/api/admin/orders/${id}/prepare-tx`),
    sent: (id, boc, wallet) => request('POST', `/api/admin/orders/${id}/tx-sent`, { boc, wallet }),
    receiptUrl: id => `/api/admin/orders/${id}/receipt`,
    receiptBlob: async id => {
      const res = await fetch(`/api/admin/orders/${id}/receipt`, { headers: { 'X-Telegram-Init-Data': tg?.initData || '' } });
      if (!res.ok) throw new ApiError('generic', res.status);
      return URL.createObjectURL(await res.blob());
    },
  },
};
