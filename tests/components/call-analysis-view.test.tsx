// UI: CallAnalysisView — настройки Whisper + LLM, пресеты, тесты подключения.
// Тестируем что пресеты подставляют endpoint+model, save вызывает action,
// eye-toggle показывает/скрывает API ключ.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { CallAnalysisView } from '@/app/(app)/settings/call-analysis/call-analysis-view';

// Server actions замокаем — иначе компонент попытается их вызвать в jsdom.
vi.mock('@/app/(app)/settings/call-analysis/actions', () => ({
  saveCallAnalysisSettings: vi.fn().mockResolvedValue({ ok: true }),
  testWhisperConnection:    vi.fn().mockResolvedValue({ ok: true, message: 'ok 200' }),
  testLlmConnection:        vi.fn().mockResolvedValue({ ok: true, message: 'ok grok-2' }),
}));

import {
  saveCallAnalysisSettings,
  testWhisperConnection,
  testLlmConnection,
} from '@/app/(app)/settings/call-analysis/actions';

const BASE_CONFIG = {
  whisperApiKey:  '',
  whisperApiBase: 'https://api.openai.com/v1',
  whisperModel:   'whisper-1',
  llmApiKey:      '',
  llmApiBase:     'https://api.openai.com/v1',
  llmModel:       'gpt-4o-mini',
};

const NO_ENV_FLAGS = {
  whisperApiKey: false, whisperApiBase: false, whisperModel: false,
  llmApiKey:     false, llmApiBase:     false, llmModel:     false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('CallAnalysisView — рендер и бейдж', () => {
  it('оба ключа пусты -> бейдж «выключено»', () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    expect(screen.getByText('выключено')).toBeInTheDocument();
  });

  it('оба ключа заданы -> бейдж «● включено»', () => {
    render(<CallAnalysisView
      config={{ ...BASE_CONFIG, whisperApiKey: 'k1', llmApiKey: 'k2' }}
      envFlags={NO_ENV_FLAGS}
    />);
    expect(screen.getByText(/включено/)).toBeInTheDocument();
  });

  it('обе карточки заголовки + кнопки «Тест подключения»', () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    expect(screen.getByText(/Whisper API/)).toBeInTheDocument();
    expect(screen.getByText(/LLM/)).toBeInTheDocument();
    const testBtns = screen.getAllByRole('button', { name: /Тест подключения/ });
    expect(testBtns).toHaveLength(2);
  });
});

describe('CallAnalysisView — пресеты', () => {
  it('клик пресета Groq в Whisper -> подставляет endpoint и модель', () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    // Кнопка Groq в Whisper-секции (вторая, потому что Groq и в LLM)
    const groqButtons = screen.getAllByRole('button', { name: 'Groq' });
    expect(groqButtons.length).toBeGreaterThanOrEqual(1);

    fireEvent.click(groqButtons[0]);                    // первый Groq = Whisper
    expect(screen.getByDisplayValue('https://api.groq.com/openai/v1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('whisper-large-v3')).toBeInTheDocument();
  });

  it('клик пресета xAI Grok в LLM -> подставляет api.x.ai + grok-2-latest', () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'xAI Grok' }));
    expect(screen.getByDisplayValue('https://api.x.ai/v1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('grok-2-latest')).toBeInTheDocument();
  });

  it('клик пресета OpenRouter -> подставляет endpoint и default-модель', () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    fireEvent.click(screen.getByRole('button', { name: 'OpenRouter' }));
    expect(screen.getByDisplayValue('https://openrouter.ai/api/v1')).toBeInTheDocument();
  });
});

describe('CallAnalysisView — eye toggle для apiKey', () => {
  it('по дефолту password input, клик eye-кнопки -> переключает на text', () => {
    render(<CallAnalysisView
      config={{ ...BASE_CONFIG, whisperApiKey: 'sk-secret' }}
      envFlags={NO_ENV_FLAGS}
    />);

    const input = screen.getByDisplayValue('sk-secret') as HTMLInputElement;
    expect(input.type).toBe('password');

    // Eye-кнопка — соседняя с input (нет уникального названия). Найдём через parent.
    const wrapper = input.parentElement!;
    const eyeBtn = wrapper.querySelector('button')!;
    fireEvent.click(eyeBtn);

    expect((screen.getByDisplayValue('sk-secret') as HTMLInputElement).type).toBe('text');
  });
});

describe('CallAnalysisView — Save', () => {
  it('клик «Сохранить» вызывает saveCallAnalysisSettings с текущим состоянием формы', async () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);

    // Заполним ключи
    const inputs = screen.getAllByPlaceholderText(/sk-/);
    fireEvent.change(inputs[0], { target: { value: 'whisper-key' } });
    fireEvent.change(inputs[1], { target: { value: 'llm-key' } });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    });

    await waitFor(() => {
      expect(saveCallAnalysisSettings).toHaveBeenCalledWith(expect.objectContaining({
        whisperApiKey: 'whisper-key',
        llmApiKey:     'llm-key',
      }));
    });
  });

  it('после успеха показывает «Настройки сохранены»', async () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    });
    await waitFor(() => {
      expect(screen.getByText(/Настройки сохранены/)).toBeInTheDocument();
    });
  });

  it('saveAction бросает -> показывает ошибку', async () => {
    vi.mocked(saveCallAnalysisSettings).mockRejectedValueOnce(new Error('БД недоступна'));
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Сохранить/ }));
    });
    await waitFor(() => {
      expect(screen.getByText('БД недоступна')).toBeInTheDocument();
    });
  });
});

describe('CallAnalysisView — тест подключения', () => {
  it('кнопка «Тест подключения» Whisper disabled пока ключ пуст', () => {
    render(<CallAnalysisView config={BASE_CONFIG} envFlags={NO_ENV_FLAGS} />);
    const testBtns = screen.getAllByRole('button', { name: /Тест подключения/ });
    // Whisper test (первая кнопка) disabled т.к. whisperApiKey=''
    expect(testBtns[0]).toBeDisabled();
  });

  it('Whisper тест успех -> зелёный бейдж с message', async () => {
    render(<CallAnalysisView
      config={{ ...BASE_CONFIG, whisperApiKey: 'sk-w', llmApiKey: 'sk-l' }}
      envFlags={NO_ENV_FLAGS}
    />);
    const testBtns = screen.getAllByRole('button', { name: /Тест подключения/ });
    await act(async () => {
      fireEvent.click(testBtns[0]);
    });
    await waitFor(() => {
      expect(testWhisperConnection).toHaveBeenCalled();
      expect(screen.getByText('ok 200')).toBeInTheDocument();
    });
  });

  it('LLM тест неуспех -> красный бейдж с error', async () => {
    vi.mocked(testLlmConnection).mockResolvedValueOnce({
      ok: false, message: '401 Unauthorized',
    });
    render(<CallAnalysisView
      config={{ ...BASE_CONFIG, whisperApiKey: 'sk', llmApiKey: 'sk' }}
      envFlags={NO_ENV_FLAGS}
    />);
    const testBtns = screen.getAllByRole('button', { name: /Тест подключения/ });
    await act(async () => {
      fireEvent.click(testBtns[1]);   // LLM test = вторая кнопка
    });
    await waitFor(() => {
      expect(screen.getByText('401 Unauthorized')).toBeInTheDocument();
    });
  });
});

describe('CallAnalysisView — ENV-подсказки', () => {
  it('envFlags.whisperApiKey=true -> placeholder показывает «из .env»', () => {
    render(<CallAnalysisView
      config={{ ...BASE_CONFIG, whisperApiKey: '' }}
      envFlags={{ ...NO_ENV_FLAGS, whisperApiKey: true }}
    />);
    expect(screen.getByPlaceholderText(/из \.env/)).toBeInTheDocument();
  });
});
