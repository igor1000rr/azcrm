// Тесты компонента FunnelView (UI воронки).
// Покрывает: funnel switcher, KPI блок, тулбар (поиск, фильтры, debt toggle,
// view mode kanban/list, экспорт), Kanban-рендер, LeadCard состояния,
// list view, plural() helper.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { FunnelView, plural } from '@/app/(app)/funnel/funnel-view';

vi.mock('@/app/(app)/actions', () => ({
  changeLeadStage: vi.fn().mockResolvedValue(undefined),
}));

const FUNNELS = [
  { id: 'f1', name: 'Karta praca', color: '#0A1A35', count: 12 },
  { id: 'f2', name: 'Karta pobytu', color: '#FFD700', count: 8 },
];

const STAGES = [
  { id: 's-new',  name: 'Новый',     color: '#3B82F6', position: 1, isFinal: false, isLost: false },
  { id: 's-work', name: 'В работе',  color: '#F59E0B', position: 2, isFinal: false, isLost: false },
  { id: 's-won',  name: 'Закрыт',    color: '#10B981', position: 3, isFinal: true,  isLost: false },
  { id: 's-lost', name: 'Слит',      color: '#EF4444', position: 4, isFinal: true,  isLost: true  },
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
    phone:        '+48 731 006 935',
    city:         'Łódź',
    source:       'WhatsApp',
    sales:        { id: 'u1', name: 'Anna' },
    legal:        null,
    totalAmount:  1000,
    paid:         500,
    debt:         500,
    docsCount:    5,
    docsHave:     3,
    fingerprintDate: null,
    updatedAt:    '2026-04-28T22:00:00Z',
    ...over,
  };
}

const BASE_PROPS = {
  funnels: FUNNELS,
  currentFunnelId: 'f1',
  currentFunnelName: 'Karta praca',
  stages: STAGES,
  leads: [] as ReturnType<typeof makeLead>[],
  cities: [{ id: 'c1', name: 'Łódź' }, { id: 'c2', name: 'Warszawa' }],
  managers: [{ id: 'u1', name: 'Anna', role: 'SALES' as const }],
  kpi: {
    leadsCount: 12, totalAmount: 50000, totalPaid: 30000, totalDebt: 20000,
    conversion: 25, decisionCount: 3, debtorsCount: 5,
  },
  currentFilters: { city: '', mgr: '', debt: false, q: '' },
  currentUserRole: 'ADMIN' as const,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ====================== FUNNEL SWITCHER ======================

describe('FunnelView — funnel switcher', () => {
  it('рендерит все воронки с их именами и счётчиками', () => {
    render(<FunnelView {...BASE_PROPS} />);
    // 'Karta praca' встречается дважды: в switcher и в заголовке currentFunnelName
    expect(screen.getAllByText('Karta praca').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Karta pobytu')).toBeInTheDocument();
    // Счётчик внутри кнопки воронки
    const f1Btn = screen.getByTestId('funnel-btn-f1');
    expect(f1Btn.textContent).toContain('12');
    const f2Btn = screen.getByTestId('funnel-btn-f2');
    expect(f2Btn.textContent).toContain('8');
  });

  it('активная воронка имеет navy фон и белый текст', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const activeBtn = screen.getByTestId('funnel-btn-f1');
    expect(activeBtn.className).toContain('bg-navy');
    expect(activeBtn.className).toContain('text-white');
  });

  it('неактивная воронка серая (text-ink-3)', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const inactiveBtn = screen.getByTestId('funnel-btn-f2');
    expect(inactiveBtn.className).toContain('text-ink-3');
  });

  it('активная воронка имеет золотой счётчик (бейдж)', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const activeBtn = screen.getByTestId('funnel-btn-f1');
    const badge = activeBtn.querySelector('span:nth-child(2)');
    expect(badge?.className).toContain('bg-gold');
  });

  it('клик по другой воронке вызывает router.push', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } as unknown as ReturnType<typeof useRouter>);
    render(<FunnelView {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('funnel-btn-f2'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('funnel=f2'));
  });
});

// ====================== KPI BLOCK ======================

describe('FunnelView — KPI блок', () => {
  it('рендерит все 5 KPI ячеек', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByTestId('kpi-Всего лидов')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-Стоимость')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-Получено')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-Долг')).toBeInTheDocument();
    expect(screen.getByTestId('kpi-Конверсия')).toBeInTheDocument();
  });

  it('значения KPI отображаются правильно', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByTestId('kpi-Всего лидов')).toHaveTextContent('12');
    expect(screen.getByTestId('kpi-Конверсия')).toHaveTextContent('25');
  });

  it('KPI «Долг» подсвечен красным когда есть долг', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const cell = screen.getByTestId('kpi-Долг');
    const valueDiv = cell.querySelector('.font-mono');
    expect(valueDiv?.className).toContain('text-danger');
  });

  it('KPI «Получено» зелёное когда есть оплаты', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const cell = screen.getByTestId('kpi-Получено');
    const valueDiv = cell.querySelector('.font-mono');
    expect(valueDiv?.className).toContain('text-success');
  });

  it('KPI без highlight (Всего лидов) — navy', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const cell = screen.getByTestId('kpi-Всего лидов');
    const valueDiv = cell.querySelector('.font-mono');
    expect(valueDiv?.className).toContain('text-navy');
  });

  it('конверсия 0 не падает (защита от деления на 0)', () => {
    const props = {
      ...BASE_PROPS,
      kpi: { ...BASE_PROPS.kpi, leadsCount: 0, totalAmount: 0, totalPaid: 0, totalDebt: 0, conversion: 0, decisionCount: 0, debtorsCount: 0 },
    };
    expect(() => render(<FunnelView {...props} />)).not.toThrow();
  });

  it('foot подпись «X закрыто» соответствует decisionCount', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByText('3 закрыто')).toBeInTheDocument();
  });
});

// ====================== ТУЛБАР: ПОИСК + ФИЛЬТРЫ ======================

describe('FunnelView — тулбар: поиск и фильтры', () => {
  it('рендерит инпут поиска с placeholder', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByPlaceholderText('Поиск по имени, телефону...')).toBeInTheDocument();
  });

  it('поиск изначально содержит значение из currentFilters.q', () => {
    const props = { ...BASE_PROPS, currentFilters: { ...BASE_PROPS.currentFilters, q: 'Иванов' } };
    render(<FunnelView {...props} />);
    expect(screen.getByPlaceholderText('Поиск по имени, телефону...')).toHaveValue('Иванов');
  });

  it('submit формы поиска вызывает router.push с q', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } as unknown as ReturnType<typeof useRouter>);
    render(<FunnelView {...BASE_PROPS} />);
    const input = screen.getByPlaceholderText('Поиск по имени, телефону...');
    fireEvent.change(input, { target: { value: '731006' } });
    fireEvent.submit(screen.getByTestId('search-form'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('q=731006'));
  });

  it('select городов рендерится со всеми городами', () => {
    render(<FunnelView {...BASE_PROPS} />);
    const select = screen.getByTestId('city-filter');
    expect(select.querySelectorAll('option')).toHaveLength(3);
  });

  it('select городов не рендерится если cities пустой', () => {
    render(<FunnelView {...BASE_PROPS} cities={[]} />);
    expect(screen.queryByTestId('city-filter')).not.toBeInTheDocument();
  });

  it('select менеджеров не рендерится если managers пустой', () => {
    render(<FunnelView {...BASE_PROPS} managers={[]} />);
    expect(screen.queryByTestId('mgr-filter')).not.toBeInTheDocument();
  });

  it('переключение city select вызывает router.push с city', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } as unknown as ReturnType<typeof useRouter>);
    render(<FunnelView {...BASE_PROPS} />);
    fireEvent.change(screen.getByTestId('city-filter'), { target: { value: 'c1' } });
    expect(push).toHaveBeenCalledWith(expect.stringContaining('city=c1'));
  });

  it('debt-toggle: серый когда выкл, navy когда вкл', () => {
    const { rerender } = render(<FunnelView {...BASE_PROPS} />);
    let toggle = screen.getByTestId('debt-toggle');
    expect(toggle.className).toContain('bg-paper');

    rerender(<FunnelView {...BASE_PROPS} currentFilters={{ ...BASE_PROPS.currentFilters, debt: true }} />);
    toggle = screen.getByTestId('debt-toggle');
    expect(toggle.className).toContain('bg-navy');
    expect(toggle.className).toContain('text-white');
  });

  it('клик по debt-toggle когда выкл → push с debt=1', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } as unknown as ReturnType<typeof useRouter>);
    render(<FunnelView {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('debt-toggle'));
    expect(push).toHaveBeenCalledWith(expect.stringContaining('debt=1'));
  });

  it('клик по debt-toggle когда вкл → удаляет debt из URL', () => {
    const push = vi.fn();
    vi.mocked(useRouter).mockReturnValue({ push, replace: vi.fn(), back: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() } as unknown as ReturnType<typeof useRouter>);
    render(<FunnelView {...BASE_PROPS} currentFilters={{ ...BASE_PROPS.currentFilters, debt: true }} />);
    fireEvent.click(screen.getByTestId('debt-toggle'));
    const calledWith = push.mock.calls[0][0];
    expect(calledWith).not.toContain('debt=');
  });
});

// ====================== ЭКСПОРТ — ВИДИМОСТЬ ПО РОЛЯМ ======================

describe('FunnelView — экспорт по ролям', () => {
  it('ADMIN видит кнопку Экспорт', () => {
    render(<FunnelView {...BASE_PROPS} currentUserRole="ADMIN" />);
    expect(screen.getByTestId('export-link')).toBeInTheDocument();
    expect(screen.getByText('Экспорт')).toBeInTheDocument();
  });

  it('SALES не видит кнопку Экспорт', () => {
    render(<FunnelView {...BASE_PROPS} currentUserRole="SALES" />);
    expect(screen.queryByTestId('export-link')).not.toBeInTheDocument();
  });

  it('LEGAL не видит кнопку Экспорт', () => {
    render(<FunnelView {...BASE_PROPS} currentUserRole="LEGAL" />);
    expect(screen.queryByTestId('export-link')).not.toBeInTheDocument();
  });

  it('Экспорт ссылка содержит funnel id', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByTestId('export-link').getAttribute('href')).toContain('funnel=f1');
  });

  it('Экспорт ссылка содержит city когда фильтр активен', () => {
    render(<FunnelView {...BASE_PROPS} currentFilters={{ ...BASE_PROPS.currentFilters, city: 'c1' }} />);
    expect(screen.getByTestId('export-link').getAttribute('href')).toContain('city=c1');
  });
});

// ====================== VIEW MODE: KANBAN / LIST ======================

describe('FunnelView — переключение Kanban/List', () => {
  it('по дефолту kanban view виден', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByTestId('kanban-view')).toBeInTheDocument();
    expect(screen.queryByTestId('list-view')).not.toBeInTheDocument();
  });

  it('клик «Список» переключает на list view', () => {
    render(<FunnelView {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('view-list'));
    expect(screen.getByTestId('list-view')).toBeInTheDocument();
    expect(screen.queryByTestId('kanban-view')).not.toBeInTheDocument();
  });

  it('клик «Канбан» возвращает kanban', () => {
    render(<FunnelView {...BASE_PROPS} />);
    fireEvent.click(screen.getByTestId('view-list'));
    fireEvent.click(screen.getByTestId('view-kanban'));
    expect(screen.getByTestId('kanban-view')).toBeInTheDocument();
  });

  it('активная кнопка view имеет navy фон', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getByTestId('view-kanban').className).toContain('bg-navy');
  });
});

// ====================== KANBAN: ЭТАПЫ И ЛИДЫ ======================

describe('FunnelView — Kanban: этапы и лиды', () => {
  it('рендерит все этапы воронки', () => {
    render(<FunnelView {...BASE_PROPS} />);
    STAGES.forEach((s) => {
      expect(screen.getByTestId(`stage-${s.id}`)).toBeInTheDocument();
    });
  });

  it('пустой этап показывает плейсхолдер «Перетащите лида сюда»', () => {
    render(<FunnelView {...BASE_PROPS} />);
    expect(screen.getAllByText('Перетащите лида сюда')).toHaveLength(STAGES.length);
  });

  it('лиды распределены по этапам по stageId', () => {
    const leads = [
      makeLead({ id: 'l1', stageId: 's-new', clientName: 'Иван' }),
      makeLead({ id: 'l2', stageId: 's-work', clientName: 'Пётр' }),
      makeLead({ id: 'l3', stageId: 's-new', clientName: 'Анна' }),
    ];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByTestId('stage-s-new')).toContainElement(screen.getByTestId('lead-card-l1'));
    expect(screen.getByTestId('stage-s-new')).toContainElement(screen.getByTestId('lead-card-l3'));
    expect(screen.getByTestId('stage-s-work')).toContainElement(screen.getByTestId('lead-card-l2'));
  });
});

// ====================== LEAD CARD: СОСТОЯНИЯ ======================

describe('FunnelView — LeadCard состояния', () => {
  it('рендерит имя клиента и источник', () => {
    const leads = [makeLead({ id: 'l1', clientName: 'Иванов Иван', city: 'Łódź', source: 'WhatsApp' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByText('Иванов Иван')).toBeInTheDocument();
    expect(screen.getByText('Łódź · WhatsApp')).toBeInTheDocument();
  });

  it('лид без города и источника — «Без источника»', () => {
    const leads = [makeLead({ id: 'l1', city: null, source: null })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByText('Без источника')).toBeInTheDocument();
  });

  it('лид с долгом → debt-badge + красный border-l', () => {
    const leads = [makeLead({ id: 'l1', debt: 500 })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByTestId('debt-badge')).toBeInTheDocument();
    expect(screen.getByTestId('lead-card-l1').className).toContain('border-l-danger');
  });

  it('лид без долга НЕ показывает debt-badge', () => {
    const leads = [makeLead({ id: 'l1', debt: 0, totalAmount: 1000, paid: 1000 })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.queryByTestId('debt-badge')).not.toBeInTheDocument();
  });

  it('лид с fingerprint в ближ. 7 дней без долга → warn border', () => {
    const fp = new Date(Date.now() + 3 * 86400000).toISOString();
    const leads = [makeLead({ id: 'l1', debt: 0, totalAmount: 1000, paid: 1000, fingerprintDate: fp })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByTestId('lead-card-l1').className).toContain('border-l-warn');
  });

  it('docs progress + бейдж рендерятся когда docsCount > 0', () => {
    const leads = [makeLead({ id: 'l1', docsCount: 5, docsHave: 3 })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByTestId('docs-progress')).toBeInTheDocument();
    expect(screen.getByTestId('docs-badge')).toHaveTextContent('3/5');
  });

  it('лид с totalAmount=0 показывает «сумма не задана»', () => {
    const leads = [makeLead({ id: 'l1', totalAmount: 0, paid: 0, debt: 0 })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByText('сумма не задана')).toBeInTheDocument();
  });

  it('полностью оплаченный лид показывает «оплачено»', () => {
    const leads = [makeLead({ id: 'l1', totalAmount: 1000, paid: 1000, debt: 0 })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByText('оплачено')).toBeInTheDocument();
  });

  it('ссылка на карточку лида ведёт на /clients/{id}', () => {
    const leads = [makeLead({ id: 'l1' })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    expect(screen.getByTestId('lead-card-l1').getAttribute('href')).toBe('/clients/l1');
  });
});

// ====================== LIST VIEW ======================

describe('FunnelView — List view', () => {
  it('рендерит таблицу со всеми лидами', () => {
    const leads = [
      makeLead({ id: 'l1', clientName: 'Иван', stageId: 's-new' }),
      makeLead({ id: 'l2', clientName: 'Пётр', stageId: 's-work' }),
    ];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    fireEvent.click(screen.getByTestId('view-list'));
    expect(screen.getByText('Иван')).toBeInTheDocument();
    expect(screen.getByText('Пётр')).toBeInTheDocument();
  });

  it('пустой список → «Лидов не найдено»', () => {
    render(<FunnelView {...BASE_PROPS} leads={[]} />);
    fireEvent.click(screen.getByTestId('view-list'));
    expect(screen.getByText('Лидов не найдено')).toBeInTheDocument();
  });

  it('лид без долга → «оплачено» зелёным', () => {
    const leads = [makeLead({ id: 'l1', debt: 0, paid: 1000, totalAmount: 1000 })];
    render(<FunnelView {...BASE_PROPS} leads={leads} />);
    fireEvent.click(screen.getByTestId('view-list'));
    const txt = screen.getAllByText('оплачено')[0];
    expect(txt.closest('td')?.className).toContain('text-success');
  });
});

// ====================== plural() HELPER ======================

describe('plural() — русские склонения', () => {
  it('1, 21, 31 → "лид"', () => {
    expect(plural(1, 'лид', 'лида', 'лидов')).toBe('лид');
    expect(plural(21, 'лид', 'лида', 'лидов')).toBe('лид');
    expect(plural(31, 'лид', 'лида', 'лидов')).toBe('лид');
  });

  it('2, 3, 4, 22 → "лида"', () => {
    expect(plural(2, 'лид', 'лида', 'лидов')).toBe('лида');
    expect(plural(3, 'лид', 'лида', 'лидов')).toBe('лида');
    expect(plural(4, 'лид', 'лида', 'лидов')).toBe('лида');
    expect(plural(22, 'лид', 'лида', 'лидов')).toBe('лида');
  });

  it('5-20 → "лидов"', () => {
    expect(plural(5, 'лид', 'лида', 'лидов')).toBe('лидов');
    expect(plural(15, 'лид', 'лида', 'лидов')).toBe('лидов');
    expect(plural(20, 'лид', 'лида', 'лидов')).toBe('лидов');
  });

  it('исключение: 11, 12, 13, 14 → "лидов"', () => {
    expect(plural(11, 'лид', 'лида', 'лидов')).toBe('лидов');
    expect(plural(12, 'лид', 'лида', 'лидов')).toBe('лидов');
    expect(plural(13, 'лид', 'лида', 'лидов')).toBe('лидов');
    expect(plural(14, 'лид', 'лида', 'лидов')).toBe('лидов');
  });

  it('0 → "лидов"', () => {
    expect(plural(0, 'лид', 'лида', 'лидов')).toBe('лидов');
  });

  it('100, 101, 102', () => {
    expect(plural(100, 'лид', 'лида', 'лидов')).toBe('лидов');
    expect(plural(101, 'лид', 'лида', 'лидов')).toBe('лид');
    expect(plural(102, 'лид', 'лида', 'лидов')).toBe('лида');
  });
});
