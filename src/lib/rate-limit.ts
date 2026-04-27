// In-memory rate limiter — token bucket по ключу.
// Подходит для small-scale (≤50 пользователей, single-instance Next.js).
// При горизонтальном масштабировании — заменить на Redis.
//
// Использование:
//   const ok = checkRateLimit('login:user@example.com', 5, 60_000);
//   if (!ok) throw new Error('Слишком много попыток');

interface Bucket {
  count:   number;
  resetAt: number;
}

// Ограничитель размера Map чтобы память не утекала на DDoS-сценариях
const MAX_KEYS = 10_000;

const buckets = new Map<string, Bucket>();

/**
 * Проверяет и инкрементит счётчик. Возвращает true если запрос можно
 * пропустить, false если лимит превышен.
 *
 * @param key — уникальный ключ (например, 'login:email' или 'wa-send:userId')
 * @param max — максимальное количество запросов в окне
 * @param windowMs — длина окна в миллисекундах
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();

  // Периодическая чистка устаревших записей при превышении размера
  if (buckets.size >= MAX_KEYS) {
    for (const [k, b] of buckets) {
      if (b.resetAt < now) buckets.delete(k);
    }
    // Если после чистки всё ещё переполнено — отказываем (DDoS-защита)
    if (buckets.size >= MAX_KEYS) return false;
  }

  const b = buckets.get(key);
  if (!b || b.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (b.count >= max) return false;
  b.count++;
  return true;
}

/**
 * Сбросить счётчик (например, после успешного логина — обнулить попытки
 * для этого email).
 */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/**
 * Сколько попыток осталось в текущем окне (для UI/headers).
 */
export function remainingRateLimit(key: string, max: number): number {
  const b = buckets.get(key);
  if (!b || b.resetAt < Date.now()) return max;
  return Math.max(0, max - b.count);
}
