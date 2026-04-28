import { auth } from '@/lib/auth';

// Публичные пути — НЕ требуют сессии NextAuth.
// Каждый из них защищён собственным механизмом аутентификации:
//   /api/auth/*                    — сам NextAuth
//   /api/onlyoffice/callback       — JWT-токен в теле/заголовке (см. route)
//   /api/whatsapp/webhook          — Bearer WHATSAPP_WORKER_TOKEN
//   /api/telegram/webhook/[id]     — HMAC X-Telegram-Bot-Api-Secret-Token
//   /api/cron/*                    — Bearer CRON_SECRET
//   /api/files/*                   — JWT ooToken в query (для OnlyOffice)
//                                    или cookie-сессия (для UI-загрузок)
//   /api/push/vapid                — публичный VAPID-ключ для браузера
//
// Если эти пути закрыть auth-middleware — webhook'и получают 302 на /login,
// внешние сервисы (OnlyOffice, Telegram, worker) их парсят как fail.
const PUBLIC_API_PREFIXES = [
  '/api/auth',
  '/api/onlyoffice/callback',
  '/api/whatsapp/webhook',
  '/api/telegram/webhook',
  '/api/cron',
  '/api/files',
  '/api/push/vapid',
];

export default auth((req) => {
  const path = req.nextUrl.pathname;

  // Публичные API — пропускаем без проверки сессии
  if (PUBLIC_API_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    return;
  }

  const isLogin = path === '/login';

  if (!req.auth && !isLogin) {
    const url = new URL('/login', req.url);
    return Response.redirect(url);
  }
  if (req.auth && isLogin) {
    return Response.redirect(new URL('/', req.url));
  }
});

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)']
};
