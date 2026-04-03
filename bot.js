const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const TOKEN        = process.env.BOT_TOKEN;
const APP_URL      = process.env.APP_URL;
const OWNER_ID     = process.env.OWNER_TELEGRAM_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const bot = new TelegramBot(TOKEN, {
  polling: { autoStart: true, params: { timeout: 10 } }
});
bot.on('polling_error', (err) => console.error('Polling error:', err.message));
process.on('uncaughtException', (err) => console.error('Uncaught:', err));

const db = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── /start ────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(msg.chat.id,
    `👋 Hey ${msg.from.first_name}! Tap below to open the shop.`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '🛍️ Open Shop', web_app: { url: APP_URL } }
      ]]
    }
  });
});

// ── /orders ───────────────────────────────────
bot.onText(/\/orders/, async (msg) => {
  console.log('orders from:', msg.chat.id, 'owner:', OWNER_ID);
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const { data, error } = await db.from('orders')
    .select('*').order('created_at', { ascending: false }).limit(10);
  if (error || !data?.length) { bot.sendMessage(msg.chat.id, '📭 No orders yet.'); return; }
  const text = data.map((o, i) =>
    `#${i+1} — ${o.product_name}\n` +
    `💰 $${o.price_usd} | 👤 @${o.telegram_username||'unknown'}\n` +
    `📦 ${o.shipping_name||'—'} | ${o.shipping_address||'—'}\n` +
    `🔖 ${o.status} | 📅 ${new Date(o.created_at).toLocaleString()}`
  ).join('\n\n');
  bot.sendMessage(msg.chat.id, `🧾 *Last 10 Orders:*\n\n${text}`, { parse_mode: 'Markdown' });
});

// ── /pending ──────────────────────────────────
bot.onText(/\/pending/, async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const { data } = await db.from('orders')
    .select('*').eq('status', 'pending').order('created_at', { ascending: false });
  if (!data?.length) { bot.sendMessage(msg.chat.id, '✅ No pending orders!'); return; }
  const text = data.map((o, i) =>
    `#${i+1} — ${o.product_name}\n` +
    `💰 $${o.price_usd} | 👤 @${o.telegram_username||'unknown'}\n` +
    `📦 ${o.shipping_name||'—'}\n${o.shipping_address||'—'}\n` +
    `📅 ${new Date(o.created_at).toLocaleString()}\n` +
    `🔑 \`${o.id}\``
  ).join('\n\n');
  bot.sendMessage(msg.chat.id, `⏳ *Pending Orders:*\n\n${text}\n\nConfirm: /confirmorder <id>\nShip: /shiporder <id>\nDeliver: /deliverorder <id>`, { parse_mode: 'Markdown' });
});

// ── /confirmorder <id> ────────────────────────
// Marks order as 'ordered', updates total_spent, notifies customer.
bot.onText(/\/confirmorder (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const orderId = match[1].trim();

  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) { bot.sendMessage(msg.chat.id, '❌ Order not found.'); return; }
  if (order.status !== 'pending' && order.status !== 'confirmed') {
    bot.sendMessage(msg.chat.id, `⚠️ Order is already: ${order.status}`); return;
  }

  await db.from('orders').update({ status: 'ordered' }).eq('id', orderId);

  // Update user's total_spent
  const { data: profile } = await db.from('user_profiles')
    .select('total_spent').eq('telegram_user_id', order.telegram_user_id).single();
  const newTotalSpent = parseFloat(profile?.total_spent || 0) + parseFloat(order.price_usd);
  await db.from('user_profiles')
    .update({ total_spent: newTotalSpent })
    .eq('telegram_user_id', order.telegram_user_id);

  bot.sendMessage(msg.chat.id,
    `✅ *Order confirmed — status: Ordered*\n\n` +
    `📦 ${order.product_name}\n💰 $${order.price_usd}\n` +
    `👤 @${order.telegram_username||'unknown'}\n` +
    `🏠 ${order.shipping_name||'—'} — ${order.shipping_address||'—'}`,
    { parse_mode: 'Markdown' }
  );

  if (order.telegram_user_id) {
    bot.sendMessage(order.telegram_user_id,
      `✅ *Your order has been confirmed!*\n\n` +
      `📦 ${order.product_name}\n💰 $${order.price_usd}\n` +
      `🏠 Shipping to: ${order.shipping_name||'—'}\n${order.shipping_address||'—'}\n\n` +
      `We'll notify you when it ships! 🍃`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /shiporder <id> ───────────────────────────
bot.onText(/\/shiporder (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const orderId = match[1].trim();

  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) { bot.sendMessage(msg.chat.id, '❌ Order not found.'); return; }
  if (order.status === 'shipped' || order.status === 'delivered') {
    bot.sendMessage(msg.chat.id, `⚠️ Order is already: ${order.status}`); return;
  }

  await db.from('orders').update({ status: 'shipped' }).eq('id', orderId);

  bot.sendMessage(msg.chat.id,
    `📬 *Order marked as Shipped!*\n\n📦 ${order.product_name}\n👤 @${order.telegram_username||'unknown'}`,
    { parse_mode: 'Markdown' }
  );

  if (order.telegram_user_id) {
    bot.sendMessage(order.telegram_user_id,
      `📬 *Your order has shipped!*\n\n` +
      `📦 ${order.product_name}\n💰 $${order.price_usd}\n` +
      `🏠 ${order.shipping_name||'—'}\n${order.shipping_address||'—'}\n\n` +
      `It's on its way! 🍃`,
      { parse_mode: 'Markdown' }
    );
  }
});

// ── /deliverorder <id> ────────────────────────
bot.onText(/\/deliverorder (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const orderId = match[1].trim();

  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) { bot.sendMessage(msg.chat.id, '❌ Order not found.'); return; }
  if (order.status === 'delivered') {
    bot.sendMessage(msg.chat.id, '⚠️ Already marked as delivered.'); return;
  }

  await db.from('orders').update({ status: 'delivered' }).eq('id', orderId);

  bot.sendMessage(msg.chat.id,
    `✅ *Order marked as Delivered!*\n\n📦 ${order.product_name}\n👤 @${order.telegram_username||'unknown'}`,
    { parse_mode: 'Markdown' }
  );

  if (order.telegram_user_id) {
    bot.sendMessage(order.telegram_user_id,
      `✅ *Your order has been delivered!*\n\n` +
      `📦 ${order.product_name}\n💰 $${order.price_usd}\n\n` +
      `Enjoy! Thank you for shopping with bakery 🍃\n` +
      `Tap below to leave a review ⭐`,
      {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            { text: '⭐ Leave a Review', web_app: { url: `${APP_URL}?startapp=review_${orderId}` } }
          ]]
        }
      }
    );
  }
});

// ── /deposits ─────────────────────────────────
bot.onText(/\/deposits/, async (msg) => {
  console.log('deposits from:', msg.chat.id, 'owner:', OWNER_ID);
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const { data } = await db.from('deposits')
    .select('*').eq('status', 'pending').order('created_at', { ascending: false });
  if (!data?.length) { bot.sendMessage(msg.chat.id, '✅ No pending deposits!'); return; }
  const text = data.map((d, i) =>
    `#${i+1} — ${d.crypto} — $${d.amount_usd}\n👤 User ID: ${d.telegram_user_id}\n📅 ${new Date(d.created_at).toLocaleString()}\n🔑 \`${d.id}\``
  ).join('\n\n');
  bot.sendMessage(msg.chat.id, `💰 *Pending Deposits:*\n\n${text}\n\nTo confirm: /confirmdeposit <id>`, { parse_mode: 'Markdown' });
});

// ── /confirmdeposit <id> ──────────────────────
bot.onText(/\/confirmdeposit (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;
  const depositId = match[1].trim();
  const { data: deposit, error } = await db.from('deposits').select('*').eq('id', depositId).single();
  if (error || !deposit) { bot.sendMessage(msg.chat.id, '❌ Deposit not found.'); return; }
  if (deposit.status === 'confirmed') { bot.sendMessage(msg.chat.id, '⚠️ Already confirmed.'); return; }
  await db.from('deposits').update({ status: 'confirmed' }).eq('id', depositId);
  const { data: profile } = await db.from('user_profiles')
    .select('balance_usd').eq('telegram_user_id', deposit.telegram_user_id).single();
  const newBalance = parseFloat(profile?.balance_usd || 0) + parseFloat(deposit.amount_usd);
  await db.from('user_profiles').update({ balance_usd: newBalance })
    .eq('telegram_user_id', deposit.telegram_user_id);
  bot.sendMessage(msg.chat.id,
    `✅ Deposit confirmed!\n💰 $${deposit.amount_usd} added\n📊 New balance: $${newBalance.toFixed(2)}`,
    { parse_mode: 'Markdown' });
  bot.sendMessage(deposit.telegram_user_id,
    `✅ *Deposit confirmed!*\n\n💰 $${deposit.amount_usd} added to your wallet\n📊 New balance: $${newBalance.toFixed(2)}\n\nYou can now shop! 🍃`,
    { parse_mode: 'Markdown' });
});

// ── Realtime listeners ────────────────────────
db.channel('new-orders')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'orders' }, (payload) => {
    const o = payload.new;
    bot.sendMessage(OWNER_ID,
`🛒 *New Order!*\n` +
`📦 ${o.product_name}\n` +
`💰 $${o.price_usd}\n` +
`👤 @${o.telegram_username||'unknown'}\n` +
`🏠 ${o.shipping_name||'—'}\n${o.shipping_address||'—'}\n` +
`📅 ${new Date(o.created_at).toLocaleString()}\n` +
`🔑 \`${o.id}\`\n\n` +
`To confirm: /confirmorder ${o.id}`,
      { parse_mode: 'Markdown' });
  }).subscribe();

db.channel('new-deposits')
  .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'deposits' }, (payload) => {
    const d = payload.new;
    bot.sendMessage(OWNER_ID,
`💰 *New Deposit!*\n💎 ${d.crypto} — $${d.amount_usd}\n👤 User ID: ${d.telegram_user_id}\n📅 ${new Date(d.created_at).toLocaleString()}\n🔑 \`${d.id}\`\n\nTo confirm: /confirmdeposit ${d.id}`,
      { parse_mode: 'Markdown' });
  }).subscribe();

console.log('Bakery bot running... 🍃');
