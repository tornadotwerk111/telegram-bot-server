const TelegramBot = require('node-telegram-bot-api');

const TOKEN = process.env.BOT_TOKEN;
const APP_URL = process.env.APP_URL;

const bot = new TelegramBot(TOKEN, { polling: true });

bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const firstName = msg.from.first_name;

  bot.sendMessage(chatId, `👋 Hey ${firstName}! Tap the button below to open the app.`, {
    reply_markup: {
      inline_keyboard: [[
        {
          text: '🚀 Open App',
          web_app: { url: APP_URL }
        }
      ]]
    }
  });
});

console.log('Bot is running...');
