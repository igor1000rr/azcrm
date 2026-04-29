// Тесты компонента LeadChatPanel — единая лента переписки с клиентом.
// Покрывает: шапку, склонения, группировку по дням, Bubble (IN/OUT, image/doc/text,
// статусы доставки), ChannelSelect (открытие, выбор, статусы), Composer
// (textarea, кнопка, Enter/Shift+Enter, disabled-состояния, fetch+refresh).

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { useRouter } from 'next/navigation';
import { LeadChatPanel, type LeadChatMessage, type LeadChatAccount } from '@/app/(app)/clients/[id]/lead-chat-panel';

// ====================== ХЕЛПЕРЫ ======================

function makeMsg(over: Partial<LeadChatMessage> = {}): LeadChatMessage {
  return {
    id:           'm1',
    direction:    'IN',
    type:         'TEXT',
    body:         'Привет',
    mediaUrl:     null,
    mediaName:    null,
    createdAt:    '2026-04-29T10:00:00Z',
    isRead:       false,
    deliveredAt:  null,
    senderName:   null,
    accountId:    'acc-1',
    accountLabel: 'Anna WA',
    ...over,
  };
}

function makeAcc(over: Partial<LeadChatAccount> = {}): LeadChatAccount {
  return {
    id:          'acc-1',
    label:       'Anna WA',
    phoneNumber: '+48731006935',
    isConnected: true,
    isShared:    false,
    ...over,
  };
}

const BASE = {
  leadId:     'lead-1',
  clientName: 'Иванов Иван',
  messages:   [] as LeadChatMessage[],
  availableAccounts: [makeAcc()] as LeadChatAccount[],
};

// ====================== СБРОС МОКОВ ======================

beforeEach(() => {
  vi.clearAllMocks();
  // scrollIntoView не реализован в jsdom — без этого падает useEffect
  Element.prototype.scrollIntoView = vi.fn();
  // fetch by-default возвращает успех
  global.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ ok: true }),
  }) as unknown as typeof fetch;
});

// ====================== ШАПКА ======================

describe('LeadChatPanel — шапка', () => {
  it('рендерит имя клиента в заголовке', () => {
    render(<LeadChatPanel {...BASE} />);
    expect(screen.getByText(/Переписки с Иванов Иван/)).toBeInTheDocument();
  });

  it('0 сообщений: "0 сообщений · 0 каналов"', () => {
    render(<LeadChatPanel {...BASE} />);
    expect(screen.getByTestId('chat-stats')).toHaveTextContent('0 сообщений · 0 каналов');
  });

  it('1 сообщение: "1 сообщение · 1 канал"', () => {
    render(<LeadChatPanel {...BASE} messages={[makeMsg()]} />);
    expect(screen.getByTestId('chat-stats')).toHaveTextContent('1 сообщение · 1 канал');
  });

  it('2 сообщения: "2 сообщения · 1 канал"', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ id: 'm1' }),
      makeMsg({ id: 'm2' }),
    ]} />);
    expect(screen.getByTestId('chat-stats')).toHaveTextContent('2 сообщения · 1 канал');
  });

  it('5 сообщений из 2 каналов: "5 сообщений · 2 канала"', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ id: 'm1', accountId: 'a' }),
      makeMsg({ id: 'm2', accountId: 'a' }),
      makeMsg({ id: 'm3', accountId: 'a' }),
      makeMsg({ id: 'm4', accountId: 'b' }),
      makeMsg({ id: 'm5', accountId: 'b' }),
    ]} />);
    expect(screen.getByTestId('chat-stats')).toHaveTextContent('5 сообщений · 2 канала');
  });

  it('11 сообщений: "11 сообщений" (исключение)', () => {
    const msgs = Array.from({ length: 11 }, (_, i) => makeMsg({ id: `m${i}` }));
    render(<LeadChatPanel {...BASE} messages={msgs} />);
    expect(screen.getByTestId('chat-stats')).toHaveTextContent('11 сообщений');
  });

  it('21 сообщение: "21 сообщение" (исключение для 21)', () => {
    const msgs = Array.from({ length: 21 }, (_, i) => makeMsg({ id: `m${i}` }));
    render(<LeadChatPanel {...BASE} messages={msgs} />);
    expect(screen.getByTestId('chat-stats')).toHaveTextContent('21 сообщение');
  });
});

// ====================== ПУСТОЕ СОСТОЯНИЕ ======================

describe('LeadChatPanel — пустое состояние', () => {
  it('messages=[] → показывает "Переписок пока нет"', () => {
    render(<LeadChatPanel {...BASE} />);
    expect(screen.getByTestId('empty-state')).toBeInTheDocument();
    expect(screen.getByText(/Переписок с этим клиентом пока нет/)).toBeInTheDocument();
  });

  it('пустое состояние подсказывает написать первое сообщение', () => {
    render(<LeadChatPanel {...BASE} />);
    expect(screen.getByText(/Напишите первое сообщение ниже/)).toBeInTheDocument();
  });

  it('с сообщениями → пустое состояние НЕ рендерится', () => {
    render(<LeadChatPanel {...BASE} messages={[makeMsg()]} />);
    expect(screen.queryByTestId('empty-state')).not.toBeInTheDocument();
  });
});

// ====================== ГРУППИРОВКА ПО ДНЯМ ======================

describe('LeadChatPanel — группировка по дням', () => {
  it('сообщения одного дня в одной группе', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ id: 'm1', createdAt: '2026-04-25T08:00:00Z' }),
      makeMsg({ id: 'm2', createdAt: '2026-04-25T15:00:00Z' }),
    ]} />);
    expect(screen.getAllByTestId(/^day-group-/)).toHaveLength(1);
  });

  it('сообщения разных дней — две группы', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ id: 'm1', createdAt: '2026-04-20T08:00:00Z' }),
      makeMsg({ id: 'm2', createdAt: '2026-04-21T15:00:00Z' }),
    ]} />);
    expect(screen.getAllByTestId(/^day-group-/)).toHaveLength(2);
  });

  it('сегодняшнее сообщение → ярлык "Сегодня"', () => {
    const today = new Date().toISOString();
    const todayKey = today.slice(0, 10);
    render(<LeadChatPanel {...BASE} messages={[makeMsg({ createdAt: today })]} />);
    expect(screen.getByTestId(`day-label-${todayKey}`)).toHaveTextContent('Сегодня');
  });

  it('вчерашнее сообщение → ярлык "Вчера"', () => {
    const yest = new Date(Date.now() - 86400_000).toISOString();
    const yestKey = yest.slice(0, 10);
    render(<LeadChatPanel {...BASE} messages={[makeMsg({ createdAt: yest })]} />);
    expect(screen.getByTestId(`day-label-${yestKey}`)).toHaveTextContent('Вчера');
  });

  it('сообщение старше двух дней → конкретная дата (формат ru-RU)', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ createdAt: '2025-01-15T10:00:00Z' }),
    ]} />);
    const label = screen.getByTestId('day-label-2025-01-15');
    // ru-RU: "15 января 2025 г."
    expect(label.textContent).toMatch(/15.*январ.*2025/);
  });
});

// ====================== BUBBLE: НАПРАВЛЕНИЕ ======================

describe('LeadChatPanel — Bubble: направление IN/OUT', () => {
  it('IN сообщение → bubble слева (justify-start)', () => {
    render(<LeadChatPanel {...BASE} messages={[makeMsg({ direction: 'IN' })]} />);
    expect(screen.getByTestId('bubble-m1').className).toContain('justify-start');
  });

  it('OUT сообщение → bubble справа (justify-end)', () => {
    render(<LeadChatPanel {...BASE} messages={[makeMsg({ direction: 'OUT' })]} />);
    expect(screen.getByTestId('bubble-m1').className).toContain('justify-end');
  });

  it('senderName показывается ТОЛЬКО для OUT', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ id: 'in',  direction: 'IN',  senderName: 'X' }),
      makeMsg({ id: 'out', direction: 'OUT', senderName: 'Anna' }),
    ]} />);
    expect(screen.getByTestId('bubble-label-in')).not.toHaveTextContent('X');
    expect(screen.getByTestId('bubble-label-out')).toHaveTextContent('Anna');
  });
});

// ====================== BUBBLE: ТИПЫ КОНТЕНТА ======================

describe('LeadChatPanel — Bubble: типы контента', () => {
  it('TEXT — рендерит body', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ type: 'TEXT', body: 'Привет' }),
    ]} />);
    expect(screen.getByTestId('bubble-body-m1')).toHaveTextContent('Привет');
  });

  it('IMAGE — рендерит <img> с mediaUrl', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ type: 'IMAGE', mediaUrl: 'https://x/img.jpg', body: null }),
    ]} />);
    const img = screen.getByTestId('bubble-img-m1') as HTMLImageElement;
    expect(img.src).toBe('https://x/img.jpg');
  });

  it('DOCUMENT — рендерит <a> с mediaName и href', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ type: 'DOCUMENT', mediaUrl: 'https://x/doc.pdf', mediaName: 'contract.pdf', body: null }),
    ]} />);
    const link = screen.getByTestId('bubble-doc-m1') as HTMLAnchorElement;
    expect(link.href).toBe('https://x/doc.pdf');
    expect(link.textContent).toContain('contract.pdf');
  });

  it('DOCUMENT без mediaName → "Документ" по умолчанию', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ type: 'DOCUMENT', mediaUrl: 'https://x/doc.pdf', mediaName: null, body: null }),
    ]} />);
    expect(screen.getByTestId('bubble-doc-m1').textContent).toContain('Документ');
  });

  it('сообщение с body и type=IMAGE → рендерится и img и body', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ type: 'IMAGE', mediaUrl: 'https://x/i.jpg', body: 'caption' }),
    ]} />);
    expect(screen.getByTestId('bubble-img-m1')).toBeInTheDocument();
    expect(screen.getByTestId('bubble-body-m1')).toHaveTextContent('caption');
  });
});

// ====================== BUBBLE: СТАТУС ДОСТАВКИ (только OUT) ======================

describe('LeadChatPanel — Bubble: статусы доставки', () => {
  it('OUT прочитано → "✓✓"', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ direction: 'OUT', isRead: true, deliveredAt: '2026-04-29T10:01:00Z' }),
    ]} />);
    expect(screen.getByTestId('bubble-meta-m1').textContent).toContain('✓✓');
  });

  it('OUT доставлено но не прочитано → "✓"', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ direction: 'OUT', isRead: false, deliveredAt: '2026-04-29T10:01:00Z' }),
    ]} />);
    const meta = screen.getByTestId('bubble-meta-m1').textContent ?? '';
    expect(meta).toContain('✓');
    expect(meta).not.toContain('✓✓');
  });

  it('OUT pending (не доставлено) → "·"', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ direction: 'OUT', isRead: false, deliveredAt: null }),
    ]} />);
    expect(screen.getByTestId('bubble-meta-m1').textContent).toContain('·');
  });

  it('IN сообщения НЕ показывают статус доставки', () => {
    render(<LeadChatPanel {...BASE} messages={[
      makeMsg({ direction: 'IN', isRead: true, deliveredAt: '2026-04-29T10:01:00Z' }),
    ]} />);
    const meta = screen.getByTestId('bubble-meta-m1').textContent ?? '';
    expect(meta).not.toContain('✓');
  });
});

// ====================== ChannelSelect ======================

describe('LeadChatPanel — ChannelSelect', () => {
  it('точка статуса зелёная для подключённого канала', () => {
    render(<LeadChatPanel {...BASE} availableAccounts={[makeAcc({ isConnected: true })]} />);
    expect(screen.getByTestId('selected-status-dot').className).toContain('bg-success');
  });

  it('точка статуса предупреждение для отключённого канала', () => {
    render(<LeadChatPanel {...BASE} availableAccounts={[makeAcc({ isConnected: false })]} />);
    expect(screen.getByTestId('selected-status-dot').className).toContain('bg-warn');
  });

  it('по дефолту dropdown закрыт', () => {
    render(<LeadChatPanel {...BASE} />);
    expect(screen.queryByTestId('channel-dropdown')).not.toBeInTheDocument();
  });

  it('клик на кнопку → открывает dropdown', () => {
    render(<LeadChatPanel {...BASE} availableAccounts={[
      makeAcc({ id: 'a' }),
      makeAcc({ id: 'b', label: 'Общий', isShared: true }),
    ]} />);
    fireEvent.click(screen.getByTestId('channel-select-btn'));
    expect(screen.getByTestId('channel-dropdown')).toBeInTheDocument();
    expect(screen.getByTestId('channel-option-a')).toBeInTheDocument();
    expect(screen.getByTestId('channel-option-b')).toBeInTheDocument();
  });

  it('shared канал → бейдж "общий"', () => {
    render(<LeadChatPanel {...BASE} availableAccounts={[
      makeAcc({ id: 'a' }),
      makeAcc({ id: 'b', label: 'Общий', isShared: true }),
    ]} />);
    fireEvent.click(screen.getByTestId('channel-select-btn'));
    const sharedOption = screen.getByTestId('channel-option-b');
    expect(sharedOption).toHaveTextContent('общий');
  });

  it('клик по опции → меняет выбранный канал и закрывает dropdown', () => {
    render(<LeadChatPanel {...BASE} availableAccounts={[
      makeAcc({ id: 'a', label: 'Anna' }),
      makeAcc({ id: 'b', label: 'Yuliia' }),
    ]} />);
    fireEvent.click(screen.getByTestId('channel-select-btn'));
    fireEvent.click(screen.getByTestId('channel-option-b'));
    expect(screen.queryByTestId('channel-dropdown')).not.toBeInTheDocument();
    // После клика кнопка показывает Yuliia
    expect(screen.getByTestId('channel-select-btn')).toHaveTextContent('Yuliia');
  });

  it('клик снаружи → закрывает dropdown', () => {
    render(<LeadChatPanel {...BASE} />);
    fireEvent.click(screen.getByTestId('channel-select-btn'));
    expect(screen.getByTestId('channel-dropdown')).toBeInTheDocument();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByTestId('channel-dropdown')).not.toBeInTheDocument();
  });
});

// ====================== ВЫБОР ДЕФОЛТНОГО КАНАЛА ======================

describe('LeadChatPanel — pickDefaultAccount', () => {
  it('последнее IN сообщение определяет дефолт', () => {
    render(<LeadChatPanel {...BASE}
      messages={[
        makeMsg({ id: 'm1', direction: 'OUT', accountId: 'a' }),
        makeMsg({ id: 'm2', direction: 'IN',  accountId: 'b' }),
      ]}
      availableAccounts={[makeAcc({ id: 'a', label: 'Anna' }), makeAcc({ id: 'b', label: 'Yuliia' })]}
    />);
    expect(screen.getByTestId('channel-select-btn')).toHaveTextContent('Yuliia');
  });

  it('нет входящих → первый подключённый', () => {
    render(<LeadChatPanel {...BASE}
      messages={[]}
      availableAccounts={[
        makeAcc({ id: 'a', label: 'Anna', isConnected: false }),
        makeAcc({ id: 'b', label: 'Yuliia', isConnected: true }),
      ]}
    />);
    expect(screen.getByTestId('channel-select-btn')).toHaveTextContent('Yuliia');
  });

  it('все каналы отключены → первый из списка', () => {
    render(<LeadChatPanel {...BASE}
      messages={[]}
      availableAccounts={[
        makeAcc({ id: 'a', label: 'Anna', isConnected: false }),
        makeAcc({ id: 'b', label: 'Yuliia', isConnected: false }),
      ]}
    />);
    expect(screen.getByTestId('channel-select-btn')).toHaveTextContent('Anna');
  });
});

// ====================== COMPOSER ======================

describe('LeadChatPanel — composer', () => {
  it('availableAccounts=[] → показывает "Нет доступных каналов"', () => {
    render(<LeadChatPanel {...BASE} availableAccounts={[]} />);
    expect(screen.getByTestId('no-channels')).toBeInTheDocument();
    expect(screen.queryByTestId('msg-input')).not.toBeInTheDocument();
  });

  it('пустой текст → кнопка disabled', () => {
    render(<LeadChatPanel {...BASE} />);
    expect(screen.getByTestId('send-btn')).toBeDisabled();
  });

  it('текст → кнопка enabled', () => {
    render(<LeadChatPanel {...BASE} />);
    fireEvent.change(screen.getByTestId('msg-input'), { target: { value: 'Привет' } });
    expect(screen.getByTestId('send-btn')).not.toBeDisabled();
  });

  it('канал не подключён → textarea и кнопка disabled, видно warn', () => {
    render(<LeadChatPanel {...BASE}
      availableAccounts={[makeAcc({ isConnected: false })]}
    />);
    expect(screen.getByTestId('msg-input')).toBeDisabled();
    expect(screen.getByTestId('not-connected-warn')).toBeInTheDocument();
  });

  it('Enter без shift → отправляет', async () => {
    render(<LeadChatPanel {...BASE} />);
    const input = screen.getByTestId('msg-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: false });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/whatsapp/lead-send', expect.objectContaining({
        method: 'POST',
      }));
    });
  });

  it('Shift+Enter → НЕ отправляет (просто перенос)', () => {
    render(<LeadChatPanel {...BASE} />);
    const input = screen.getByTestId('msg-input');
    fireEvent.change(input, { target: { value: 'Hello' } });
    fireEvent.keyDown(input, { key: 'Enter', shiftKey: true });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ====================== ОТПРАВКА: FETCH + REFRESH ======================

describe('LeadChatPanel — отправка сообщения', () => {
  it('успех → fetch с правильным body, router.refresh, очищает поле', async () => {
    const refresh = vi.fn();
    vi.mocked(useRouter).mockReturnValue({
      push: vi.fn(), replace: vi.fn(), back: vi.fn(), refresh, prefetch: vi.fn(),
    } as unknown as ReturnType<typeof useRouter>);

    render(<LeadChatPanel {...BASE} />);
    const input = screen.getByTestId('msg-input') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'Тест 123' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'));
    });

    expect(global.fetch).toHaveBeenCalledWith('/api/whatsapp/lead-send', expect.objectContaining({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ leadId: 'lead-1', accountId: 'acc-1', body: 'Тест 123' }),
    }));

    await waitFor(() => {
      expect(refresh).toHaveBeenCalled();
    });
    expect((screen.getByTestId('msg-input') as HTMLTextAreaElement).value).toBe('');
  });

  it('сервер вернул ok=false с error → показывает alert с error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ ok: false, error: 'Канал не подключён' }),
    }) as unknown as typeof fetch;
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<LeadChatPanel {...BASE} />);
    fireEvent.change(screen.getByTestId('msg-input'), { target: { value: 'X' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'));
    });

    expect(alertMock).toHaveBeenCalledWith('Канал не подключён');
    alertMock.mockRestore();
  });

  it('fetch выкинул исключение → alert "Ошибка отправки"', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('network')) as unknown as typeof fetch;
    const alertMock = vi.spyOn(window, 'alert').mockImplementation(() => {});
    const errMock = vi.spyOn(console, 'error').mockImplementation(() => {});

    render(<LeadChatPanel {...BASE} />);
    fireEvent.change(screen.getByTestId('msg-input'), { target: { value: 'X' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'));
    });

    expect(alertMock).toHaveBeenCalledWith('Ошибка отправки');
    alertMock.mockRestore();
    errMock.mockRestore();
  });

  it('пробелы в начале/конце → отправляются с trim', async () => {
    render(<LeadChatPanel {...BASE} />);
    fireEvent.change(screen.getByTestId('msg-input'), { target: { value: '   привет   ' } });
    await act(async () => {
      fireEvent.click(screen.getByTestId('send-btn'));
    });
    const callArg = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0][1];
    expect(JSON.parse(callArg.body).body).toBe('привет');
  });

  it('только пробелы → не отправляет', () => {
    render(<LeadChatPanel {...BASE} />);
    fireEvent.change(screen.getByTestId('msg-input'), { target: { value: '   ' } });
    fireEvent.click(screen.getByTestId('send-btn'));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
