// ================== IMPORTS ==================
const TelegramBot = require('node-telegram-bot-api');
const express = require('express');
const QRCode = require('qrcode');
const admin = require('firebase-admin');

// ================== CONFIG ==================
const TOKEN = '8424105589:AAHcUbwHGrxGy5TUcBZcEYx0Jo6hyRPTLkg';
const ADMIN_ID = 6346588132;
const PORT = process.env.PORT || 3000;

// ================== FIREBASE SETUP ==================
const serviceAccount = require('./firebase-key.json'); // ye file tu Firebase se download karega

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://raavana-indo-default-rtdb.firebaseio.com/'
});
const db = admin.database();

// Helper: Get & Set data
async function getDB() {
  const snapshot = await db.ref('/').once('value');
  return snapshot.exists() ? snapshot.val() : {
    users: {},
    stock: { fresh: [], old: [] },
    passwords: {},
    balance: {},
    prices: {},
    purchaseHistory: {},
    upi: "Jsd@slc"
  };
}

async function saveDB(data) {
  await db.ref('/').set(data);
}

function formatCurrency(amount) {
  return `₹${amount}`;
}

// ================== BOT INITIALIZATION ==================
const bot = new TelegramBot(TOKEN, { polling: true });

// ================== EXPRESS KEEP ALIVE ==================
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ================== KEYBOARDS ==================
const adminKeyboard = {
  reply_markup: {
    keyboard: [
      ['➕ Add FRESH INDO', '➕ Add OLD INDO'],
      ['💸 Send Balance', '💰 Subtract Balance'],
      ['👥 Check Users', '📢 Send Announcement'],
      ['💲 Set Prices'],
      ['🗑️ Remove IGs']
    ],
    resize_keyboard: true
  }
};

const userKeyboard = {
  reply_markup: {
    keyboard: [
      ['💸 Buy FRESH IG', '💸 Buy OLD INDO IG'],
      ['📦 Available Stock', '➕ Add Balance'],
      ['💰 Check Balance', '👑 Contact Owner']
    ],
    resize_keyboard: true
  }
};

const quantityKeyboard = {
  reply_markup: {
    keyboard: [
      ['1','2','3'],
      ['4','5','6'],
      ['7','8','9'],
      ['10','BACK']
    ],
    resize_keyboard: true
  }
};

// ================== UTILS ==================
async function ensureUser(userId, name = 'Unknown') {
  const data = await getDB();
  if (!data.users[userId]) {
    data.users[userId] = { balance: 0, name };
    data.purchaseHistory[userId] = [];
    await saveDB(data);
  } else if (name) {
    data.users[userId].name = name;
    await saveDB(data);
  }
}

function isAdmin(id) {
  return id === ADMIN_ID;
}

// ================== /start ==================
bot.onText(/\/start/, async (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.username || msg.from.first_name || 'Unknown';
  await ensureUser(chatId, name);
  if (isAdmin(chatId)) bot.sendMessage(chatId, `Welcome Admin`, adminKeyboard);
  else bot.sendMessage(chatId, `Welcome ${name}`, userKeyboard);
});

// ================== MESSAGE HANDLER ==================
bot.on('message', async (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  const data = await getDB();

  // ADMIN SECTION
  if (isAdmin(chatId)) {
    if (text === '➕ Add FRESH INDO') return bot.sendMessage(chatId, 'Use /addusername fresh <user1,user2,...>');
    else if (text === '➕ Add OLD INDO') return bot.sendMessage(chatId, 'Use /addusername old <user1,user2,...>');
    else if (text === '💸 Send Balance') return bot.sendMessage(chatId, 'Use /sendbalance <user_id> <amount>');
    else if (text === '💰 Subtract Balance') return bot.sendMessage(chatId, 'Use /subtractbalance <user_id> <amount>');
    else if (text === '👥 Check Users') {
      const users = Object.keys(data.users);
      if (users.length === 0) return bot.sendMessage(chatId, 'No users yet.');
      let msgText = `Total Users: ${users.length}\n\n`;
      users.forEach(uid => {
        const name = data.users[uid].name || 'Unknown';
        msgText += `ID: ${uid} | Name: ${name}\n`;
      });
      return bot.sendMessage(chatId, msgText);
    }
    else if (text === '📢 Send Announcement') return bot.sendMessage(chatId, 'Use /announce <message>');
    else if (text === '💲 Set Prices') return bot.sendMessage(chatId, 'Use commands:\n/setfreshigprice <amount>\n/setoldindoigprice <amount>');
    else if (text === '🗑️ Remove IGs') return bot.sendMessage(chatId, `Use commands:\n/removefreshig <username>\n/removeoldig <username>`);
    else if (text === 'BACK') return bot.sendMessage(chatId, 'Home', adminKeyboard);
    return;
  }

  // USER SECTION
  await ensureUser(chatId, msg.from.username || msg.from.first_name || 'Unknown');

  if (text === 'BACK') return bot.sendMessage(chatId, 'Home', userKeyboard);

  // Buy IGs
  if (text.includes('💸 Buy')) {
    let type = text.includes('FRESH') ? 'fresh' : 'old';
    bot.sendMessage(chatId, `Select quantity`, quantityKeyboard);
    bot.once('message', async (qmsg) => {
      const qty = parseInt(qmsg.text);
      if (qmsg.text === 'BACK') return bot.sendMessage(chatId, 'Back to menu', userKeyboard);
      if (isNaN(qty) || qty < 1) return bot.sendMessage(chatId, 'Invalid quantity', userKeyboard);
      const currentData = await getDB();
      if (!currentData.prices[type]) return bot.sendMessage(chatId, `❌ ${type.toUpperCase()} price not set`);
      const total = currentData.prices[type] * qty;
      if (currentData.users[chatId].balance < total)
        return bot.sendMessage(chatId, `❌ Insufficient balance. Total: ${formatCurrency(total)}`, userKeyboard);

      const stock = currentData.stock[type];
      if (!stock || stock.length < qty) return bot.sendMessage(chatId, `❌ Insufficient stock`, userKeyboard);

      const allocated = stock.splice(0, qty);
      currentData.users[chatId].balance -= total;
      const password = currentData.passwords[type] || 'N/A';
      currentData.purchaseHistory[chatId].push({ type, qty, allocated, password, total });
      await saveDB(currentData);

      let msgText = `✅ Purchase Success\n`;
      allocated.forEach(a => msgText += `USERNAME - ${a}\nPASSWORD - ${password}\n`);
      msgText += `Price per unit: ${formatCurrency(currentData.prices[type])}\n💰 Remaining balance: ${formatCurrency(currentData.users[chatId].balance)}`;
      bot.sendMessage(chatId, msgText, userKeyboard);
    });
  }

  // Available Stock
  else if (text === '📦 Available Stock') {
    const msgText = `📦 AVAILABLE IGS\nFRESH IG - ${data.stock.fresh.length}\nOLD IG - ${data.stock.old.length}`;
    bot.sendMessage(chatId, msgText);
  }

  // Add Balance
  else if (text === '➕ Add Balance') bot.sendMessage(chatId, 'Use /add <amount> (min ₹10)');

  // Check Balance
  else if (text === '💰 Check Balance') bot.sendMessage(chatId, `💰 Your Balance: ${formatCurrency(data.users[chatId].balance)}`);

  // Contact Owner
  else if (text === '👑 Contact Owner') bot.sendMessage(chatId, `📞 Owner - @Raavana_hu`);
});

// ================== ADMIN COMMANDS ==================
bot.onText(/\/setpassword (.+) (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const type = match[1].toLowerCase();
  const password = match[2];
  if (!['fresh','old'].includes(type)) return bot.sendMessage(msg.chat.id, 'Invalid type');
  const data = await getDB();
  data.passwords[type] = password;
  await saveDB(data);
  bot.sendMessage(msg.chat.id, `✅ Password for ${type.toUpperCase()} set: ${password}`);
});

bot.onText(/\/setfreshigprice (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const data = await getDB();
  data.prices['fresh'] = parseInt(match[1]);
  await saveDB(data);
  bot.sendMessage(msg.chat.id, `✅ FRESH price set ${formatCurrency(data.prices['fresh'])}`);
});

bot.onText(/\/setoldindoigprice (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const data = await getDB();
  data.prices['old'] = parseInt(match[1]);
  await saveDB(data);
  bot.sendMessage(msg.chat.id, `✅ OLD price set ${formatCurrency(data.prices['old'])}`);
});

bot.onText(/\/addusername (.+) (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const type = match[1].toLowerCase();
  const usernames = match[2].split(',');
  if (!['fresh','old'].includes(type)) return bot.sendMessage(msg.chat.id, 'Invalid type');
  const data = await getDB();
  const added = [], skipped = [];
  usernames.forEach(u => data.stock[type].includes(u) ? skipped.push(u) : added.push(data.stock[type].push(u)&&u));
  await saveDB(data);
  bot.sendMessage(msg.chat.id, `✅ Added ${added.length} usernames to ${type}\n❌ Skipped duplicates: ${skipped.join(', ') || 'None'}`);
});

bot.onText(/\/sendbalance (\d+) (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const userId = match[1]; const amount = parseInt(match[2]);
  const data = await getDB();
  await ensureUser(userId);
  data.users[userId].balance += amount;
  await saveDB(data);
  bot.sendMessage(msg.chat.id, `✅ ${formatCurrency(amount)} added to User ${userId}`);
  bot.sendMessage(userId, `💰 ${formatCurrency(amount)} added. Total balance: ${formatCurrency(data.users[userId].balance)}`);
});

bot.onText(/\/subtractbalance (\d+) (\d+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const userId = match[1]; const amount = parseInt(match[2]);
  const data = await getDB();
  await ensureUser(userId);
  data.users[userId].balance = Math.max(0, data.users[userId].balance - amount);
  await saveDB(data);
  bot.sendMessage(msg.chat.id, `✅ ${formatCurrency(amount)} subtracted from ${userId}`);
  bot.sendMessage(userId, `⚠️ ${formatCurrency(amount)} has been subtracted. New Balance: ${formatCurrency(data.users[userId].balance)}`);
});

bot.onText(/\/announce (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const data = await getDB();
  Object.keys(data.users).forEach(u => bot.sendMessage(u, `📢 Announcement: ${match[1]}`));
});

bot.onText(/\/removefreshig (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const username = match[1];
  const data = await getDB();
  const index = data.stock['fresh'].indexOf(username);
  if (index > -1) { data.stock['fresh'].splice(index, 1); await saveDB(data); bot.sendMessage(msg.chat.id, `✅ Removed ${username} from FRESH stock`); }
  else bot.sendMessage(msg.chat.id, `❌ Username ${username} not in FRESH stock`);
});

bot.onText(/\/removeoldig (.+)/, async (msg, match) => {
  if (!isAdmin(msg.chat.id)) return;
  const username = match[1];
  const data = await getDB();
  const index = data.stock['old'].indexOf(username);
  if (index > -1) { data.stock['old'].splice(index, 1); await saveDB(data); bot.sendMessage(msg.chat.id, `✅ Removed ${username} from OLD stock`); }
  else bot.sendMessage(msg.chat.id, `❌ Username ${username} not in OLD stock`);
});

// ================== USER COMMANDS ==================
bot.onText(/\/add (\d+)/, async (msg, match) => {
  const chatId = msg.chat.id;
  await ensureUser(chatId);
  const data = await getDB();
  const amount = parseInt(match[1]);
  if (amount < 10) return bot.sendMessage(chatId, '❌ Minimum ₹10 required');

  const upiID = data.upi.trim();
  if (!upiID) return bot.sendMessage(chatId, '❌ UPI not set by admin');

  try {
    const tempMsg = await bot.sendMessage(chatId, '⏳ Generating QR...');
    await new Promise(res => setTimeout(res, 1500));
    await bot.deleteMessage(chatId, tempMsg.message_id);

    const upiString = `upi://pay?pa=${upiID}&pn=BotTopup&am=${amount}&cu=INR`;
    const qrDataURL = await QRCode.toDataURL(upiString, { errorCorrectionLevel: 'H' });
    const base64Data = qrDataURL.replace(/^data:image\/png;base64,/, '');
    const qrBuffer = Buffer.from(base64Data, 'base64');

    await bot.sendPhoto(chatId, qrBuffer, {
      caption: `💳 Pay ${formatCurrency(amount)} via QR\nAfter pay: /sendapproval <UTR/TXN>`
    });

  } catch (err) {
    console.error('Add balance QR error:', err);
    bot.sendMessage(chatId, '❌ Failed to generate QR');
  }
});

bot.onText(/\/sendapproval (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const utr = match[1];
  bot.sendMessage(ADMIN_ID, `📩 Approval Request\nUser: ${chatId}\nUTR/TXN: ${utr}`);
  bot.sendMessage(chatId, `✅ Approval request sent for UTR: ${utr}`);
});