# GiftRent — Admin panel (alohida sayt)

React + Vite + Tailwind CSS + framer-motion + lucide-react + recharts. Glassmorphism dizayn.
Bot (FastAPI, Railway) bilan HTTPS orqali ishlaydi: `/api/panel/*` va `/api/admin/*`.

## Sahifalar

| Sahifa | Nima qiladi |
|---|---|
| Umumiy ko'rinish | Oylik tushum/foyda (o'tgan oyga nisbatan %), faol ijaralar, navbatlar (chek, ijara, imzo, muammo), 14 kunlik grafiklar, kategoriya va kolleksiyalar, TOP mijozlar |
| Narx va moliya | Marketapp komissiyasi, xizmat haqi, minimal kun, ustamalar, kurs (avto/qo'lda), Stars/Premium ustamasi, referal % + jonli kalkulyator |
| Buyurtmalar | Chekni ko'rish (kattalashtirish), «Pul keldi» / rad / bekor, **TON Connect orqali ijaraga olish va ulashni imzolash**, qayta urinish, balansga/kartaga qaytarish, qidiruv |
| Balans to'ldirish | Ochiq to'ldirishlar, qo'lda balansga qo'shish yoki rad etish |
| Stars va Premium | Hamyonda imzolash, qayta urinish, bajarildi, pulni qaytarish |
| Foydalanuvchilar | Qidiruv, filtrlar, profil: balans qo'shish/ayirish, bloklash, shaxsiy xabar, buyurtmalar va balans tarixi |
| Xabar tarqatish | Hamma / buyurtma berganlar / faol ijarachilar, matn + tugma, jonli progress |
| Faoliyat logi | Har bir buyurtma holati o'zgarishi: kim (admin/mijoz/tizim), qachon, nimadan nimaga |
| Sozlamalar | To'lov kartasi, admin hamyoni, bot holati, zaxira nusxa, server manzili |

## Vercel'ga yuklash

1. GitHub'dagi repo → Vercel → **Add New → Project** → shu repo.
2. **Root Directory**: `admin-panel` (muhim!). Framework avtomatik **Vite** bo'ladi.
3. **Environment Variables**: `VITE_API_URL` = botning Railway manzili, masalan `https://giftrent.up.railway.app`.
4. Deploy → domen chiqadi, masalan `https://giftrent-admin.vercel.app`.
5. Railway'da bot servisi → Variables → `ADMIN_PANEL_URL=https://giftrent-admin.vercel.app` (CORS shu bilan ochiladi).
   Ixtiyoriy: `ADMIN_PANEL_PASSWORD=...` (kamida 8 belgi) — Telegram ID + parol bilan kirish uchun.
6. Botga `/panel` yozing → **🔐 Panelni ochish** → panel avtomatik kiradi.

`VITE_API_URL` o'zgarsa, Vercel'da **Redeploy** qiling (u build vaqtida qo'shiladi).

## Kirish usullari
- **Bot havolasi**: botda `/panel` → bir martalik havola (10 daqiqa).
- **Kod**: login sahifasida Telegram ID → «Kod olish» → bot 6 xonali kod yuboradi (5 daqiqa, 5 urinish).
- **Parol**: Telegram ID + `ADMIN_PANEL_PASSWORD` (5 ta xato → 10 daqiqa blok).

Faqat `ADMIN_IDS` dagi ID'lar kira oladi. Sessiya HMAC bilan imzolangan token (`ADMIN_SESSION_HOURS`, standart 72 soat).

## Lokal ishga tushirish
```bash
# 1-terminal: bot (demo)
DEMO_MODE=true DEV_USER_ID=1 ADMIN_IDS=1 RUN_BOT=false RATE_MODE=manual MANUAL_RATE_UZS_PER_TON=40000 \
ADMIN_PANEL_PASSWORD=demo-password-123 python -m app
# 2-terminal: panel
cd admin-panel && npm install && npm run dev     # http://localhost:5173 (Telegram ID 1, parol demo-password-123)
```
