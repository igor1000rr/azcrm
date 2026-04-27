// Юнит-тесты src/lib/rate-limit.ts — in-memory token bucket.
// Критичный модуль безопасности: защищает login (brute-force) и WhatsApp send (spam).
//
// state в модуле глобальный, между тестами используем уникальные ключи чтобы не хлопотать
// с resetModules на каждый it.
import { describe, it, expect } from 'vitest';
import { checkRateLimit, resetRateLimit, remainingRateLimit } from '@/lib/rate-limit';

describe('checkRateLimit', () => {
  it('первый запрос всегда проходит', () => {
    expect(checkRateLimit('rl-test:first', 5, 60_000)).toBe(true);
  });

  it('в пределах лимита — все true, после превышения — false', () => {
    const key = 'rl-test:burst';
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);  // 1
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);  // 2
    expect(checkRateLimit(key, 3, 60_000)).toBe(true);  // 3
    expect(checkRateLimit(key, 3, 60_000)).toBe(false); // 4-й отбивается
    expect(checkRateLimit(key, 3, 60_000)).toBe(false); // 5-й тоже
  });

  it('разные ключи — независимые счётчики', () => {
    expect(checkRateLimit('rl-test:userA', 1, 60_000)).toBe(true);
    expect(checkRateLimit('rl-test:userA', 1, 60_000)).toBe(false);
    // Другой ключ — свой счётчик
    expect(checkRateLimit('rl-test:userB', 1, 60_000)).toBe(true);
  });

  it('по истечении окна счётчик обнуляется', async () => {
    const key = 'rl-test:expiry';
    // Срабатываем с окном 50мс
    expect(checkRateLimit(key, 2, 50)).toBe(true);
    expect(checkRateLimit(key, 2, 50)).toBe(true);
    expect(checkRateLimit(key, 2, 50)).toBe(false);
    // Ждём истечения
    await new Promise((r) => setTimeout(r, 70));
    // Счётчик должен сброситься
    expect(checkRateLimit(key, 2, 50)).toBe(true);
  });
});

describe('resetRateLimit', () => {
  it('явный сброс обнуляет счётчик до истечения окна (нужно после успешного логина)', () => {
    const key = 'rl-test:reset';
    expect(checkRateLimit(key, 1, 60_000)).toBe(true);
    expect(checkRateLimit(key, 1, 60_000)).toBe(false); // исчерпали
    resetRateLimit(key);
    expect(checkRateLimit(key, 1, 60_000)).toBe(true);  // снова проходит
  });
});

describe('remainingRateLimit', () => {
  it('без вызовов — полный лимит', () => {
    expect(remainingRateLimit('rl-test:fresh', 10)).toBe(10);
  });

  it('после вызовов — уменьшается', () => {
    const key = 'rl-test:remaining';
    checkRateLimit(key, 5, 60_000);
    checkRateLimit(key, 5, 60_000);
    expect(remainingRateLimit(key, 5)).toBe(3);
  });

  it('исчерпано — возвращает 0', () => {
    const key = 'rl-test:exhausted';
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000);
    checkRateLimit(key, 2, 60_000); // уже перебор
    expect(remainingRateLimit(key, 2)).toBe(0);
  });
});

describe('login сценарий', () => {
  it('10 попыток проходят, 11-я отбивается', () => {
    const key = 'rl-test:login:brute';
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(key, 10, 15 * 60_000)).toBe(true);
    }
    expect(checkRateLimit(key, 10, 15 * 60_000)).toBe(false);
  });

  it('успешный логин сбрасывает счётчик — опечатки не локают бесконечно', () => {
    const key = 'rl-test:login:typo';
    // 5 вводов с опечатками
    for (let i = 0; i < 5; i++) checkRateLimit(key, 10, 15 * 60_000);
    // Успех — сброс
    resetRateLimit(key);
    // Снова можно все 10
    for (let i = 0; i < 10; i++) {
      expect(checkRateLimit(key, 10, 15 * 60_000)).toBe(true);
    }
  });
});
