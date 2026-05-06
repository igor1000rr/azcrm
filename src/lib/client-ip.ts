// Получение реального IP клиента безопасно от spoofingа.
//
// 06.05.2026 — пункт #2.14 аудита.
//
// ПРОБЛЕМА:
//   Раньше в /api/public/leads был код:
//     const xff = req.headers.get('x-forwarded-for');
//     if (xff) return xff.split(',')[0].trim();
//
//   Атакующий мог отправить POST с любым X-Forwarded-For в заголовке,
//   например "X-Forwarded-For: 1.2.3.4". Наш код безусловно брал это
//   как IP клиента. Результат — rate-limit (5 заявок/час на IP) обходился лёгко:
//   бот ротирует фейковый X-Forwarded-For, каждый IP получает своё окно лимита.
//
// РЕШЕНИЕ:
//   X-Forwarded-For формируется форматом "client, proxy1, proxy2, ...".
//   Каждый следующий proxy дописывает IP предыдущего в конец списка.
//   Атакующий контролирует только левую часть — всё что он сам посылает.
//   Наши trusted proxy (обычно nginx) добавляют в конец оригинальный IP.
//
//   Правильно: брать N-й справа, где N = TRUSTED_PROXY_HOPS (по дефолту 1).
//   Для AZ Group: nginx на VPS = 1 hop → берём последний IP в цепочке.
//   Если перед nginx поставить CloudFlare = 2 hops → второй с конца.
//
//   Атакующий может послать "X-Forwarded-For: 1.2.3.4, 5.6.7.8", но nginx
//   допишет в конец реальный source IP. Наш код берёт этот последний
//   — и spoofing не работает.

import type { NextRequest } from 'next/server';

const TRUSTED_PROXY_HOPS = Math.max(
  1,
  parseInt(process.env.TRUSTED_PROXY_HOPS ?? '1', 10) || 1,
);

/**
 * Безопасно получить IP клиента из NextRequest.
 */
export function getClientIp(req: NextRequest): string {
  return getClientIpFromHeaders(req.headers);
}

/**
 * То же самое но из Headers объекта (например из next/headers в server actions).
 *
 * 07.05.2026: вынесено в отдельный helper чтобы audit.ts мог использовать
 * ту же логику без NextRequest объекта (у него только await headers()).
 * Раньше audit.ts брал первый IP из X-Forwarded-For — уязвимо к spoofing'у.
 */
export function getClientIpFromHeaders(headers: Headers): string {
  const xff = headers.get('x-forwarded-for');
  if (xff) {
    const parts = xff.split(',').map((s) => s.trim()).filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
      return parts[idx];
    }
  }
  return headers.get('x-real-ip') ?? 'unknown';
}
