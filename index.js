// ================== IMPORTS ==================
const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const express = require('express');
const QRCode = require('qrcode');

// ================== CONFIG ==================
const TOKEN = '8124060956:AAFSO8waQ7rM6L47kg5H8wx94eSgHSta0uU';
const ADMIN_ID = 6346588132;
const PORT = process.env.PORT || 3000;
const DB_FILE = './db.json';
const FIXED_UPI = 'Jsd@slc';

// ================== LOAD OR CREATE DB ==================
let db = {
  users: {},
  stock: { indo: [], fresh: [], old: [] },
  passwords: {},
  balance: {},
  prices: {},
  purchaseHistory: {},
  upi: FIXED_UPI
};
if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE));
else fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

function saveDB() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function isAdmin(id) { return id === ADMIN_ID; }
function ensureUser(userId, name='Unknown') {
  if (!db.users[userId]) {
    db.users[userId] = { balance: 0, name };
    db.purchaseHistory[userId] = [];
    saveDB();
  } else if (name) db.users[userId].name = name;
}
function formatCurrency(amount) { return `₹${amount}`; }
function allocateStock(type, quantity) {
  if (!db.stock[type] || !Array.isArray(db.stock[type])) db.stock[type] = [];
  const stock = db.stock[type];
  if (stock.length < quantity) return null;
  const allocated = stock.splice(0, quantity);
  saveDB();
  return allocated;
}

// ================== BOT INITIALIZATION ==================
const bot = new TelegramBot(TOKEN, { polling: true });

// ================== EXPRESS KEEP ALIVE ==================
const app = express();
app.get('/', (req, res) => res.send('Bot is alive'));
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ================== KEYBOARDS ==================
const adminKeyboard = { reply_markup:{ keyboard:[['➕ Add OLD INDO','➕ Add FRESH INDO','➕ Add INDO'],['💸 Send Balance','💰 Subtract Balance'],['👥 Check Users','📢 Send Announcement'],['💲 Set Prices'],['🗑️ Remove IGs']], resize_keyboard:true } };
const userKeyboard = { reply_markup:{ keyboard:[['💸 Buy OLD INDO','💸 Buy FRESH IG','💸 Buy INDO IG'],['📦 Available Stock','➕ Add Balance'],['💰 Check Balance','👑 Contact Owner']], resize_keyboard:true } };
const quantityKeyboard = { reply_markup:{ keyboard:[['1','2','3'],['4','5','6'],['7','8','9'],['10','BACK']], resize_keyboard:true } };

// ================== /start ==================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  const name = msg.from.username || msg.from.first_name || 'Unknown';
  ensureUser(chatId, name);
  if (isAdmin(chatId)) bot.sendMessage(chatId, `Welcome Admin`, adminKeyboard);
  else bot.sendMessage(chatId, `Welcome ${name}`, userKeyboard);
});

// ================== ADMIN BUTTON HANDLER ==================
bot.on('message', (msg) => {
  const chatId = msg.chat.id;
  const text = msg.text;
  if (isAdmin(chatId)) {
    if (text==='➕ Add OLD INDO') return bot.sendMessage(chatId,'Use /addusername old <user1,user2,...>');
    else if (text==='➕ Add FRESH INDO') return bot.sendMessage(chatId,'Use /addusername fresh <user1,user2,...>');
    else if (text==='➕ Add INDO') return bot.sendMessage(chatId,'Use /addusername indo <user1,user2,...>');
    else if (text==='💸 Send Balance') return bot.sendMessage(chatId,'Use /sendbalance <user_id> <amount>');
    else if (text==='💰 Subtract Balance') return bot.sendMessage(chatId,'Use /subtractbalance <user_id> <amount>');
    else if (text==='👥 Check Users') {
      const users = Object.keys(db.users);
      if(users.length===0) return bot.sendMessage(chatId,'No users yet.');
      let msgText=`Total Users: ${users.length}\n\n`;
      users.forEach(uid=>{ const name=db.users[uid].name||'Unknown'; msgText+=`ID: ${uid} | Name: ${name}\n`; });
      return bot.sendMessage(chatId,msgText);
    }
    else if (text==='📢 Send Announcement') return bot.sendMessage(chatId,'Use /announce <message>');
    else if (text==='💲 Set Prices') return bot.sendMessage(chatId,'Use commands:\n/setindoigprice <amount>\n/setfreshigprice <amount>\n/setoldindoigprice <amount>');
    else if (text==='🗑️ Remove IGs') return bot.sendMessage(chatId,'Use commands:\n/removeindoig <username>\n/removefreshig <username>\n/removeoldig <username>');
    else if (text==='BACK') return bot.sendMessage(chatId,'Home',adminKeyboard);
    return;
  }

  ensureUser(chatId,msg.from.username||msg.from.first_name||'Unknown');
  if(text==='BACK') return bot.sendMessage(chatId,'Home',userKeyboard);

  if(text.includes('💸 Buy')) {
    let type=text.includes('INDO')&&!text.includes('FRESH')?'indo':text.includes('FRESH')?'fresh':'old';
    bot.sendMessage(chatId,'Select quantity',quantityKeyboard);
    bot.once('message',qmsg=>{
      const qty=parseInt(qmsg.text);
      if(qmsg.text==='BACK') return bot.sendMessage(chatId,'Back to menu',userKeyboard);
      if(isNaN(qty)||qty<1) return bot.sendMessage(chatId,'Invalid quantity',userKeyboard);
      if(!db.prices[type]) return bot.sendMessage(chatId,`❌ ${type.toUpperCase()} price not set`);
      const total=db.prices[type]*qty;
      if((db.users[chatId].balance||0)<total) return bot.sendMessage(chatId,`❌ Insufficient balance. Total: ${formatCurrency(total)}`,userKeyboard);
      const allocated=allocateStock(type,qty);
      if(!allocated||allocated.length<qty) return bot.sendMessage(chatId,`❌ Insufficient stock`,userKeyboard);
      db.users[chatId].balance-=(total);
      const password=db.passwords[type]||'N/A';
      if(!db.purchaseHistory[chatId]) db.purchaseHistory[chatId]=[];
      db.purchaseHistory[chatId].push({type,qty,allocated,password,total});
      saveDB();
      let msgText=`✅ Purchase Success\n`;
      allocated.forEach(a=>msgText+=`USERNAME - ${a}\nPASSWORD - ${password}\n`);
      msgText+=`Price per unit: ${formatCurrency(db.prices[type])}\n💰 Remaining balance: ${formatCurrency(db.users[chatId].balance)}`;
      bot.sendMessage(chatId,msgText,userKeyboard);
    });
  }

  else if(text==='📦 Available Stock') bot.sendMessage(chatId,`📦 AVAILABLE IGS\nOLD IG - ${db.stock.indo.length}\nFRESH IG - ${db.stock.fresh.length}\nINDO IG - ${db.stock.old.length}`);
  else if(text==='➕ Add Balance') bot.sendMessage(chatId,'Use /add <amount> (min ₹10)');
  else if(text==='💰 Check Balance') bot.sendMessage(chatId,`💰 Your Balance: ${formatCurrency(db.users[chatId].balance||0)}`);
  else if(text==='👑 Contact Owner') bot.sendMessage(chatId,'📞 Owner - @Raavana_hu');
});

// ================== ADMIN COMMANDS ==================
bot.onText(/\/setpassword (.+) (.+)/, (msg, match)=> {
  if(!isAdmin(msg.chat.id)) return;
  const type=match[1].toLowerCase(); const password=match[2];
  if(!['indo','fresh','old'].includes(type)) return bot.sendMessage(msg.chat.id,'Invalid type');
  db.passwords[type]=password;
  saveDB();
  bot.sendMessage(msg.chat.id,`✅ Password for ${type.toUpperCase()} set: ${password}`);
});
bot.onText(/\/setoldindoigprice (\d+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; db.prices['indo']=parseInt(match[1]); saveDB(); bot.sendMessage(msg.chat.id,`✅ OLD INDO price set ${formatCurrency(db.prices['indo'])}`); });
bot.onText(/\/setfreshigprice (\d+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; db.prices['fresh']=parseInt(match[1]); saveDB(); bot.sendMessage(msg.chat.id,`✅ FRESH price set ${formatCurrency(db.prices['fresh'])}`); });
bot.onText(/\/setindoigprice (\d+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; db.prices['old']=parseInt(match[1]); saveDB(); bot.sendMessage(msg.chat.id,`✅ INDO price set ${formatCurrency(db.prices['old'])}`); });
bot.onText(/\/addusername (.+) (.+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; const type=match[1].toLowerCase(); const usernames=match[2].split(','); if(!['indo','fresh','old'].includes(type)) return bot.sendMessage(msg.chat.id,'Invalid type'); const added=[],skipped=[]; usernames.forEach(u=> db.stock[type].includes(u)?skipped.push(u):added.push(db.stock[type].push(u)&&u)); saveDB(); bot.sendMessage(msg.chat.id,`✅ Added ${added.length} usernames to ${type}\n❌ Skipped duplicates: ${skipped.join(', ')||'None'}`); });
bot.onText(/\/sendbalance (\d+) (\d+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; const userId=match[1]; const amount=parseInt(match[2]); ensureUser(userId); db.users[userId].balance+=amount; saveDB(); bot.sendMessage(msg.chat.id,`✅ ${formatCurrency(amount)} added to User ${userId}`); bot.sendMessage(userId,`💰 ${formatCurrency(amount)} added. Total balance: ${formatCurrency(db.users[userId].balance)}`); });
bot.onText(/\/subtractbalance (\d+) (\d+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; const userId=match[1]; const amount=parseInt(match[2]); ensureUser(userId); db.users[userId].balance=Math.max(0,db.users[userId].balance-amount); saveDB(); bot.sendMessage(msg.chat.id,`✅ ${formatCurrency(amount)} subtracted from ${userId}`); bot.sendMessage(userId,`⚠️ ${formatCurrency(amount)} has been subtracted. New Balance: ${formatCurrency(db.users[userId].balance)}`); });
bot.onText(/\/announce (.+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; Object.keys(db.users).forEach(u=> bot.sendMessage(u,`📢 Announcement: ${match[1]}`)); });
bot.onText(/\/removeoldig (.+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; const username=match[1]; const index=db.stock['indo'].indexOf(username); if(index>-1){ db.stock['indo'].splice(index,1); saveDB(); bot.sendMessage(msg.chat.id,`✅ Removed ${username} from INDO stock`);} else bot.sendMessage(msg.chat.id,`❌ Username ${username} not in INDO stock`); });
bot.onText(/\/removefreshig (.+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; const username=match[1]; const index=db.stock['fresh'].indexOf(username); if(index>-1){ db.stock['fresh'].splice(index,1); saveDB(); bot.sendMessage(msg.chat.id,`✅ Removed ${username} from FRESH stock`);} else bot.sendMessage(msg.chat.id,`❌ Username ${username} not in FRESH stock`); });
bot.onText(/\/removeindoig (.+)/,(msg,match)=> { if(!isAdmin(msg.chat.id)) return; const username=match[1]; const index=db.stock['old'].indexOf(username); if(index>-1){ db.stock['old'].splice(index,1); saveDB(); bot.sendMessage(msg.chat.id,`✅ Removed ${username} from OLD stock`);} else bot.sendMessage(msg.chat.id,`❌ Username ${username} not in OLD stock`); });

// ================== USER COMMANDS ==================
bot.onText(/\/add (\d+)/, async (msg,match)=> {
  const chatId=msg.chat.id; ensureUser(chatId);
  const amount=parseInt(match[1]);
  if(amount<10) return bot.sendMessage(chatId,'❌ Minimum ₹10 required');
  const upiID=db.upi.trim();
  if(!upiID) return bot.sendMessage(chatId,'❌ UPI not set by admin');
  try{
    const tempMsg=await bot.sendMessage(chatId,'⏳ Generating QR...');
    await new Promise(res=>setTimeout(res,1500));
    await bot.deleteMessage(chatId,tempMsg.message_id);
    const upiString=`upi://pay?pa=${upiID}&pn=BotTopup&am=${amount}&cu=INR`;
    const qrDataURL=await QRCode.toDataURL(upiString,{errorCorrectionLevel:'H'});
    const base64Data=qrDataURL.replace(/^data:image\/png;base64,/,'');
    const qrBuffer=Buffer.from(base64Data,'base64');
    await bot.sendPhoto(chatId,qrBuffer,{ caption:`💳 Pay ${formatCurrency(amount)} via QR\nAfter pay: /sendapproval <UTR/TXN>` });
  } catch(err){ console.error('Add balance QR error:',err); bot.sendMessage(chatId,'❌ Failed to generate QR'); }
});

bot.onText(/\/sendapproval (.+)/,(msg,match)=> {
  const chatId=msg.chat.id; const utr=match[1]; ensureUser(chatId);
  bot.sendMessage(ADMIN_ID,`📩 Approval Request\nUser: ${chatId}\nAmount: Pending\nUTR: ${utr}`);
  bot.sendMessage(chatId,`✅ Approval request sent for UTR: ${utr}`);
});