// Unit: src/lib/calendar-helpers — computeSubmissionStatus
// Проверяет логику «волшебной штучки» на уровне серверного маппинга:
// эта функция решает какое событие будет подсвечено красной рамкой в сетке.

import { describe, it, expect } from 'vitest';
import { computeSubmissionStatus } from '@/lib/calendar-helpers';

describe('computeSubmissionStatus', () => {
  it('lead = null → null (событие без привязки к лиду)', () => {
    expect(computeSubmissionStatus(null)).toBe(null);
  });

  it('lead = undefined → null (защита от пропущенного relation)', () => {
    expect(computeSubmissionStatus(undefined)).toBe(null);
  });

  it('lead.submittedAt = null → false (нужна подсветка)', () => {
    expect(computeSubmissionStatus({ submittedAt: null })).toBe(false);
  });

  it('lead.submittedAt = дата в прошлом → true', () => {
    expect(computeSubmissionStatus({ submittedAt: new Date('2025-01-01') })).toBe(true);
  });

  it('lead.submittedAt = дата сегодня → true', () => {
    expect(computeSubmissionStatus({ submittedAt: new Date() })).toBe(true);
  });

  it('lead.submittedAt = будущая дата → true (подано ожидающее)', () => {
    expect(computeSubmissionStatus({ submittedAt: new Date('2030-01-01') })).toBe(true);
  });

  it('lead.submittedAt = epoch (1970) → true (фактически подано, хоть и странно)', () => {
    expect(computeSubmissionStatus({ submittedAt: new Date(0) })).toBe(true);
  });
});
