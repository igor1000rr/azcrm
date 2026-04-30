// Утилита для безопасной валидации тел запросов в API-роутах через zod.
//
// Зачем: webhook'и от внешних систем (OnlyOffice, WhatsApp worker, Telegram,
// браузер с push-подпиской) могут прислать произвольный JSON. Простой каст
// `await req.json() as T` не даёт runtime-гарантий — битый JSON или поля
// другого типа дадут TypeError на пустом месте. Здесь — безопасный парсинг
// с возвратом готового NextResponse 400 при невалидной структуре.

import { NextResponse } from 'next/server';
import type { ZodType, ZodError } from 'zod';

export type ParsedBody<T> =
  | { ok: true;  data: T }
  | { ok: false; response: NextResponse };

/**
 * Прочитать JSON из request и распарсить через zod-схему.
 * Возвращает либо { ok: true, data }, либо { ok: false, response: 400 }.
 *
 * Использование:
 *   const parsed = await parseBody(req, MySchema);
 *   if (!parsed.ok) return parsed.response;
 *   const body = parsed.data;
 */
export async function parseBody<T>(
  req: Request,
  schema: ZodType<T>,
): Promise<ParsedBody<T>> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: 'invalid json' }, { status: 400 }),
    };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'validation failed', issues: formatIssues(result.error) },
        { status: 400 },
      ),
    };
  }
  return { ok: true, data: result.data };
}

/** Сжатый формат ошибок zod для логов и ответа клиенту. */
function formatIssues(err: ZodError) {
  return err.issues.map((i) => ({
    path:    i.path.join('.'),
    message: i.message,
    code:    i.code,
  }));
}
