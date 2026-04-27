// AZ Group CRM — WhatsApp Worker
//
// Отдельный Node-процесс который держит WhatsApp Web сессии через puppeteer.
// Не зависит от Next.js — общается через HTTP webhook'и.

import express from 'express';
import { Client, LocalAuth } from 'whatsapp-web.js';
import qrcode from 'qrcode';
import fs from 'node:fs';
import path from 'node:path';

const PORT             = parseInt(process.env.PORT ?? '3100', 10);
const AUTH_TOKEN       = process.env.WORKER_AUTH_TOKEN ?? '';
const CRM_WEBHOOK_URL  = process.env.CRM_WEBHOOK_URL ?? 'http://localhost:3000/api/whatsapp/webhook';
const SESSIONS_DIR     = process.env.SESSIONS_DIR ?? path.join(process.cwd(), '..', 'storage', 'wa-sessions');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });

/** @type {Map<string, { client: Client; status: string; phoneNumber?: string; qr?: string; lastQrAt?: number }>} */
const clients = new Map();

function getOrCreateClient(accountId) {
  let entry = clients.get(accountId);
  if (entry) return entry;

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: accountId,
      dataPath: SESSIONS_DIR,
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox', '--disable-setuid-sandbox',
        '--disable-dev-shm-usage', '--disable-accelerated-2d-canvas',
        '--no-first-run', '--no-zygote', '--disable-gpu',
      ],
    },
  });

  entry = { client, status: 'disconnected' };
  clients.set(accountId, entry);

  bindEvents(accountId, client, entry);
  return entry;
}

function bindEvents(accountId, client, entry) {
  client.on('qr', async (qr) => {
    try {
      const dataUrl = await qrcode.toDataURL(qr, { width: 280, margin: 1 });
      entry.qr = dataUrl;
      entry.lastQrAt = Date.now();
      entry.status = 'qr';
      console.log(`[${accountId}] QR generated`);
      sendWebhook({ kind: 'connection', accountId, status: 'qr' });
    } catch (e) {
      console.error(`[${accountId}] QR error:`, e);
    }
  });

  client.on('authenticated', () => {
    console.log(`[${accountId}] authenticated`);
    entry.status = 'authenticating';
    sendWebhook({ kind: 'connection', accountId, status: 'authenticating' });
  });

  client.on('ready', async () => {
    console.log(`[${accountId}] READY`);
    entry.status = 'ready';
    entry.qr = undefined;
    try {
      const info = client.info;
      entry.phoneNumber = info?.wid?._serialized?.split('@')[0];
    } catch {}
    sendWebhook({
      kind: 'connection', accountId, status: 'ready',
      phoneNumber: entry.phoneNumber,
    });
  });

  client.on('auth_failure', (msg) => {
    console.error(`[${accountId}] auth failure:`, msg);
    entry.status = 'failed';
    sendWebhook({ kind: 'connection', accountId, status: 'failed' });
  });

  client.on('disconnected', (reason) => {
    console.log(`[${accountId}] disconnected:`, reason);
    entry.status = 'disconnected';
    entry.phoneNumber = undefined;
    sendWebhook({ kind: 'connection', accountId, status: 'disconnected' });
  });

  client.on('message', async (msg) => {
    try {
      if (msg.from === 'status@broadcast') return;
      if (msg.from.endsWith('@g.us')) return;

      const fromPhone = msg.from.split('@')[0];
      const contact = await msg.getContact().catch(() => null);

      let mediaUrl, mediaName, mediaSize;
      if (msg.hasMedia) {
        try {
          const media = await msg.downloadMedia();
          if (media) {
            mediaName = media.filename || `media.${media.mimetype?.split('/')[1] || 'bin'}`;
            mediaSize = Buffer.from(media.data, 'base64').length;
          }
        } catch (e) {
          console.error('downloadMedia error:', e);
        }
      }

      sendWebhook({
        kind:       'message.in',
        accountId,
        externalId: msg.id._serialized,
        fromPhone:  '+' + fromPhone,
        fromName:   contact?.pushname || contact?.name || undefined,
        type:       mapMessageType(msg.type),
        body:       msg.body || undefined,
        mediaUrl, mediaName, mediaSize,
        timestamp:  msg.timestamp * 1000,
      });
    } catch (e) {
      console.error(`[${accountId}] message handler error:`, e);
    }
  });

  client.on('message_ack', (msg, ack) => {
    let status;
    if (ack === 1) status = 'sent';
    else if (ack === 2) status = 'delivered';
    else if (ack === 3 || ack === 4) status = 'read';
    else if (ack === -1) status = 'failed';
    else return;

    sendWebhook({
      kind:       'message.status',
      accountId,
      externalId: msg.id._serialized,
      status,
    });
  });
}

function mapMessageType(waType) {
  if (waType === 'chat') return 'text';
  if (waType === 'image') return 'image';
  if (waType === 'document') return 'document';
  if (waType === 'video') return 'video';
  if (waType === 'ptt' || waType === 'audio') return 'audio';
  if (waType === 'location') return 'location';
  if (waType === 'vcard') return 'contact';
  return 'text';
}

async function sendWebhook(payload) {
  try {
    await fetch(CRM_WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${AUTH_TOKEN}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.error('webhook error:', e.message);
  }
}

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  const auth = req.headers.authorization ?? '';
  if (auth !== `Bearer ${AUTH_TOKEN}`) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  next();
});

app.get('/health', (_, res) => res.json({ ok: true, accounts: clients.size }));

app.post('/accounts/:id/connect', async (req, res) => {
  try {
    const id = req.params.id;
    const entry = getOrCreateClient(id);

    if (entry.status === 'ready') {
      return res.json({ status: 'ready', phoneNumber: entry.phoneNumber });
    }

    if (entry.status === 'qr' && entry.qr) {
      return res.json({ status: 'qr', qr: entry.qr });
    }

    entry.client.initialize().catch((e) => {
      console.error(`[${id}] initialize error:`, e);
      entry.status = 'failed';
    });

    const start = Date.now();
    while (Date.now() - start < 30000) {
      await new Promise((r) => setTimeout(r, 500));
      if (entry.status === 'ready') {
        return res.json({ status: 'ready', phoneNumber: entry.phoneNumber });
      }
      if (entry.status === 'qr' && entry.qr) {
        return res.json({ status: 'qr', qr: entry.qr });
      }
      if (entry.status === 'failed') {
        return res.json({ status: 'failed', error: 'инициализация не удалась' });
      }
    }

    return res.json({ status: entry.status, qr: entry.qr });
  } catch (e) {
    console.error('connect error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.post('/accounts/:id/disconnect', async (req, res) => {
  try {
    const id = req.params.id;
    const entry = clients.get(id);
    if (!entry) return res.json({ ok: true });

    try { await entry.client.logout(); } catch {}
    try { await entry.client.destroy(); } catch {}
    clients.delete(id);

    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/accounts/:id/status', (req, res) => {
  const entry = clients.get(req.params.id);
  if (!entry) return res.json({ status: 'disconnected' });
  res.json({
    status:      entry.status,
    phoneNumber: entry.phoneNumber,
    qr:          entry.qr,
  });
});

app.post('/accounts/:id/send', async (req, res) => {
  try {
    const id = req.params.id;
    const entry = clients.get(id);
    if (!entry || entry.status !== 'ready') {
      return res.status(400).json({ ok: false, error: 'WhatsApp не подключён' });
    }

    const { to, body } = req.body;
    if (!to || !body) {
      return res.status(400).json({ ok: false, error: 'to and body required' });
    }

    const cleanPhone = to.replace(/[^\d]/g, '');
    const chatId = `${cleanPhone}@c.us`;

    const msg = await entry.client.sendMessage(chatId, body);

    res.json({ ok: true, messageId: msg.id._serialized });
  } catch (e) {
    console.error('send error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`whatsapp-worker listening on :${PORT}`);
  console.log(`webhook URL: ${CRM_WEBHOOK_URL}`);
});

process.on('SIGTERM', async () => {
  console.log('shutting down...');
  for (const [id, entry] of clients) {
    try { await entry.client.destroy(); } catch {}
  }
  process.exit(0);
});
