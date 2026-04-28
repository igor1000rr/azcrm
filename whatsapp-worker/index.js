// AZ Group CRM — WhatsApp Worker
//
// Отдельный Node-процесс который держит WhatsApp Web сессии через puppeteer.
// Не зависит от Next.js — общается через HTTP webhook'и.
//
// Принципы:
//   - На каждый WhatsappAccount (id) создаётся отдельный Client
//   - Сессия сохраняется через LocalAuth в STORAGE_ROOT/wa-sessions/<id>
//   - События (входящие, статусы) отправляются на CRM webhook
//   - Управление через REST API на этом же процессе
//
// ENV (читаются из основного ../.env):
//   WHATSAPP_WORKER_TOKEN — общий секрет для авторизации Next ↔ worker
//   APP_PUBLIC_URL        — адрес CRM (для webhook), напр. http://92.205.228.90
//   STORAGE_ROOT          — директория хранилища; сессии WA в STORAGE_ROOT/wa-sessions
//   WHATSAPP_WORKER_PORT  — порт worker (дефолт 3100)

import express from 'express';
import waPkg from 'whatsapp-web.js';
const { Client, LocalAuth } = waPkg;
import qrcodePkg from 'qrcode';
const qrcode = qrcodePkg;
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(process.cwd(), '..', '.env'), override: false });
dotenv.config({ override: false });

// ============ КОНФИГ ============

const PORT             = parseInt(process.env.WHATSAPP_WORKER_PORT ?? process.env.PORT ?? '3100', 10);
const AUTH_TOKEN       = process.env.WHATSAPP_WORKER_TOKEN ?? process.env.WORKER_AUTH_TOKEN ?? '';
const APP_PUBLIC_URL   = process.env.APP_PUBLIC_URL ?? process.env.AUTH_URL ?? 'http://localhost:3000';
const CRM_WEBHOOK_URL  = process.env.CRM_WEBHOOK_URL ?? `${APP_PUBLIC_URL.replace(/\/$/, '')}/api/whatsapp/webhook`;
const STORAGE_ROOT     = process.env.STORAGE_ROOT ?? path.resolve(process.cwd(), '..', 'storage');
const SESSIONS_DIR     = process.env.SESSIONS_DIR ?? path.join(STORAGE_ROOT, 'wa-sessions');
// Куда сохраняем входящие медиа. Эта папка смонтирована одним volume
// и в worker, и в CRM-app — CRM раздаёт из неё файлы по /api/files/wa-media/<filename>.
// Имена — 32-байтный hex (~256 бит энтропии), файлы приватны (auth-only).
const WA_MEDIA_DIR     = process.env.WA_MEDIA_DIR ?? path.join(STORAGE_ROOT, 'wa-media');

if (!fs.existsSync(SESSIONS_DIR)) fs.mkdirSync(SESSIONS_DIR, { recursive: true });
if (!fs.existsSync(WA_MEDIA_DIR)) fs.mkdirSync(WA_MEDIA_DIR, { recursive: true });

if (!AUTH_TOKEN) {
  console.warn('[worker] WHATSAPP_WORKER_TOKEN не задан — auth отключена');
}

console.log('[worker] config:');
console.log('  PORT            =', PORT);
console.log('  AUTH_TOKEN      =', AUTH_TOKEN ? '(set)' : '(not set)');
console.log('  CRM_WEBHOOK_URL =', CRM_WEBHOOK_URL);
console.log('  SESSIONS_DIR    =', SESSIONS_DIR);

// ============ КЛИЕНТЫ В ПАМЯТИ ============

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
      executablePath: process.env.CHROME_BIN ?? process.env.PUPPETEER_EXECUTABLE_PATH ?? undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--disable-gpu',
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
            const buf = Buffer.from(media.data, 'base64');
            mediaName = sanitizeFilename(media.filename || `media.${guessExt(media.mimetype)}`);
            mediaSize = buf.length;
            // Криптостойкое имя — 32-байтный hex (~256 бит энтропии).
            // Раньше было Date.now() + Math.random().slice(2,10) — ~36 бит энтропии,
            // URL предсказуемы и сливают фото паспортов в публичный wa-media bucket.
            const ext = path.extname(mediaName) || `.${guessExt(media.mimetype)}`;
            const storedName = `${crypto.randomBytes(32).toString('hex')}${ext}`;
            const fullPath = path.join(WA_MEDIA_DIR, storedName);
            fs.writeFileSync(fullPath, buf);
            mediaUrl = `/api/files/wa-media/${storedName}`;
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
        mediaUrl,
        mediaName,
        mediaSize,
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

function sanitizeFilename(name) {
  return String(name || 'file')
    .replace(/[\/\\\x00-\x1f]/g, '_')
    .replace(/^\.+/, '')
    .slice(0, 200) || 'file';
}

function guessExt(mimetype) {
  const m = String(mimetype || '').toLowerCase();
  if (m.includes('jpeg') || m.includes('jpg')) return 'jpg';
  if (m.includes('png'))  return 'png';
  if (m.includes('webp')) return 'webp';
  if (m.includes('gif'))  return 'gif';
  if (m.includes('pdf'))  return 'pdf';
  if (m.includes('mp4'))  return 'mp4';
  if (m.includes('ogg'))  return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  if (m.includes('wav'))  return 'wav';
  if (m.includes('msword') || m.includes('officedocument.wordprocessingml')) return 'docx';
  if (m.includes('spreadsheetml') || m.includes('ms-excel')) return 'xlsx';
  const sub = m.split('/')[1] || 'bin';
  return sub.replace(/[^a-z0-9]/g, '').slice(0, 8) || 'bin';
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

// ============ HTTP API ============

const app = express();
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  if (!AUTH_TOKEN) return next();
  if (req.path === '/health') return next();
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

    if (entry.status === 'disconnected' || entry.status === 'failed') {
      entry.status = 'initializing';
      entry.client.initialize().catch((e) => {
        console.error(`[${id}] initialize error:`, e);
        entry.status = 'failed';
      });
    }

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
  for (const [, entry] of clients) {
    try { await entry.client.destroy(); } catch {}
  }
  process.exit(0);
});
