// Order / top-up / purchase statuses of the GiftRent bot → label + badge tone.
export const ORDER_STATUS = {
  awaiting_payment: ["To'lov kutilmoqda", 'amber'],
  payment_review: ['Chek tekshiruvda', 'amber'],
  paid: ["To'landi — ijaraga olish kerak", 'blue'],
  renting: ['Ijara blokcheynda', 'blue'],
  awaiting_link: ['Telegram ulanishi kutilmoqda', 'violet'],
  connecting: ['Ulanmoqda', 'violet'],
  connect_signing: ['Imzo kerak (ulash)', 'blue'],
  active: ['Faol', 'green'],
  expired: ['Tugagan', 'slate'],
  cancelled: ['Bekor qilingan', 'slate'],
  failed: ['Muammo', 'red'],
  refunded: ['Pul qaytarilgan', 'slate'],
  extended: ['Uzaytirishga qo\'shildi', 'green'],
};
export const TOPUP_STATUS = {
  pending: ["O'tkazma kutilmoqda", 'amber'], review: ['Chek tekshiruvda', 'amber'], paid: ["Balansga qo'shildi", 'green'],
  cancelled: ['Bekor qilingan', 'slate'], expired: ["Muddati o'tgan", 'slate'], rejected: ['Rad etilgan', 'red'],
};
export const PURCHASE_STATUS = {
  pending: ['Tayyorlanmoqda', 'amber'], signing: ['Imzo kerak', 'blue'], sent: ['Yuborildi', 'violet'],
  done: ['Bajarildi', 'green'], failed: ['Muammo', 'red'], refunded: ['Qaytarilgan', 'slate'],
};
export const CATEGORY = { gift: '🎁 Gift', username: '@ Username', number: '📞 Raqam' };
export const ts = (iso) => (iso ? new Date(iso).getTime() : null);
