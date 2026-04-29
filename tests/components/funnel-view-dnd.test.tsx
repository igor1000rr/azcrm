// Тесты Drag-and-Drop в Kanban — handleDragStart/DragOver/Drop, optimistic
// update со сменой stage и откат при ошибке changeLeadStage.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import * as actions from '@/app/(app)/actions';
import { FunnelView } from '@/app/(app)/funnel/funnel-view';

vi.mock('@/app/(app)/actions', () => ({
  changeLeadStage: vi.fn().mockResolvedValue(undefined),
}));

const STAGES = [
  { id: 's-new',  name: 'Новый',     color: '#3B82F6', position: 1, isFinal: false, isLost: false },
  { id: 's-work', name: 'В работе',  color: '#F59E0B', position: 2, isFinal: false, isLost: false },
  { id: 's-won',  name: 'Закрыт',    color: '#10B981', position: 3, isFinal: true,  isLost: false },
];

function makeLead(over: Partial<{
  id: string; stageId: string; clientName: string; phone: string;
  city: string | null; source: string | null;
  sales: { id: string; name: string } | null;
  legal: { id: string; name: string } | null;
  totalAmount: number; paid: number; debt: number;
  docsCount: number; docsHave: number;
  fingerprintDate: string | null; updatedAt: string;
}> = {}) {
  return {
    id:           'lead-1',
    stageId:      's-new',
    clientName:   'Иванов Иван',
    phone:        '+48 731',
    city:         'Łódź',
    source:       'WhatsApp',
    sales:        null,
    legal:        null,
    totalAmount:  1000,
    paid:         0,
    debt:         1000,
    docsCount:    0,
    docsHave:     0,
    fingerprintDate: null,
    updatedAt:    '2026-04-28T22:00:00Z',
    ...over,
  };
}

const BASE_PROPS = {
  funnels: [{ id: 'f1', name: 'Karta praca', color: '#0A1A35', count: 5 }],
  currentFunnelId: 'f1',
  currentFunnelName: 'Karta praca',
  stages: STAGES,
  leads: [] as ReturnType<typeof makeLead>[],
  cities: [],
  managers: [],
  kpi: { leadsCount: 1, totalAmount: 1000, totalPaid: 0, totalDebt: 1000, conversion: 0, decisionCount: 0, debtorsCount: 1 },
  currentFilters: { city: '', mgr: '', debt: false, q: '' },
  currentUserRole: 'ADMIN' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ====================== DRAG-OVER VISUAL FEEDBACK ======================

describe('Kanban DnD — визуальная индикация dragOver', () => {
  it('по умолчанию у этапа нет border-gold', () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByTestId('stage-s-work').className).not.toContain('border-gold');
  });

  it('dragOver на этапе → border-gold + золотой фон', () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    fireEvent.dragOver(screen.getByTestId('stage-s-work'), {
      dataTransfer: { types: ['text/plain'], dropEffect: 'move' },
    });
    expect(screen.getByTestId('stage-s-work').className).toContain('border-gold');
    expect(screen.getByTestId('stage-s-work').className).toContain('bg-gold-pale');
  });

  it('dragLeave убирает подсветку', () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    const stage = screen.getByTestId('stage-s-work');
    fireEvent.dragOver(stage, { dataTransfer: { types: ['text/plain'], dropEffect: 'move' } });
    fireEvent.dragLeave(stage);
    expect(stage.className).not.toContain('border-gold');
  });
});

// ====================== HANDLE DROP — БАЗОВАЯ ЛОГИКА ======================

describe('Kanban DnD — handleDrop', () => {
  it('перетаскивание лида на новый этап → вызов changeLeadStage(leadId, newStageId)', async () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);

    await act(async () => {
      fireEvent.drop(screen.getByTestId('stage-s-work'), {
        dataTransfer: {
          getData: () => 'l1',
          types: ['text/plain'],
        },
      });
    });

    expect(actions.changeLeadStage).toHaveBeenCalledWith('l1', 's-work');
  });

  it('drop без leadId в dataTransfer → НЕ вызывает changeLeadStage', () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);

    fireEvent.drop(screen.getByTestId('stage-s-work'), {
      dataTransfer: { getData: () => '', types: ['text/plain'] },
    });
    expect(actions.changeLeadStage).not.toHaveBeenCalled();
  });

  it('drop на ТОТ ЖЕ этап (где уже находится лид) → НЕ вызывает changeLeadStage', () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);

    fireEvent.drop(screen.getByTestId('stage-s-new'), {
      dataTransfer: { getData: () => 'l1', types: ['text/plain'] },
    });
    expect(actions.changeLeadStage).not.toHaveBeenCalled();
  });

  it('drop с несуществующим leadId → НЕ вызывает changeLeadStage', () => {
    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);

    fireEvent.drop(screen.getByTestId('stage-s-work'), {
      dataTransfer: { getData: () => 'NOTFOUND', types: ['text/plain'] },
    });
    expect(actions.changeLeadStage).not.toHaveBeenCalled();
  });
});

// ====================== OPTIMISTIC UPDATE ======================

describe('Kanban DnD — optimistic update', () => {
  it('лид сразу меняет колонку (до завершения await)', async () => {
    // Делаем changeLeadStage медленным — чтобы успеть проверить что UI уже обновлён
    let resolveStage: () => void = () => {};
    vi.mocked(actions.changeLeadStage).mockImplementation(() =>
      new Promise<{ ok: true }>((res) => { resolveStage = () => res({ ok: true }); }),
    );

    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);

    // Лид изначально в s-new
    expect(screen.getByTestId('stage-s-new')).toContainElement(screen.getByTestId('lead-card-l1'));

    // Перетаскиваем в s-work (НЕ await — нам важно проверить состояние ДО завершения)
    fireEvent.drop(screen.getByTestId('stage-s-work'), {
      dataTransfer: { getData: () => 'l1', types: ['text/plain'] },
    });

    // Карточка УЖЕ должна быть в s-work
    await waitFor(() => {
      expect(screen.getByTestId('stage-s-work')).toContainElement(screen.getByTestId('lead-card-l1'));
    });

    // Завершаем changeLeadStage
    resolveStage();
  });
});

// ====================== ROLLBACK ПРИ ОШИБКЕ ======================

describe('Kanban DnD — откат при ошибке changeLeadStage', () => {
  it('changeLeadStage отбрасывает → лид возвращается на исходный этап', async () => {
    vi.mocked(actions.changeLeadStage).mockRejectedValueOnce(new Error('Запрещено'));
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const errMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    const leads = [makeLead({ id: 'l1', stageId: 's-new' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);

    await act(async () => {
      fireEvent.drop(screen.getByTestId('stage-s-work'), {
        dataTransfer: { getData: () => 'l1', types: ['text/plain'] },
      });
    });

    // После отброса — карточка снова в s-new
    expect(screen.getByTestId('stage-s-new')).toContainElement(screen.getByTestId('lead-card-l1'));
    expect(alertMock).toHaveBeenCalledWith('Не удалось изменить этап');

    alertMock.mockRestore();
    errMock.mockRestore();
  });
});
