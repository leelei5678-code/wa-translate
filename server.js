const express = require('express');
const { default: makeWASocket, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const axios = require('axios');
const app = express();
app.use(express.json());
app.use(express.urlencoded({extended:true}));

let qrData = null;
let sock = null;
let messages = []; // 存最近100条

async function translate(text, to) {
 try {
 const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${to}&dt=t&q=${encodeURIComponent(text)}`;
 const res = await axios.get(url);
 return res.data[0].map(x=>x[0]).join('');
 } catch { return text; }
}

async function start() {
 const { state, saveCreds } = await useMultiFileAuthState('auth');
 sock = makeWASocket({ auth: state });
 sock.ev.on('creds.update', saveCreds);
 sock.ev.on('connection.update', async ({connection, qr}) => {
 if(qr) qrData = await qrcode.toDataURL(qr);
 if(connection==='open') qrData = 'CONNECTED';
 });

 sock.ev.on('messages.upsert', async ({messages: msgs}) => {
 const m = msgs[0];
 if(!m.message || m.key.fromMe) return;
 const text = m.message.conversation || m.message.extendedTextMessage?.text || '';
 if(!text) return;
 const zh = await translate(text, 'zh-CN');
 messages.unshift({
 id: m.key.remoteJid,
 name: m.pushName || m.key.remoteJid,
 original: text,
 zh: zh,
 time: new Date().toLocaleString('zh-CN'),
 isMe: false
 });
 if(messages.length>100) messages.pop();
 });
}
start();

// 首页
app.get('/', (req,res) => {
 if(!qrData) return res.send('<h3>启动中...5秒后刷新</h3><script>setTimeout(()=>location.reload(),3000)</script>');
 if(qrData!=='CONNECTED'){
 return res.send(`<html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="text-align:center;padding:20px;font-family:-apple-system"><h2>WhatsApp 全自动翻译 V2</h2><p>打开 WhatsApp > 设置 > 已连接设备 > 扫码</p >< img src="${qrData}" style="width:320px"><script>setTimeout(()=>location.reload(),5000)</script></body></html>`);
 }

 // 已连接 - 显示聊天界面
 let list = messages.map((m,i)=>`
 <div style="border-bottom:1px solid #eee;padding:12px">
 <div style="font-weight:bold">${m.name}</div>
 <div style="margin:6px 0;font-size:16px">${m.zh}</div>
 <div style="color:gray;font-size:12px">原文: ${m.original}</div>
 <div style="margin-top:8px">
 <input id="reply-${i}" placeholder="在这里用中文回复..." style="width:70%;padding:8px;border:1px solid #ccc;border-radius:8px">
 <button onclick="sendReply('${m.id}', ${i})" style="padding:8px 12px;background:#25D366;color:white;border:none;border-radius:8px">发送英文</button>
 </div>
 <div style="font-size:11px;color:#aaa;margin-top:4px">${m.time} | ${m.id}</div>
 </div>
 `).join('');

 res.send(`
 <html><head><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="apple-mobile-web-app-capable" content="yes"><title>翻译版WA</title></head>
 <body style="font-family:-apple-system;margin:0">
 <div style="background:#128C7E;color:white;padding:15px;position:sticky;top:0">全自动翻译运行中 ✅ - 收到的是中文，发出去自动变英文</div>
 <div>${list || '<p style="padding:20px">暂无新消息，等待对方发消息...</p >'}</div>
 <script>
 async function sendReply(jid, idx){
 const input = document.getElementById('reply-'+idx);
 const zh = input.value;
 if(!zh) return alert('请输入中文');
 const res = await fetch('/send', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({jid, zh})});
 const data = await res.json();
 if(data.ok){ alert('已自动翻译成英文发送: '+data.en); input.value=''; } else alert('失败:'+data.error);
 }
 setTimeout(()=>location.reload(),15000);
 </script>
 </body></html>
 `);
});

// 发送接口：你发中文 -> 自动翻英文 -> 发给对方
app.post('/send', async (req,res) => {
 try {
 const {jid, zh} = req.body;
 const en = await translate(zh, 'en');
 await sock.sendMessage(jid, {text: en});
 messages.unshift({id: jid, name: jid, original: en, zh: zh, time: new Date().toLocaleString('zh-CN'), isMe: true});
 res.json({ok:true, en});
 } catch(e){
 res.json({ok:false, error: e.message});
 }
});

app.listen(process.env.PORT||3000, ()=>console.log('V2 running'));
