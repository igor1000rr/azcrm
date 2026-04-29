// Component: StayUntilDisplay — подсветка «Действует до» по сроку.
// Pure-компонент без router/state — тестируем вывод для всех диапазонов.
// Фиксируем системное время, иначе daysUntil() плывёт от прогона к прогону.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StayUntilDisplay } from '@/app/(app)/clients/[id]/stay-until-display';

const NOW = new Date('2026-04-30T12:00:00.000Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

// vi доступен глобально в vitest, но импорт для явности:
import { vi } from 'vitest';

describe('StayUntilDisplay', () => {
  it('until=null → ничего не рендерит', () => {
    const { container } = render(<StayUntilDisplay until={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('until=сегодня (00:00 UTC) → "(сегодня)" с danger', () => {
    const { container } = render(<StayUntilDisplay until="2026-04-30T00:00:00.000Z" />);
    expect(container.textContent).toContain('(сегодня)');
    expect(container.querySelector('.text-danger')).toBeTruthy();
  });

  it('until в прошлом → "истёк N дней назад" с line-through', () => {
    // 5 дней назад (2026-04-25)
    const { container } = render(<StayUntilDisplay until="2026-04-25T12:00:00.000Z" />);
    expect(container.textContent).toMatch(/истёк 5 дней назад/);
    expect(container.querySelector('.line-through')).toBeTruthy();
    expect(container.querySelector('.text-danger')).toBeTruthy();
  });

  it('until в прошлом, 1 день → склонение "день"', () => {
    const { container } = render(<StayUntilDisplay until="2026-04-29T12:00:00.000Z" />);
    expect(container.textContent).toMatch(/истёк 1 день назад/);
  });

  it('until через 5 дней → warn «через 5 дней»', () => {
    const { container } = render(<StayUntilDisplay until="2026-05-05T12:00:00.000Z" />);
    expect(container.textContent).toMatch(/через 5 дней/);
    expect(container.querySelector('.text-warn')).toBeTruthy();
  });

  it('until через 30 дней → всё ещё warn (включительно)', () => {
    const { container } = render(<StayUntilDisplay until="2026-05-30T12:00:00.000Z" />);
    expect(container.querySelector('.text-warn')).toBeTruthy();
    expect(container.querySelector('.text-info')).toBeFalsy();
  });

  it('until через 50 дней → info (31–90 дней)', () => {
    const { container } = render(<StayUntilDisplay until="2026-06-19T12:00:00.000Z" />);
    expect(container.textContent).toMatch(/через 50/);
    expect(container.querySelector('.text-info')).toBeTruthy();
    expect(container.querySelector('.text-warn')).toBeFalsy();
  });

  it('until через 200 дней → плейн вид (без warn/info/danger)', () => {
    const { container } = render(<StayUntilDisplay until="2026-11-16T12:00:00.000Z" />);
    // Должна быть только дата, без "через N дней"
    expect(container.textContent).not.toMatch(/через/);
    expect(container.querySelector('.text-warn')).toBeFalsy();
    expect(container.querySelector('.text-info')).toBeFalsy();
    expect(container.querySelector('.text-danger')).toBeFalsy();
  });

  it('until = невалидная строка → не падает (formatDate вернёт тире)', () => {
    const { container } = render(<StayUntilDisplay until="not-a-date" />);
    // daysUntil("not-a-date") = null → возвращается просто dateStr
    expect(container.textContent).toBe('—');
  });
});
