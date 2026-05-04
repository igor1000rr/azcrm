// Подпись короткоживущих токенов для скачивания media-файлов внешним
// процессом (WhatsApp worker без auth-сессии).
//
// Архитектура. CRM хранит файлы в /storage/{bucket}/<id>.<ext>, отдаёт через
// /api/files/<bucket>/<path>. Endpoint требует session auth — у worker'а
// (отдельный Node.js процесс с puppeteer-WhatsApp-Web) сессии нет, поэтому
// мы выдаём ему абсолютный URL с токеном на одну отправку:
//
//   https://crm.example.com/api/files/uploads/xx/yy/abc.png?mediaToken=<jwt>
//
// Worker делает fetch без auth, /api/files принимает токен (см. route.ts).
//
// Время жизни 5 минут — токена хватит чтобы worker скачал файл и отправил
// в WhatsApp; после этого токен бесполезен (файл уже у получателя).
//
// Anna 04.05.2026: «картинка не отправляется адекватно» — клиент в WhatsApp
// получал пустое сообщение потому что worker не мог скачать файл без auth.

import { signFileAccessToken } from '@/lib/onlyoffice';

const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? '';

/** Превращает относительный `/api/files/.../abc.png` в абсолютный URL с
 *  mediaToken для WhatsApp worker'а.
 *
 *  Если URL уже абсолютный (http/https) — возвращает как есть, без токена.
 *  Это безопасно: либо это external CDN url, либо это уже наш URL с токеном
 *  из верхнего слоя (двойную подпись делать не нужно).
 *
 *  Бросает Error если APP_PUBLIC_URL не задан — без него worker не сможет
 *  скачать файл, отложенная ошибка приведёт к отправке пустого сообщения
 *  в WhatsApp. Лучше упасть громко на /api/messages/lead-send → юзер увидит
 *  alert и поймёт что не настроено. */
export function signMediaUrlForWorker(relativePath: string, ttlSec = 300): string {
  if (relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath;
  }
  if (!APP_PUBLIC_URL) {
    throw new Error(
      'APP_PUBLIC_URL не задан в .env — WhatsApp worker не сможет скачать media. ' +
      'Добавь APP_PUBLIC_URL=https://crm.azgroupcompany.net в окружение.',
    );
  }
  if (!relativePath.startsWith('/')) {
    return relativePath; // не наш формат — не подписываем
  }
  const token = signFileAccessToken(relativePath, ttlSec);
  const sep   = relativePath.includes('?') ? '&' : '?';
  return `${APP_PUBLIC_URL.replace(/\/$/, '')}${relativePath}${sep}mediaToken=${encodeURIComponent(token)}`;
}
