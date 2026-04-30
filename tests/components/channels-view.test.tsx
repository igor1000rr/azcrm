// UI: ChannelsView — четыре секции каналов + модалки подключения.
// Тестируем рендер, счётчики, открытие модалок Viber/Meta, бейджи Messenger/Instagram.
// Не тестируем сам процесс подключения — это покрыто в *-actions.test.ts.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ChannelsView } from '@/app/(app)/settings/channels/channels-view';

// Server actions замокаем — компонент их импортирует на верхнем уровне модуля,
// если не замокать — тест упадёт при попытке выполнить server-side код в jsdom.
vi.mock('@/app/(app)/settings/channels/actions', () => ({
  upsertWhatsappAccount: vi.fn(),
  deleteWhatsappAccount: vi.fn(),
  toggleWhatsappAccount: vi.fn(),
}));
vi.mock('@/app/(app)/settings/channels/telegram-actions', () => ({
  connectTelegramBot:    vi.fn(),
  disconnectTelegramBot: vi.fn(),
  toggleTelegramBot:     vi.fn(),
}));
vi.mock('@/app/(app)/settings/channels/viber-actions', () => ({
  connectViberAccount:    vi.fn(),
  disconnectViberAccount: vi.fn(),
  toggleViberAccount:     vi.fn(),
}));
vi.mock('@/app/(app)/settings/channels/meta-actions', () => ({
  connectMetaAccount:    vi.fn(),
  disconnectMetaAccount: vi.fn(),
  toggleMetaAccount:     vi.fn(),
}));

const BASE_PROPS = {
  waAccounts:    [],
  tgAccounts:    [],
  viberAccounts: [],
  metaAccounts:  [],
  users:         [
    { id: 'u1', name: 'Anna', role: 'ADMIN' as const },
    { id: 'u2', name: 'Yuliia', role: 'SALES' as const },
  ],
  appPublicUrl: 'https://crm.azgroupcompany.net',
};

beforeEach(() => {
  vi.clearAllMocks();
  // jsdom не имеет clipboard — мокаем чтобы не падало в тестах модалки
  Object.assign(navigator, {
    clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe('ChannelsView — рендер 4 секций', () => {
  it('показывает заголовки всех 4 секций', () => {
    render(<ChannelsView {...BASE_PROPS} />);
    expect(screen.getByText('WhatsApp каналы')).toBeInTheDocument();
    expect(screen.getByText('Telegram боты')).toBeInTheDocument();
    expect(screen.getByText('Viber каналы')).toBeInTheDocument();
    expect(screen.getByText('Meta (Messenger + Instagram)')).toBeInTheDocument();
  });

  it('пустые секции -> подсказки + кнопки добавления', () => {
    render(<ChannelsView {...BASE_PROPS} />);
    expect(screen.getByRole('button', { name: /Добавить номер/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Добавить бота/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Добавить Viber/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Добавить FB Page/ })).toBeInTheDocument();
    // Пустое состояние Viber подсказывает про partners.viber.com
    expect(screen.getByText(/partners\.viber\.com/)).toBeInTheDocument();
  });

  it('счётчики «N каналов · M подключено» учитывают только подключённые', () => {
    render(<ChannelsView {...BASE_PROPS}
      viberAccounts={[
        makeViber({ id: 'v1', isConnected: true }),
        makeViber({ id: 'v2', isConnected: false }),
        makeViber({ id: 'v3', isConnected: true }),
      ]}
    />);
    // 3 канала · 2 подключено
    const viberSection = screen.getByText('Viber каналы').closest('section')!;
    expect(viberSection).toHaveTextContent(/3.*канал.*2 подключено/);
  });
});

describe('ChannelsView — Viber модалка подключения', () => {
  it('клик «Добавить Viber» открывает форму с полями Auth Token + paName', () => {
    render(<ChannelsView {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить Viber/ }));
    // Заголовок модалки
    expect(screen.getByText(/Подключение Viber Public Account/)).toBeInTheDocument();
    // Поля
    expect(screen.getByPlaceholderText(/abcdef-12345/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('AZ Group')).toBeInTheDocument();
    // Кнопка «Подключить» disabled пока поля пустые
    const connectBtn = screen.getByRole('button', { name: /^Подключить$/ });
    expect(connectBtn).toBeDisabled();
  });

  it('заполнение полей -> кнопка «Подключить» становится активной', () => {
    render(<ChannelsView {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить Viber/ }));
    fireEvent.change(screen.getByPlaceholderText(/abcdef-12345/), {
      target: { value: 'token-xyz' },
    });
    fireEvent.change(screen.getByPlaceholderText('AZ Group'), {
      target: { value: 'AZ Group' },
    });
    expect(screen.getByRole('button', { name: /^Подключить$/ })).not.toBeDisabled();
  });
});

describe('ChannelsView — Meta модалка подключения', () => {
  it('клик «Добавить FB Page» открывает форму с тремя обязательными полями', () => {
    render(<ChannelsView {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить FB Page/ }));
    expect(screen.getByText(/Подключение Facebook Page/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/EAAB/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/32-символьный hex/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/my-secret-verify-token/)).toBeInTheDocument();
  });

  it('кнопка «Подключить» disabled пока не заполнены все 3 обязательных', () => {
    render(<ChannelsView {...BASE_PROPS} />);
    fireEvent.click(screen.getByRole('button', { name: /Добавить FB Page/ }));
    const btn = screen.getByRole('button', { name: /^Подключить$/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/EAAB/), { target: { value: 't' } });
    expect(btn).toBeDisabled();   // appSecret и verifyToken ещё пустые
    fireEvent.change(screen.getByPlaceholderText(/32-символьный hex/), { target: { value: 's' } });
    expect(btn).toBeDisabled();   // verifyToken ещё пустой
    fireEvent.change(screen.getByPlaceholderText(/my-secret-verify-token/), { target: { value: 'v' } });
    expect(btn).not.toBeDisabled();
  });
});

describe('ChannelsView — Meta-аккаунт с Instagram', () => {
  it('показывает оба бейджа Messenger + Instagram', () => {
    render(<ChannelsView {...BASE_PROPS}
      metaAccounts={[
        makeMeta({ hasInstagram: true, igUsername: 'azgroup' }),
      ]}
    />);
    expect(screen.getByText('Messenger')).toBeInTheDocument();
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.getByText(/@azgroup/)).toBeInTheDocument();
  });

  it('без Instagram -> показывает только Messenger бейдж', () => {
    render(<ChannelsView {...BASE_PROPS}
      metaAccounts={[ makeMeta({ hasInstagram: false }) ]}
    />);
    expect(screen.getByText('Messenger')).toBeInTheDocument();
    expect(screen.queryByText('Instagram')).not.toBeInTheDocument();
  });

  it('клик «Webhook URL» открывает модалку инструкций с правильным URL', () => {
    render(<ChannelsView {...BASE_PROPS}
      metaAccounts={[ makeMeta({ id: 'meta-xyz', verifyToken: 'my-secret-token' }) ]}
    />);
    fireEvent.click(screen.getByRole('button', { name: /Webhook URL/ }));
    // URL содержит accountId
    const urlInput = screen.getByDisplayValue(/messenger\/webhook\?account=meta-xyz/) as HTMLInputElement;
    expect(urlInput.value).toBe('https://crm.azgroupcompany.net/api/messenger/webhook?account=meta-xyz');
    // verifyToken показан
    expect(screen.getByDisplayValue('my-secret-token')).toBeInTheDocument();
  });

  it('кнопка Copy в инструкциях -> вызывает navigator.clipboard.writeText', () => {
    render(<ChannelsView {...BASE_PROPS}
      metaAccounts={[ makeMeta({ id: 'meta-1', verifyToken: 'tok' }) ]}
    />);
    fireEvent.click(screen.getByRole('button', { name: /Webhook URL/ }));

    // 2 кнопки Copy — рядом с URL и рядом с Verify Token. Проверяем что обе работают.
    const urlInput = screen.getByDisplayValue(/messenger\/webhook/);
    const tokenInput = screen.getByDisplayValue('tok');
    // Кнопки Copy — siblings соответствующих input'ов; ищем через title
    const copyBtns = screen.getAllByTitle('Скопировать');
    expect(copyBtns).toHaveLength(2);

    fireEvent.click(copyBtns[0]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(urlInput.getAttribute('value'));

    fireEvent.click(copyBtns[1]);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(tokenInput.getAttribute('value'));
  });
});

// ============ ХЕЛПЕРЫ ============

function makeViber(over: Partial<Parameters<typeof ChannelsView>[0]['viberAccounts'][0]> = {}) {
  return {
    id: 'v1', paName: 'AZ Group', label: 'AZ Viber',
    ownerId: null, ownerName: null,
    isConnected: true, isActive: true,
    webhookUrl: null, lastSeenAt: null,
    threadsCount: 0, messagesCount: 0,
    ...over,
  };
}

function makeMeta(over: Partial<Parameters<typeof ChannelsView>[0]['metaAccounts'][0]> = {}) {
  return {
    id: 'm1', pageId: 'page-1', pageName: 'AZ Page',
    igUserId: null, igUsername: null,
    hasMessenger: true, hasInstagram: false,
    verifyToken: 'verify-x',
    label: 'AZ FB',
    ownerId: null, ownerName: null,
    isConnected: true, isActive: true,
    lastSeenAt: null,
    threadsCount: 0, messagesCount: 0,
    ...over,
  };
}
