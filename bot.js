const TelegramBot = require('node-telegram-bot-api');
const { createClient } = require('@supabase/supabase-js');

const TOKEN       = process.env.BOT_TOKEN;
const APP_URL     = process.env.APP_URL;
const OWNER_ID    = process.env.OWNER_TELEGRAM_ID;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY;

const bot = new TelegramBot(TOKEN, { polling: true });
const db  = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─── /start command ───────────────────────────────────────
bot.onText(/\/start/, (msg) => {
  const chatId     = msg.chat.id;
  const firstName  = msg.from.first_name;

  bot.sendMessage(chatId, `👋 Hey ${firstName}! Tap the button below to open the shop.`, {
    reply_markup: {
      inline_keyboard: [[
        { text: '🛍️ Open Shop', web_app: { url: APP_URL } }
      ]]
    }
  });
});

// ─── /orders command (you only) ───────────────────────────
bot.onText(/\/orders/, async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;

  const { data, error } = await db
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error || !data?.length) {
    bot.sendMessage(msg.chat.id, '📭 No orders yet.');
    return;
  }

  const text = data.map((o, i) => {
    const date = new Date(o.created_at).toLocaleString();
    return `#${i + 1} — ${o.product_name}
💰 $${o.price_usd} in ${o.crypto}
👤 @${o.telegram_username || 'unknown'}
📝 ${o.customer_note || 'No note'}
🔖 Status: ${o.status}
📅 ${date}`;
  }).join('\n\n');

  bot.sendMessage(msg.chat.id, `🧾 *Last 10 Orders:*\n\n${text}`, {
    parse_mode: 'Markdown'
  });
});

// ─── /pending command (you only) ──────────────────────────
bot.onText(/\/pending/, async (msg) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;

  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error || !data?.length) {
    bot.sendMessage(msg.chat.id, '✅ No pending orders!');
    return;
  }

  const text = data.map((o, i) => {
    const date = new Date(o.created_at).toLocaleString();
    return `#${i + 1} — ${o.product_name}
💰 $${o.price_usd} in ${o.crypto}
👤 @${o.telegram_username || 'unknown'}
📝 ${o.customer_note || 'No note'}
📅 ${date}
🔑 ID: \`${o.id}\``;
  }).join('\n\n');

  bot.sendMessage(msg.chat.id, `⏳ *Pending Orders:*\n\n${text}`, {
    parse_mode: 'Markdown'
  });
});

// ─── /confirm command (you only) ──────────────────────────
bot.onText(/\/confirm (.+)/, async (msg, match) => {
  if (String(msg.chat.id) !== String(OWNER_ID)) return;

  const orderId = match[1].trim();
  const { error } = await db
    .from('orders')
    .update({ status: 'confirmed' })
    .eq('id', orderId);

  if (error) {
    bot.sendMessage(msg.chat.id, '❌ Could not update order. Check the ID.');
    return;
  }

  bot.sendMessage(msg.chat.id, `✅ Order \`${orderId}\` marked as confirmed!`, {
    parse_mode: 'Markdown'
  });
});

// ─── New order notification listener ──────────────────────
async function watchNewOrders() {
  const channel = db
    .channel('new-orders')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      async (payload) => {
        const o = payload.new;
        const date = new Date(o.created_at).toLocaleString();

        const message =
`🛒 *New Order!*

📦 *Product:* ${o.product_name}
💰 *Amount:* $${o.price_usd} in ${o.crypto}
👤 *Customer:* @${o.telegram_username || 'unknown'}
📝 *Note:* ${o.customer_note || 'None'}
📅 *Time:* ${date}
🔑 *Order ID:* \`${o.id}\`

To confirm: /confirm ${o.id}`;

        bot.sendMessage(OWNER_ID, message, { parse_mode: 'Markdown' });
      }
    )
    .subscribe();
}

watchNewOrders();
console.log('Bot is running...');
