# GiftRent — Telegram giftlarini so'mda ijaraga berish (bot + Mini App)

Mijoz Mini App'da giftni tanlaydi va so'mda karta orqali to'laydi. Admin to'lovni tasdiqlaydi va giftni **Marketapp'da o'z TON hamyonidan** ijaraga oladi. Shundan keyin gift **Fragment orqali mijozning o'z Telegram profiliga** ulanadi. Uch tilda ishlaydi: o'zbek, rus, ingliz.

```
Mijoz: gift + muddat → kartaga o'tkazma → chek yuklaydi
Admin: ✅ To'lov keldi → 🔐 Hamyonda tasdiqlash (Marketapp /pay/)
Tizim: blokcheyndan tasdiq kutadi (/my-rented/)
Mijoz: «Telegramni ulash» → Telegramda kirishni tasdiqlaydi   (Marketapp /rent/tg/connect + /status)
Tizim: gift mijoz profilida ko'rsatiladi                        (Marketapp /rent/tg/{nft}/display)
       Bir marta ulangan mijozning keyingi ijaralari AVTOMATIK ko'rsatiladi.
Zaxira: fragment.com → «Connect TON» havolasi → /rent/{nft}/tonconnect/
Tizim: muddat tugashidan 24 soat oldin eslatadi, tugaganda yopadi
```

Admin mijozning akkauntiga, kodiga yoki paroliga hech qachon tegmaydi. Mijoz Telegram kirishini o'zi tasdiqlaydi.

### Marketapp tarifi
- `/rent/*` va `/collections/*` **bepul**. Bot faqat shulardan foydalanadi (katalog, `/pay/`, `/my-rented/`, `/tg/*`, `/tonconnect/`).
- `/v1/nfts/{address}/` pullik, shuning uchun gift shartlari katalogdan keshlanadi. Pullik tarif bo'lsa, `MARKETAPP_PAID_PLAN=true` qiling.
- Token olish uchun hamyonda **TON balansi bo'lishi kerak** (aks holda sayt "Non-zero balance required" deydi).
- `/pay/` so'rovida `price_per_day` va `sale_during_rent` e'londagi qiymatga mos yuboriladi. Egasi shartlarni o'zgartirgan bo'lsa, Marketapp ijarani rad etadi, buyurtma "Muammo" holatiga o'tadi va pul qaytarish tugmasi chiqadi.
- Katalogda faqat ijara davomida sotib bo'lmaydigan giftlar ko'rsatiladi (`include_sellable=false`), shunda ijara muddatidan oldin tugab qolmaydi.
- Fragment cheklovi: bitta giftni soatiga 3 martadan ko'p ko'rsatib bo'lmaydi.

## Yangilanish: Tower dizayni va alohida admin panel

**Mini App dizayni** mockuplardagi "Tower" uslubiga 1:1 moslandi (qora grafit fon, ko'k aksent, porloq ikonlar):
- Pastki menyu: **MARKET · INVENTAR · FAOLLIK · PROFIL** (to'ldirilgan ikonlar).
- Header: avatar + «Stars ★», savat tugmasi (soni bilan), `[+ | balans so'm]` ko'k pill.
- **Market**: kategoriyalar (Gift / Username / Raqam / ⭐ Stars), qidiruv, filtr pill'lari, gift kartalari (narx tugmasi + savat).
- **Gift oynasi**: katta rasm ustida nom/raqam, atributlar jadvali, «Ko'rish / Ulashish / Savatga» tugmalari, «Ijaraga olish — summa».
- **Inventar**: hozir ijaradagi giftlar, qolgan vaqt bilan.
- **Faollik**: «Faol | Tarix» segmenti, ✓ Bajarildi / ❄ Yopilgan / ! Muammo holatlari, «Buyurtmaga o'tish».
- **Savat**: «Hammasini tanlash», «Tanlanganni o'chirish», belgilash doirachalari (qurilmada saqlanadi).
- **Profil**: porloq ikonlar (bilet, sumka, hamyon, karta, odamlar), tezkor tugmalar.
- Ulashish: `t.me/<bot>?startapp=g_<manzil>` — havola ochilganda gift oynasi chiqadi.

**Admin panel** endi alohida sayt: `admin-panel/` (React). Vercel'ga yuklash — `admin-panel/README.md`.
Backend qo'shimchalari: `/api/panel/*` (login, dashboard, foydalanuvchilar, log, xabar tarqatish), CORS (`ADMIN_PANEL_URL`),
botda `/panel` buyrug'i, admin tugmalari endi panel saytini ochadi. Mini App ichidagi eski admin `?admin=1` orqali zaxira sifatida qoladi.

Yangi o'zgaruvchilar: `ADMIN_PANEL_URL`, `ADMIN_PANEL_ORIGINS`, `ADMIN_PANEL_PASSWORD`, `ADMIN_SECRET`, `ADMIN_SESSION_HOURS` (`.env.example`ga qarang).

## Nimalar bor

| Qism | Tavsif |
|---|---|
| Telegram bot (aiogram 3) | /start, til tanlash, chekni rasm qilib qabul qilish, Fragment havolasini qabul qilish, bildirishnomalar, /orders, /help |
| Admin bot | Chek keladi: ✅/❌/🚫 tugmalari. /admin, /markup 15, /rate 42000 yoki /rate auto, /card 8600… Ism, /order 12, /broadcast, /backup |
| Ijarani uzaytirish | Faol ijarada "⏩ Uzaytirish" tugmasi bor, tugashidan 24 soat oldingi eslatmada ham chiqadi. To'lov va tasdiq oddiy buyurtmadek, Marketapp `/extend/` ishlatiladi |
| Hammaga xabar | `/broadcast` → istalgan xabar (matn, rasm, video) → kimga: hamma / buyurtma berganlar / faol ijarachilar → yuborish |
| Zaxira nusxa | Har 24 soatda avtomatik, adminlarga Telegram'da fayl qilib yuboriladi. `/backup` yoki admin paneldagi tugma bilan darhol olinadi |
| Tezkor kuzatuv | Ijara va uzaytirish Marketapp `/rent/events` orqali bir necha soniyada tasdiqlanadi, `/my-rented` zaxira usul bo'lib qoladi |
| Mini App | Katalog, kolleksiyalar, gift oynasi (muddat va narx so'mda), buyurtma sahifasi (5 bosqich), ijaralarim, qo'llanma, profil, til oynasi |
| Admin panel (Mini App) | Buyurtmalar filtri, chekni ko'rish, TON Connect orqali hamyonda imzolash, sozlamalar (ustama, kurs, karta) |
| Backend (FastAPI) | Telegram `initData` imzosini tekshirish, buyurtma holatlari, fon jarayoni (to'lov muddati, blokcheyn tasdig'i, eslatma, tugash) |
| Narx | `Marketapp narxi × (1 + komissiya%) × kurs × (1 + foyda%) + qo'shimcha foyda/kun`, 100 so'mga yuqoriga yaxlitlanadi. Kurs: CoinGecko TON/USD × CBU USD/UZS yoki qo'lda |
| Filtrlar | Kolleksiyalar (5 tagacha, qidiruv, rasm, ijara floor so'mda), narx oralig'i (so'm/kun), raqam (Item ID), Model / Fon / Belgi, saralash |

**Zipdan (gift-rent-check) olinganlar:** Marketapp klienti (token `Authorization`'da "Bearer"siz, so'rovlar orasida pauza, 429/5xx'da `Retry-After` bilan qayta urinish, token loglarga tushmaydi), TON manzillarni kanonik ko'rinishga keltirish, nanoTON hisoblari `Decimal` bilan, Telegram `initData` orqali kirish g'oyasi, OpenAPI'dagi `pay`, `tonconnect` va `my-rented` sxemalari.

## O'rnatish

### 1. Tayyorgarlik
1. **Bot:** @BotFather → `/newbot` → tokenni oling. `/mybots → Bot Settings → Configure Mini App` orqali URL'ga `WEBAPP_URL` ni qo'ying.
2. **Admin ID:** @userinfobot'dan o'z Telegram ID'ingizni oling va `ADMIN_IDS` ga yozing.
3. **Marketapp token:** marketapp.org'ga **ijaralar to'lanadigan hamyon** bilan kiring va API token yarating. Shu hamyon manzilini `ADMIN_WALLET_ADDRESS` ga yozing. Marketapp tranzaksiya aynan token yaratilgan hamyondan yuborilishini talab qiladi.
4. **Server va domen:** HTTPS majburiy (Telegram Mini App faqat HTTPS'da ochiladi). Eng osoni Caddy: `Caddyfile.example` dan foydalaning.

### 2. Ishga tushirish (Docker, PostgreSQL bilan)
```bash
cp .env.example .env      # qiymatlarni to'ldiring
docker compose up -d --build
docker compose logs -f app
```

### 3. Ishga tushirish (Docker'siz, SQLite bilan)
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env      # to'ldiring
python -m app
```

### 4. Tokensiz sinab ko'rish (demo)
```bash
DEMO_MODE=true DEV_USER_ID=1 ADMIN_IDS=1 RUN_BOT=false RATE_MODE=manual MANUAL_RATE_UZS_PER_TON=40000 \
CARD_NUMBER="8600 1234 5678 9012" python -m app
# brauzerda: http://localhost:8080
```
Demo rejimda katalog soxta va hech qanday pul harakat qilmaydi. `DEV_USER_ID` ni hech qachon serverda yoqmang.

## Railway'ga GitHub orqali joylash

1. **GitHub**: github.com → New repository → nomi `giftrent`, **Private** qiling. Zipdagi papkani kompyuterda oching:
   ```
   cd giftrent
   git init && git add . && git commit -m "giftrent"
   git branch -M main
   git remote add origin https://github.com/LOGIN/giftrent.git
   git push -u origin main
   ```
   (yoki GitHub saytida "uploading an existing file" orqali fayllarni tashlang). `.env` va `*.session` `.gitignore`da — ular GitHub'ga **chiqmaydi**, chiqmasligi kerak.
2. **Railway**: railway.com → New Project → *Deploy from GitHub repo* → `giftrent`. Railway `Dockerfile` va `railway.json`ni o'zi topadi.
3. Shu loyihada **+ New → Database → PostgreSQL** qo'shing.
4. Bot servisi → **Variables** → quyidagilarni qo'shing (Raw Editor orqali bir yo'la qo'yish mumkin):
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   BOT_TOKEN=...
   ADMIN_IDS=123456789
   MARKETAPP_API_TOKEN=...
   ADMIN_WALLET_ADDRESS=UQ...
   WALLET_MODE=tonconnect           # yoki hot + HOT_WALLET_MNEMONIC=...
   CARD_NUMBER=8600 .... .... 4625
   CARD_HOLDER=ISM FAMILIYA
   SERVICE_FEE_UZS=1800
   MIN_RENT_DAYS=1
   UNIQUE_AMOUNT_MAX=99
   AUTO_CONFIRM_PAYMENTS=true
   USERBOT_API_ID=...
   USERBOT_API_HASH=...
   USERBOT_SESSION=...
   CARD_NOTIFY_BOTS=CardXabarBot
   CARD_LAST4=4625
   ```
5. Servis → **Settings → Networking → Generate Domain**. `WEBAPP_URL` yozmasangiz shu domen avtomatik olinadi.
6. **BotFather** → `/mybots` → bot → Bot Settings → Menu Button / Configure Mini App → URL: `https://<domen>.up.railway.app`.
7. Deploy loglarida `Userbot listening as … for @CardXabarBot` chiqsa — tayyor. Har `git push` qilganingizda Railway qayta deploy qiladi.

Replikalar soni **1** bo'lsin (railway.json'da shunday) — ikkita nusxa bir vaqtda ishlasa bot va userbot ikki marta ishlaydi.

## CardXabar orqali avtomatik to'lov tasdig'i

Qanday ishlaydi: mijozga summa `+1..99 so'm` qo'shib beriladi (masalan `381 216`). Mijoz kartangizga aynan shu summani o'tkazadi → @CardXabarBot sizning alohida akkauntingizga `➕ 381 216.00 UZS 💳 ***4625` xabarini yuboradi → userbot uni o'qiydi → summasi mos **bitta** ochiq buyurtma bo'lsa, to'lov o'zi tasdiqlanadi va ijara boshlanadi. Mos kelmasa (2 ta bir xil summa, noma'lum summa, kech kelgan pul) — adminga tugmali xabar keladi.

Sozlash:
1. **Alohida Telegram akkaunt** oching (haqiqiy SIM, 2FA parol yoqing). Unda @CardXabarBot'ga kartangizni ulang — kirim xabarlari shu akkauntga kelsin.
2. Shu akkaunt bilan **my.telegram.org → API development tools** → app yarating → `api_id` va `api_hash`.
3. O'z kompyuteringizda (Python o'rnatilgan):
   ```
   pip install telethon
   python tools/make_session.py
   ```
   api_id, api_hash, telefon, kod (va 2FA parol) so'raydi → oxirida uzun `USERBOT_SESSION` satrini chiqaradi.
4. Uni Railway Variables'ga `USERBOT_SESSION` qilib qo'ying. **Bu satr = akkaunt paroli.** Hech kimga bermang, GitHub'ga, chatga yozmang. Shubha bo'lsa: Telegram → Settings → Devices → shu sessiyani o'chiring va yangisini yarating.
5. Tekshirish: CardXabar xabarini botga **forward** qiling yoki `/parse` buyrug'i bilan matnni yuboring — bot summani va qaysi buyurtmaga tushishini ko'rsatadi. Userbot ulanmagan bo'lsa ham forward qilish orqali tasdiqlash ishlaydi.

Eslatma: faqat `➕` (kirim) qatori o'qiladi, balans qatori e'tiborga olinmaydi; `➖` chiqimlar va boshqa karta (`CARD_LAST4`dan farqli) xabarlari tashlab yuboriladi; bitta xabar ikki marta hisoblanmaydi.

## Balans, Stars/Premium, Username va Raqam ijarasi

**Balans.** Mijoz ilovada summani tanlaydi (masalan 50 000) va unga noyob summa beriladi (masalan 50 037). U kartaga aynan shu summani o'tkazadi, CardXabar xabari kelishi bilan balans o'zi to'ladi. Chek yuklanmaydi. Ijara, Stars va Premium balansdan bir tugma bilan to'lanadi. Mos kelmagan yoki kech kelgan pul uchun adminga «✅ Balansga qo'shish» tugmali xabar keladi.
- Chegaralar: `TOPUP_MIN_UZS` (5 000) va `TOPUP_MAX_UZS` (5 000 000).
- Qo'lda o'zgartirish: `/balance <user_id> +50000` (yoki `-50000`). Admin paneldagi «Mijoz balansini o'zgartirish» ham shu ishni qiladi.
- Balansdan to'langan buyurtma muvaffaqiyatsiz bo'lsa, «Pul qaytarildi» bosilganda summa balansga avtomatik qaytadi. Karta orqali to'langan buyurtma uchun «💰 Balansga qaytarish» tugmasi bor.

**Stars va Premium.** Bular Marketapp'ning bepul `fragment` endpointlari orqali ishlaydi. Mijoz istalgan @username'ga Stars (50–1 000 000) yoki Premium (3/6/12 oy) sotib oladi.
- Narx: Fragment narxi × kurs × (1 + ustama%). Ustama: `STARS_MARKUP_PERCENT`, `PREMIUM_MARKUP_PERCENT`. Ikkalasining standart qiymati 10%, admin panelda o'zgartirsa bo'ladi.
- **Hot rejimda** bot to'lovni o'zi imzolaydi. **TON Connect rejimida** adminga «🔐 Hamyonda tasdiqlash» xabari keladi.
- To'lov hamyondan chiqmasdan xato bo'lsa, pul mijoz balansiga avtomatik qaytadi.

**Username va anonim raqamlar.** Katalogda «@ Username» va «📞 Raqam» bo'limlari bor.
- Username ijaraga olingach, mijoz uni Fragment «Connect TON» havolasi orqali ulaydi.
- Raqam ijaraga olingach, buyurtma darhol faol bo'ladi. Mijoz Telegram'da shu raqam bilan kiradi va kirish kodini ilovadagi «Kirish kodini olish» tugmasi orqali oladi.

**Referal va reyting.** Har bir mijozning havolasi `t.me/<bot>?start=ref_<id>` ko'rinishida.
- Taklif qilingan do'stning har bir to'lovidan `REFERRAL_PERCENT` (standart 1%) taklif qilgan odam balansiga tushadi.
- Top reytingda eng ko'p xarid qilganlar ko'rsatiladi, ismlar yashiriladi.

**Admin.** Admin panelda quyidagilar bor: ochiq to'ldirishlar, Stars/Premium xaridlari, hot hamyon balansi, mijozlar balanslari yig'indisi va ustama sozlamalari. Bot buyruqlari: `/notices`, `/userbot`, `/balance`.

## Admin qanday ishlaydi

1. Mijoz chek yuboradi. Botga chek rasmi **✅ To'lov keldi / ❌ Rad etish / 🚫 Bekor qilish** tugmalari bilan keladi. Bank ilovangizda pul tushganini tekshirib, tugmani bosing.
2. **💎 Ijarani to'lash** Mini App'dagi admin panelni ochadi. U yerda "Hamyonni ulash" (Tonkeeper yoki Telegram Wallet) qilinadi. Tizim Marketapp'dan tranzaksiyani oladi, siz hamyonda tasdiqlaysiz.
   - Marketapp so'ragan summa kotirovkadan `MAX_TX_OVERPAY_PERCENT` + `MAX_TX_FEE_TON` dan oshsa, tizim imzolashga **ruxsat bermaydi** (masalan, egasi narxni oshirgan bo'lsa).
   - Boshqa hamyon ulangan bo'lsa, ogohlantirish chiqadi va tranzaksiya qabul qilinmaydi.
3. Blokcheyn tasdig'idan keyin mijozga avtomatik ravishda Fragment yo'riqnomasi boradi.
4. Agar Marketapp `/tonconnect/` uchun ham imzo so'rasa, botga **🔐 TEZ tasdiqlang** xabari keladi, chunki havola bir necha daqiqada eskiradi.
5. Muammoli buyurtmalarda **🔁 Qayta urinish** yoki **💸 Pul qaytarildi** tugmalari bor (pulni kartaga o'zingiz qaytarasiz).

### Hamyon rejimlari
- `WALLET_MODE=tonconnect` (tavsiya): har bir to'lovni admin o'z hamyonida tasdiqlaydi. Serverda kalit saqlanmaydi.
- `WALLET_MODE=hot`: server V4R2 hamyonni 24 so'zli mnemonic bilan o'zi imzolaydi. `AUTO_RENT=true` bo'lsa, to'lov tasdiqlangan zahoti ijaraga oladi. Mnemonic `ADMIN_WALLET_ADDRESS` ga mos kelmasa, server ishga tushmaydi. Hot hamyonda **faqat bir necha kunlik aylanma TON** saqlang.

## Narx va foyda (admin panel → "Narx sozlamalari")
Narx boshqa ijara do'konlaridagidek ikki qismdan iborat:

```
Ijara:       450 so'm × 3 kun = 1 350 so'm   ← Marketapp narxi (komissiyasi bilan) so'mga aylantirilgan
Xizmat haqi:                    1 800 so'm   ← sizning foydangiz, har buyurtmaga bir marta
Jami:                           3 150 so'm
```

| Maydon | Ma'nosi |
|---|---|
| Marketapp komissiyasi, % | Marketapp ijara narxi ustiga qo'shadigan haq. Ijara narxiga qo'shiladi. Birinchi haqiqiy ijaradan keyin panelda haqiqiy foiz chiqadi, uni **"Shuni qo'llash"** bilan qo'yasiz |
| Xizmat haqi, so'm | Har buyurtmaga qo'shiladigan qat'iy summa (standart 1 800). Uzaytirishga ham qo'shiladi |
| Minimal ijara, kun | Mijoz eng kamida necha kunga olishi mumkin (standart 3). Faqat 1–2 kunga beriladigan giftlar katalogda ko'rinmaydi |
| Ijaraga ustama (% va so'm/kun) | Ijaraning o'ziga qo'shimcha foyda. Odatda 0 qoladi |
| Yaxlitlash | Kunlik narx shu songa yuqoriga yaxlitlanadi (standart 10) |
| Kalkulyator | Marketapp narxi (TON/kun) va kunlar sonini kiritasiz: ijara, xizmat haqi, mijoz to'laydigan summa va foydangiz ko'rinadi |

## Zaxira nusxa va tiklash
- Fayllar `data/backups/` papkasida saqlanadi (SQLite uchun `.db.gz`, PostgreSQL uchun `.json.gz`). Oxirgi `BACKUP_KEEP` ta fayl qoladi.
- **SQLite'ni tiklash:** botni to'xtating, so'ng `gunzip -c data/backups/giftrent-....db.gz > data/giftrent.db`. Windows'da 7-Zip bilan oching va `giftrent.db` nomi bilan `data/` ga qo'ying.
- **JSON'dan tiklash (bo'sh bazaga):** `python -m app.backup restore data/backups/giftrent-....json.gz`
- Qo'lda zaxira olish: `python -m app.backup now`

## Ijarani uzaytirish haqida
Marketapp hujjatida `/extend/` dagi `duration` "yangi muddat" deb yozilgan. Kod uni **qo'shimcha kunlar** deb yuboradi va Marketapp ko'rsatgan `extend_duration` chegarasini tekshiradi. Birinchi jonli uzaytirishda yangi tugash vaqti to'g'ri chiqqanini tekshiring. Agar Marketapp uni umumiy muddat deb hisoblasa, `app/orders.py` dagi `prepare_tx` da bitta qatorni o'zgartirish kifoya.

## Buyurtma holatlari
`awaiting_payment → payment_review → paid → renting → awaiting_link → connecting → (connect_signing) → active → expired`
hamda `cancelled`, `failed`, `refunded`. Har bir o'tish shartli `UPDATE` bilan bajariladi, shuning uchun ikki admin bir vaqtda bossa ham buyurtma ikki marta ishlanmaydi. Hamma o'zgarishlar `order_events` jadvalida qoladi.

## Keyinchalik Payme/Click qo'shish
Hozir to'lov karta va chek orqali. Merchant shartnomasi bo'lganda `app/payments/` modulini qo'shing: callback kelganda `orders.confirm_payment(ctx, order_id, admin_id=0)` ni chaqirish kifoya. Qolgan oqim (ijara, Fragment, bildirishnomalar) o'zgarmaydi.

## Ishga tushirishdan oldin albatta tekshiring
- **Bitta arzon gift bilan to'liq jonli sinov qiling** (1 kun): to'lov → ijara → «Telegramni ulash» → profilda ko'rinishi. Zaxira `/tonconnect/` javobining sxemasi hujjatda yozilmagan, kod imzo kerak bo'lgan va kerak bo'lmagan holatlarni ham qo'llab-quvvatlaydi.
- Marketapp'dagi `discount_per_day` chegirmasi kotirovkada hisobga olinmaydi, ya'ni mijoz chegirmasiz narxni to'laydi. Haqiqiy summa hamyonda imzolashdan oldin ko'rinadi.
- Fragment havolasi tekshiruvi `manifestUrl` ichida `fragment.com` borligini talab qiladi. Fragment buni o'zgartirsa, `app/ton.py → validate_tonconnect_url` ni yangilang.
- Marketapp qoidalari ijarani qayta sotishga (reseller) ruxsat beradimi, shuni tekshiring. Shuningdek, O'zbekistonda so'm qabul qilib kripto bilan to'lov qilishning huquqiy tomonini yurist bilan aniqlang.
- Gift rasmlari `nft.fragment.com/gift/<nom>-<raqam>.webp` dan, kolleksiya rasmlari esa o'sha kolleksiyaning 1-raqamli giftidan olinadi. Rasm topilmasa, zaxira rasm ko'rsatiladi.
- Filtrlarda narx va raqam oralig'i server tomonda Marketapp sahifalarini ko'rib chiqib filtrlanadi, chunki Marketapp API'da bunday parametr yo'q. Bir nechta kolleksiya tanlansa, har biriga alohida so'rov ketadi (Marketapp limiti tufayli biroz sekinroq).

## Testlar
```bash
pip install -r requirements-dev.txt
pytest -q
```
Testlar quyidagilarni tekshiradi: tarjima kalitlari uch tilda bir xilligi, `initData` imzosi, Fragment havolasi tekshiruvi, narx hisobi, hot wallet xabari, to'liq buyurtma oqimi, ikki admin bir vaqtda bosgandagi poyga va narx oshib ketganda himoya.

## Tuzilma
```
app/
  main.py         FastAPI + bot + fon jarayoni
  config.py       .env sozlamalari
  db.py           jadvallar (users, orders, order_events, settings)
  orders.py       buyurtma holatlari (asosiy mantiq) + worker
  marketapp.py    Marketapp API klienti + demo katalog
  pricing.py      kurs, ustama, kotirovka
  ton.py          manzillar, TonConnect havola tekshiruvi, hot wallet (V4R2)
  tg_auth.py      Telegram initData tekshiruvi
  api.py          Mini App API (mijoz + admin)
  i18n.py         tarjimalar
  bot/            aiogram handlerlar, admin tugmalari, bildirishnomalar
locales/          uz.json ru.json en.json (bot va Mini App uchun umumiy)
webapp/           Mini App (HTML/CSS/JS, build kerak emas)
tests/
```

## Admin panel — bot bilan bitta Railway servisida
`Dockerfile` panelni deploy paytida o'zi yig'adi va bot uni shu manzilda ochadi:

```
https://<bot>.up.railway.app/        → Mini App
https://<bot>.up.railway.app/admin/  → Admin panel
```

Qo'shimcha sozlash shart emas: `ADMIN_PANEL_URL` bo'sh bo'lsa, bot tugmalari va `/panel` buyrug'i avtomatik `/admin/` ni ochadi.
`VITE_API_URL`, `ADMIN_PANEL_ORIGINS` kerak emas (bir xil domen). Panelga kirish: botga `/panel` → «🔐 Panelni ochish»,
yoki Telegram ID → kod, yoki `ADMIN_PANEL_PASSWORD`. Xohlasangiz, panelni Vercel'ga ham alohida qo'yish mumkin (`admin-panel/README.md`).

## Admin panel → «Bot sozlamalari» (Railway'siz o'zgartirish)
Bot nomi, yordam/kanal/oferta, standart til, to'lov muddati, noyob summa, ochiq buyurtmalar limiti, karta oxirgi 4 raqami,
balans chegaralari, avto-tasdiq (CardXabar), xavfsizlik chegaralari (faqat kamaytirish), AUTO_RENT va zaxira sozlamalari
paneldan o'zgartiriladi va darhol ishlaydi. Railway'dagi qiymat standart bo'lib qoladi; «Railway qiymatiga qaytarish» bilan
panel o'zgarishini bekor qilasiz. Har bir o'zgarish tarixda saqlanadi. Maxfiy kalitlar (tokenlar, hamyon, mnemonic,
userbot sessiyasi, ADMIN_IDS, DATABASE_URL) faqat Railway'da — panelda faqat ularning holati ko'rinadi.

## Narx (yangilangan)
- Gift narxi Marketapp'dan TON'da olinadi va **jonli kurs** bilan so'mga aylanadi (TON/USD har daqiqada, USD/UZS soatiga — CBU).
- Foyda: **ustama %** (admin panel → Narx va moliya → «Giftlarga ustama, %») + **xizmat haqi**.
- Xizmat haqini **TON'da** qo'ysangiz (masalan 0.01 TON), u ham kurs bo'yicha so'mga aylanadi; aks holda qat'iy so'm.
- Eski «so'm/kun qo'shimcha» (PROFIT_FIXED_UZS) endi ishlatilmaydi.
- `.env`: `SERVICE_FEE_TON=0.01` (ixtiyoriy). Kanal taklif oynasi: `CHANNEL_USERNAME`, `CHANNEL_POPUP=true` (panelda ham bor).
