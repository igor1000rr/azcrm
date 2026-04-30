// Component: SubmittedAtField — inline-редактор даты подачи внеска.
// Мокаем setSubmittedAt server action и useRouter, проверяем все пути:
// null → бейдж «не подан», выбор даты → commit, сброс → commit(null), error → рендер err.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useRouter } from 'next/navigation';

const mockSetSubmittedAt = vi.fn();
const mockRefresh = vi.fn();

vi.mock('@/app/(app)/clients/[id]/actions', () => ({
  setSubmittedAt: mockSetSubmittedAt,
}));

// useRouter уже мокнут в setup.ts, переопределяем реализацию чтобы подложить свой refresh.
beforeEach(() => {
  mockSetSubmittedAt.mockReset();
  mockSetSubmittedAt.mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  // Cast через unknown — vi.fn() возвращает Mock<Procedure>, а AppRouterInstance
  // ожидает строгие сигнатуры push/replace. Для тестов это безопасно: компонент
  // вызывает только refresh(), остальное никогда не дёргается.
  vi.mocked(useRouter).mockReturnValue({
    push:    vi.fn(),
    replace: vi.fn(),
    back:    vi.fn(),
    refresh: mockRefresh,
    prefetch: vi.fn(),
    forward: vi.fn(),
  } as unknown as ReturnType<typeof useRouter>);
});

// Динамический импорт ПОСЛЕ vi.mock — иначе модуль резолвится без мока.
const { SubmittedAtField } = await import('@/app/(app)/clients/[id]/submitted-at-field');

describe('SubmittedAtField', () => {
  it('initial=null → бейдж «не подан» + поле с классом border-danger/40', () => {
    render(<SubmittedAtField leadId="lead-1" initial={null} />);
    expect(screen.getByText('не подан')).toBeInTheDocument();
    const input = screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement;
    expect(input.type).toBe('date');
    expect(input.value).toBe('');
    expect(input).toHaveClass('border-danger/40');
    expect(screen.queryByText('сбросить')).not.toBeInTheDocument();
  });

  it('initial=дата → нет бейджа, есть кнопка «сбросить», выводит только яяяя-мм-дд', () => {
    render(<SubmittedAtField leadId="lead-1" initial="2026-05-15T10:30:00.000Z" />);
    expect(screen.queryByText('не подан')).not.toBeInTheDocument();
    const input = screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement;
    expect(input.value).toBe('2026-05-15');
    expect(screen.getByText('сбросить')).toBeInTheDocument();
  });

  it('выбор даты → setSubmittedAt(leadId, "yyyy-mm-dd") + router.refresh', async () => {
    render(<SubmittedAtField leadId="lead-1" initial={null} />);
    const input = screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-05-15' } });
    await waitFor(() => {
      expect(mockSetSubmittedAt).toHaveBeenCalledWith('lead-1', '2026-05-15');
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('клик «сбросить» → setSubmittedAt(leadId, null) + router.refresh', async () => {
    render(<SubmittedAtField leadId="lead-1" initial="2026-05-15T00:00:00.000Z" />);
    fireEvent.click(screen.getByText('сбросить'));
    await waitFor(() => {
      expect(mockSetSubmittedAt).toHaveBeenCalledWith('lead-1', null);
    });
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it('ошибка setSubmittedAt → рендерится role="alert" с текстом ошибки, refresh НЕ вызывается', async () => {
    mockSetSubmittedAt.mockRejectedValueOnce(new Error('Forbidden'));
    render(<SubmittedAtField leadId="lead-1" initial={null} />);
    const input = screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-05-15' } });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Forbidden');
    });
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it('пустое значение при onChange НЕ вызывает commit (браузер посылает "" при invalid input)', () => {
    render(<SubmittedAtField leadId="lead-1" initial={null} />);
    const input = screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '' } });
    expect(mockSetSubmittedAt).not.toHaveBeenCalled();
  });

  it('смена initial props (router.refresh в родителе) → useEffect обновляет value', () => {
    const { rerender } = render(<SubmittedAtField leadId="lead-1" initial={null} />);
    expect((screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement).value).toBe('');

    rerender(<SubmittedAtField leadId="lead-1" initial="2026-06-01T00:00:00.000Z" />);
    expect((screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement).value).toBe('2026-06-01');
  });

  it('во время commit — input disabled (busy state)', async () => {
    // Замедляем setSubmittedAt чтобы увидеть промежуточный disabled state
    let resolveCommit: (v: { ok: true }) => void = () => {};
    mockSetSubmittedAt.mockImplementationOnce(() => new Promise((res) => { resolveCommit = res; }));

    render(<SubmittedAtField leadId="lead-1" initial={null} />);
    const input = screen.getByLabelText('Дата подачи в уженд') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '2026-05-15' } });

    await waitFor(() => {
      expect(input).toBeDisabled();
    });

    await act(async () => { resolveCommit({ ok: true }); });
    await waitFor(() => {
      expect(input).not.toBeDisabled();
    });
  });
});
