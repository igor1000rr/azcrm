// Component: PendingSubmissionsBanner — список лидов без даты подачи.
// Покрывает: пустой случай, сворачивание, подсветку срока, ссылки на карточки.
// vi.useFakeTimers — для стабильного daysUntil() от первого контакта.

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PendingSubmissionsBanner, type PendingSubmission } from '@/app/(app)/calendar/pending-submissions-banner';

const NOW = new Date('2026-04-30T12:00:00.000Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

function make(n: number, daysAgo = 10): PendingSubmission[] {
  const ms = daysAgo * 24 * 60 * 60 * 1000;
  const contactAt = new Date(NOW.getTime() - ms).toISOString();
  return Array.from({ length: n }, (_, i) => ({
    id:             `lead-${i + 1}`,
    clientName:     `Клиент ${i + 1}`,
    funnelName:     'Karta pobytu',
    firstContactAt: contactAt,
  }));
}

describe('PendingSubmissionsBanner', () => {
  it('пустой список → ничего не рендерит (самозащита)', () => {
    const { container } = render(<PendingSubmissionsBanner items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('1 элемент → 1 ссылка, счётчик 1, нет кнопки «Показать ещё»', () => {
    render(<PendingSubmissionsBanner items={make(1)} />);
    expect(screen.getAllByTestId('pending-submission-row')).toHaveLength(1);
    expect(screen.queryByText(/Показать ещё/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Свернуть/)).not.toBeInTheDocument();
  });

  it('3 элемента → все видны, нет кнопки (ровно лимит collapsed)', () => {
    render(<PendingSubmissionsBanner items={make(3)} />);
    expect(screen.getAllByTestId('pending-submission-row')).toHaveLength(3);
    expect(screen.queryByText(/Показать ещё/)).not.toBeInTheDocument();
  });

  it('5 элементов → видны 3, кнопка «Показать ещё 2»', () => {
    render(<PendingSubmissionsBanner items={make(5)} />);
    expect(screen.getAllByTestId('pending-submission-row')).toHaveLength(3);
    expect(screen.getByText(/Показать ещё 2/)).toBeInTheDocument();
  });

  it('клик «Показать ещё» → все элементы видны, кнопка меняется на «Свернуть»', () => {
    render(<PendingSubmissionsBanner items={make(5)} />);
    fireEvent.click(screen.getByText(/Показать ещё 2/));
    expect(screen.getAllByTestId('pending-submission-row')).toHaveLength(5);
    expect(screen.getByText('Свернуть')).toBeInTheDocument();
  });

  it('счётчик в шапке равен общему количеству (не видимым)', () => {
    render(<PendingSubmissionsBanner items={make(5)} />);
    const banner = screen.getByTestId('pending-submissions-banner');
    // в шапке есть <span>5</span>
    expect(banner.textContent).toMatch(/5/);
  });

  it('элемент — это Link на /clients/{id}', () => {
    const items = make(1);
    render(<PendingSubmissionsBanner items={items} />);
    const link = screen.getByTestId('pending-submission-row') as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('/clients/lead-1');
  });

  it('elapsed > 90 дней → text-danger на вспомогательном спане', () => {
    render(<PendingSubmissionsBanner items={make(1, 100)} />);
    const elapsed = screen.getByTestId('elapsed');
    expect(elapsed).toHaveClass('text-danger');
    expect(elapsed.textContent).toMatch(/100 дней назад/);
  });

  it('elapsed 31–90 дней → text-warn', () => {
    render(<PendingSubmissionsBanner items={make(1, 60)} />);
    const elapsed = screen.getByTestId('elapsed');
    expect(elapsed).toHaveClass('text-warn');
    expect(elapsed).not.toHaveClass('text-danger');
  });

  it('elapsed ≤ 30 дней → нейтральный ink-3', () => {
    render(<PendingSubmissionsBanner items={make(1, 10)} />);
    const elapsed = screen.getByTestId('elapsed');
    expect(elapsed).toHaveClass('text-ink-3');
    expect(elapsed).not.toHaveClass('text-danger');
    expect(elapsed).not.toHaveClass('text-warn');
  });

  it('firstContactAt = null → элемент рендерится, но без блока даты/elapsed', () => {
    const items: PendingSubmission[] = [{
      id: 'l-1', clientName: 'X', funnelName: 'Y', firstContactAt: null,
    }];
    render(<PendingSubmissionsBanner items={items} />);
    expect(screen.getByText('X')).toBeInTheDocument();
    expect(screen.queryByTestId('elapsed')).not.toBeInTheDocument();
  });
});
