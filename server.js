import express from 'express';
import http from 'node:http';
import WebSocket, { WebSocketServer } from 'ws';
import { TikTokLiveConnection, WebcastEvent } from 'tiktok-live-connector';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/events' });
app.use(express.json({ limit: '20kb' }));
app.use(express.static('public'));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'Guerra dos Presentes LIVE' }));

let connection = null;
let activeUsername = '';
let status = 'disconnected';
function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of wss.clients) if (client.readyState === WebSocket.OPEN) client.send(msg);
}
function unitForGift(gift) {
  const diamonds = Number(gift?.gift?.diamondCount || gift?.extendedGiftInfo?.diamondCount || 0);
  if (diamonds >= 30) return 'plane';
  if (diamonds >= 5) return 'tank';
  if (diamonds >= 1) return 'soldier';
  return null;
}

app.post('/api/connect', async (req, res) => {
  const username = String(req.body?.username || '').trim().replace(/^@/, '');
  if (!/^[A-Za-z0-9._]{2,24}$/.test(username)) return res.status(400).json({ error: 'Nome de usuário inválido.' });
  try {
    if (connection) { try { await connection.disconnect(); } catch (_) {} connection = null; }
    activeUsername = username;
    status = 'connecting';
    connection = new TikTokLiveConnection(username, { enableExtendedGiftInfo: true });
    connection.on(WebcastEvent.GIFT, (data) => {
      // Presentes em sequência só são processados quando a sequência termina.
      if (!data.gift) return;
      if (data.gift.type === 1 && data.repeatEnd !== 1) return;
      const unit = unitForGift(data);
      if (!unit) return;
      const giftName = data.gift.name || data.extendedGiftInfo?.name || 'Presente';
      const nickname = data.user?.nickname || data.user?.displayId || 'Visitante';
      const count = Math.max(1, Math.min(10, Number(data.repeatCount || 1)));
      for (let i = 0; i < count; i++) broadcast({ type: 'gift', giftName, nickname, unit });
    });
    connection.on('disconnected', () => { status = 'disconnected'; broadcast({ type: 'status', status }); });
    await connection.connect();
    status = 'connected';
    broadcast({ type: 'status', status, username: activeUsername });
    res.json({ ok: true, username, status });
  } catch (err) {
    status = 'error';
    const message = String(err?.message || 'Não foi possível conectar à LIVE').slice(0, 240);
    broadcast({ type: 'status', status, error: message });
    res.status(502).json({ error: message });
  }
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => console.log(`Guerra dos Presentes LIVE na porta ${port}`));
