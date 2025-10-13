// ================== IMPORTS ==================
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const QRCode = require('qrcode');
const admin = require('firebase-admin');
const serviceAccount = require('./raavanakey.json'); // Firebase service account

// ================== CONFIG ==================
const TOKEN = '8124060956:AAFSO8waQ7rM6L47kg5H8wx94eSgHSta0uU';
const ADMIN_ID = 1325276117;
const PORT = process.env.PORT || 3000;
const FIXED_UPI = 'Jsd@slc'; // Fixed UPI ID for QR

// ================== FIREBASE INIT ==================
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: "https://raavana-indo-default-rtdb.firebaseio.com/"
});
const dbRef = admin.database().ref();

// ================== BOT INIT ==================
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

// ================== UTILITY FUNCTIONS ==================
function isAdmin(id){ return id === ADMIN_ID; }
function formatCurrency(amount){ return `₹${amount}`; }

async function ensureUser(userId, name='Unknown'){
    const snapshot = await dbRef.child(`users/${userId}`).get();
    if(!snapshot.exists()){
        await dbRef.child(`users/${userId}`).set({ balance: 0, name });
        await dbRef.child(`purchaseHistory/${userId}`).set([]);
    } else if(name){
        await dbRef.child(`users/${userId}/name`).set(name);
    }
}

async function getStock(type){
    const snap = await dbRef.child(`stock/${type}`).get();
    return snap.exists() ? snap.val() : [];
}

async function allocateStock(type, quantity){
    const stock = await getStock(type);
    if(!stock || stock.length < quantity) return null;
    const allocated = stock.splice(0, quantity);
    await dbRef.child(`stock/${type}`).set(stock);
    return allocated;
}

async function getPrice(type){
    const snap = await dbRef.child(`prices/${type}`).get();
    return snap.exists() ? snap.val() : null;
}

async function getPassword(type){
    const snap = await dbRef.child(`passwords/${type}`).get();
    return snap.exists() ? snap.val() : 'N/A';
}

async function updateBalance(userId, amount){
    const snap = await dbRef.child(`users/${userId}/balance`).get();
    const current = snap.exists() ? snap.val() : 0;
    await dbRef.child(`users/${userId}/balance`).set(current + amount);
    return current + amount;
}

// ================== /START ==================
bot.onText(/\/start/, async (msg)=>{
    const chatId = msg.chat.id;
    const name = msg.from.username || msg.from.first_name || 'Unknown';
    await ensureUser(chatId, name);
    if(isAdmin(chatId)) bot.sendMessage(chatId, `Welcome Admin`, adminKeyboard);
    else bot.sendMessage(chatId, `Welcome ${name}`, userKeyboard);
});

// ================== ADMIN HANDLER ==================
bot.on('message', async (msg)=>{
    const chatId = msg.chat.id;
    const text = msg.text;

    // ADMIN SECTION
    if(isAdmin(chatId)){
        if(text === '➕ Add FRESH INDO') return bot.sendMessage(chatId, 'Use /addusername fresh <user1,user2,...>');
        else if(text === '➕ Add OLD INDO') return bot.sendMessage(chatId, 'Use /addusername old <user1,user2,...>');
        else if(text === '💸 Send Balance') return bot.sendMessage(chatId, 'Use /sendbalance <user_id> <amount>');
        else if(text === '💰 Subtract Balance') return bot.sendMessage(chatId, 'Use /subtractbalance <user_id> <amount>');
        else if(text === '👥 Check Users'){
            const snap = await dbRef.child('users').get();
            if(!snap.exists()) return bot.sendMessage(chatId, 'No users yet.');
            const users = snap.val();
            let msgText = `Total Users: ${Object.keys(users).length}\n\n`;
            for(const uid in users){
                const name = users[uid].name || 'Unknown';
                msgText += `ID: ${uid} | Name: ${name}\n`;
            }
            return bot.sendMessage(chatId, msgText);
        }
        else if(text === '📢 Send Announcement') return bot.sendMessage(chatId, 'Use /announce <message>');
        else if(text === '💲 Set Prices') return bot.sendMessage(chatId, 'Use commands:\n/setfreshigprice <amount>\n/setoldindoigprice <amount>');
        else if(text === '🗑️ Remove IGs') return bot.sendMessage(chatId, 'Use /removefreshig <username>\n/removeoldig <username>');
        else if(text === 'BACK') return bot.sendMessage(chatId, 'Home', adminKeyboard);
        return;
    }

    // USER SECTION
    await ensureUser(chatId, msg.from.username || msg.from.first_name || 'Unknown');

    if(text === 'BACK') return bot.sendMessage(chatId, 'Home', userKeyboard);

    if(text.includes('💸 Buy')){
        let type = text.includes('FRESH') ? 'fresh' : 'old';
        bot.sendMessage(chatId, 'Select quantity', quantityKeyboard);
        bot.once('message', async (qmsg)=>{
            const qty = parseInt(qmsg.text);
            if(qmsg.text==='BACK') return bot.sendMessage(chatId,'Back to menu',userKeyboard);
            if(isNaN(qty) || qty<1) return bot.sendMessage(chatId,'Invalid quantity',userKeyboard);

            const price = await getPrice(type);
            if(!price) return bot.sendMessage(chatId, `❌ ${type.toUpperCase()} price not set`);

            const snap = await dbRef.child(`users/${chatId}/balance`).get();
            const balance = snap.exists()?snap.val():0;
            const total = price*qty;
            if(balance<total) return bot.sendMessage(chatId, `❌ Insufficient balance. Total: ${formatCurrency(total)}`, userKeyboard);

            const allocated = await allocateStock(type, qty);
            if(!allocated) return bot.sendMessage(chatId, `❌ Insufficient stock`, userKeyboard);

            await dbRef.child(`users/${chatId}/balance`).set(balance - total);
            const password = await getPassword(type);
            const phRef = dbRef.child(`purchaseHistory/${chatId}`);
            const phSnap = await phRef.get();
            const ph = phSnap.exists()?phSnap.val():[];
            ph.push({ type, qty, allocated, password, total });
            await phRef.set(ph);

            let msgText = `✅ Purchase Success\n`;
            allocated.forEach(a => msgText += `USERNAME - ${a}\nPASSWORD - ${password}\n`);
            msgText += `Price per unit: ${formatCurrency(price)}\n💰 Remaining balance: ${formatCurrency(balance-total)}`;
            bot.sendMessage(chatId,msgText,userKeyboard);
        });
    }
    else if(text==='📦 Available Stock'){
        const fresh = await getStock('fresh');
        const old = await getStock('old');
        const msgText = `📦 AVAILABLE IGS\nFRESH IG - ${fresh.length}\nOLD IG - ${old.length}`;
        bot.sendMessage(chatId,msgText);
    }
    else if(text==='➕ Add Balance') bot.sendMessage(chatId, 'Use /add <amount> (min ₹30)');
    else if(text==='💰 Check Balance'){
        const snap = await dbRef.child(`users/${chatId}/balance`).get();
        const balance = snap.exists()?snap.val():0;
        bot.sendMessage(chatId, `💰 Your Balance: ${formatCurrency(balance)}`);
    }
    else if(text==='👑 Contact Owner') bot.sendMessage(chatId, `📞 Owner - @Raavana_hu`);
});

// ================== ADMIN COMMANDS ==================

// Set Password
bot.onText(/\/setpassword (.+) (.+)/, async (msg, match)=>{
    if(!isAdmin(msg.chat.id)) return;
    const type = match[1].toLowerCase();
    const password = match[2];
    if(!['fresh','old'].includes(type)) return bot.sendMessage(msg.chat.id,'Invalid type');
    await dbRef.child(`passwords/${type}`).set(password);
    bot.sendMessage(msg.chat.id, `✅ Password for ${type.toUpperCase()} set: ${password}`);
});

// Set Prices
bot.onText(/\/setfreshigprice (\d+)/, async (msg, match)=>{
    if(!isAdmin(msg.chat.id)) return;
    await dbRef.child('prices/fresh').set(parseInt(match[1]));
    bot.sendMessage(msg.chat.id, `✅ FRESH price set ${formatCurrency(parseInt(match[1]))}`);
});
bot.onText(/\/setoldindoigprice (\d+)/, async (msg, match)=>{
    if(!isAdmin(msg.chat.id)) return;
    await dbRef.child('prices/old').set(parseInt(match[1]));
    bot.sendMessage(msg.chat.id, `✅ OLD INDO price set ${formatCurrency(parseInt(match[1]))}`);
});

// Add usernames
bot.onText(/\/addusername (.+) (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const type = match[1].toLowerCase();
    const usernames = match[2].split(',').map(u => u.trim()).filter(u => u);

    if (!['indo','fresh','old'].includes(type)) return bot.sendMessage(msg.chat.id, 'Invalid type');

    const stockRef = dbRef.child(`stock/${type}`);
    const snap = await stockRef.get();
    let stock = snap.exists() ? snap.val() : [];

    const added = [];
    const skipped = [];

    usernames.forEach(u => {
        if (stock.includes(u)) skipped.push(u);
        else { stock.push(u); added.push(u); }
    });

    await stockRef.set(stock);
    saveDB(); // local db.json bhi update

    bot.sendMessage(msg.chat.id, `✅ Added ${added.length} usernames to ${type}\n❌ Skipped duplicates: ${skipped.join(', ') || 'None'}`);
});

// Send Balance
bot.onText(/\/sendbalance (\d+) (\d+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const userId = match[1]; 
    const amount = parseInt(match[2]);
    ensureUser(userId);

    db.users[userId].balance += amount;
    await dbRef.child(`users/${userId}/balance`).set(db.users[userId].balance);
    saveDB();

    bot.sendMessage(msg.chat.id, `✅ ${formatCurrency(amount)} added to User ${userId}`);
    bot.sendMessage(userId, `💰 ${formatCurrency(amount)} added. Total balance: ${formatCurrency(db.users[userId].balance)}`);
});

// Subtract Balance
bot.onText(/\/subtractbalance (\d+) (\d+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const userId = match[1]; 
    const amount = parseInt(match[2]);
    ensureUser(userId);

    db.users[userId].balance = Math.max(0, db.users[userId].balance - amount);
    await dbRef.child(`users/${userId}/balance`).set(db.users[userId].balance);
    saveDB();

    bot.sendMessage(msg.chat.id, `✅ ${formatCurrency(amount)} subtracted from ${userId}`);
    bot.sendMessage(userId, `⚠️ ${formatCurrency(amount)} has been subtracted. New Balance: ${formatCurrency(db.users[userId].balance)}`);
});

// Announce
bot.onText(/\/announce (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const message = match[1];
    Object.keys(db.users).forEach(u => bot.sendMessage(u, `📢 Announcement: ${message}`));
});

// Remove IGs
bot.onText(/\/removeindoig (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const username = match[1]; 
    const stockRef = dbRef.child('stock/indo');
    const snap = await stockRef.get();
    let stock = snap.exists() ? snap.val() : [];

    const index = stock.indexOf(username);
    if (index > -1) { stock.splice(index,1); await stockRef.set(stock); saveDB(); bot.sendMessage(msg.chat.id, `✅ Removed ${username} from INDO stock`); }
    else bot.sendMessage(msg.chat.id, `❌ Username ${username} not in INDO stock`);
});

bot.onText(/\/removefreshig (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const username = match[1]; 
    const stockRef = dbRef.child('stock/fresh');
    const snap = await stockRef.get();
    let stock = snap.exists() ? snap.val() : [];

    const index = stock.indexOf(username);
    if (index > -1) { stock.splice(index,1); await stockRef.set(stock); saveDB(); bot.sendMessage(msg.chat.id, `✅ Removed ${username} from FRESH stock`); }
    else bot.sendMessage(msg.chat.id, `❌ Username ${username} not in FRESH stock`);
});

bot.onText(/\/removeoldig (.+)/, async (msg, match) => {
    if (!isAdmin(msg.chat.id)) return;
    const username = match[1]; 
    const stockRef = dbRef.child('stock/old');
    const snap = await stockRef.get();
    let stock = snap.exists() ? snap.val() : [];

    const index = stock.indexOf(username);
    if (index > -1) { stock.splice(index,1); await stockRef.set(stock); saveDB(); bot.sendMessage(msg.chat.id, `✅ Removed ${username} from OLD stock`); }
    else bot.sendMessage(msg.chat.id, `❌ Username ${username} not in OLD stock`);
});

// ================== USER COMMANDS ==================

// Add Balance - FIXED UPI, DYNAMIC AMOUNT
bot.onText(/\/add (\d+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    ensureUser(chatId);

    const amount = parseInt(match[1]);
    if (amount < 30) return bot.sendMessage(chatId, '❌ Minimum ₹30 required');

    const upiID = db.upi ? db.upi.trim() : FIXED_UPI;
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

// Send Approval
bot.onText(/\/sendapproval (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const utr = match[1]; 
    ensureUser(chatId);

    // Send request to admin
    bot.sendMessage(ADMIN_ID, `📩 Approval Request\nUser: ${chatId}\nAmount: Pending\nUTR: ${utr}`);
    bot.sendMessage(chatId, `✅ Approval request sent for UTR: ${utr}`);
});