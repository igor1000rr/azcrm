// Server actions для настроек анализа звонков (Anna идея №12).
// saveCallAnalysisSettings, testWhisperConnection, testLlmConnection.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: { requireAdmin: vi.fn() },
  config: {
    saveCallAnalysisConfig: vi.fn(),
    getCallAnalysisConfig:  vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => mocks.auth);
vi.mock('@/lib/call-analysis-config', () => mocks.config);

const {
  saveCallAnalysisSettings,
  testWhisperConnection,
  testLlmConnection,
} = await import('@/app/(app)/settings/call-analysis/actions');

const originalFetch = globalThis.fetch;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.requireAdmin.mockResolvedValue({ id: 'admin', role: 'ADMIN' });
  mocks.config.saveCallAnalysisConfig.mockResolvedValue(undefined);
});

afterEach(() => { globalThis.fetch = originalFetch; });

// ============ saveCallAnalysisSettings ============

describe('saveCallAnalysisSettings', () => {
  const VALID = {
    whisperApiKey:  'k1',
    whisperApiBase: 'https://api.openai.com/v1',
    whisperModel:   'whisper-1',
    llmApiKey:      'k2',
    llmApiBase:     'https://api.x.ai/v1',
    llmModel:       'grok-2',
  };

  it('успех -> вызывает saveCallAnalysisConfig', async () => {
    await saveCallAnalysisSettings(VALID);
    expect(mocks.config.saveCallAnalysisConfig).toHaveBeenCalledWith(
      expect.objectContaining({ whisperApiKey: 'k1', llmApiKey: 'k2' }),
    );
  });

  it('нормализация trailing slash в base URL', async () => {
    await saveCallAnalysisSettings({
      ...VALID,
      whisperApiBase: 'https://api.openai.com/v1/',
      llmApiBase:     'https://api.x.ai/v1////',
    });
    const saved = mocks.config.saveCallAnalysisConfig.mock.calls[0][0];
    expect(saved.whisperApiBase).toBe('https://api.openai.com/v1');
    expect(saved.llmApiBase).toBe('https://api.x.ai/v1');
  });

  it('не админ -> requireAdmin бросает, save не вызывается', async () => {
    mocks.auth.requireAdmin.mockRejectedValue(new Error('Недостаточно прав'));
    await expect(saveCallAnalysisSettings(VALID)).rejects.toThrow(/Недостаточно/);
    expect(mocks.config.saveCallAnalysisConfig).not.toHaveBeenCalled();
  });

  it('zod валидация: пустой apiKey слишком длинный -> throw', async () => {
    await expect(saveCallAnalysisSettings({
      ...VALID,
      llmApiKey: 'a'.repeat(300),  // > 200 chars
    })).rejects.toThrow();
  });
});

// ============ testWhisperConnection ============

describe('testWhisperConnection', () => {
  it('успех (200 от /models) -> ok=true', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey:  'sk-x',
      whisperApiBase: 'https://api.openai.com/v1',
      whisperModel:   'whisper-1',
      llmApiKey: '', llmApiBase: '', llmModel: '',
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => '{"data":[]}',
    }) as typeof fetch;

    const r = await testWhisperConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('200');
  });

  it('запрос идёт на правильный endpoint /models с Bearer токеном', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey:  'sk-test',
      whisperApiBase: 'https://api.groq.com/openai/v1',
      whisperModel:   'whisper-large-v3',
      llmApiKey: '', llmApiBase: '', llmModel: '',
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchSpy as typeof fetch;

    await testWhisperConnection();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/models');
    expect((init as RequestInit).method).toBe('GET');
    expect(((init as RequestInit).headers as Record<string, string>).Authorization).toBe('Bearer sk-test');
  });

  it('401 -> ok=false с кодом ошибки', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: 'bad', whisperApiBase: 'https://api.openai.com/v1',
      whisperModel: 'w', llmApiKey: '', llmApiBase: '', llmModel: '',
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      text: async () => '{"error":"Invalid API key"}',
    }) as typeof fetch;

    const r = await testWhisperConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
    expect(r.message).toContain('Invalid API key');
  });

  it('пустой apiKey -> ok=false без fetch', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: '', whisperApiBase: '', whisperModel: '',
      llmApiKey: '', llmApiBase: '', llmModel: '',
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    const r = await testWhisperConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toBe('API-ключ не задан');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('сетевая ошибка -> ok=false с сообщением', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: 'k', whisperApiBase: 'https://x', whisperModel: 'w',
      llmApiKey: '', llmApiBase: '', llmModel: '',
    });
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('ENOTFOUND')) as typeof fetch;

    const r = await testWhisperConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('ENOTFOUND');
  });
});

// ============ testLlmConnection ============

describe('testLlmConnection', () => {
  it('успех -> ok=true с указанием модели', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: '', whisperApiBase: '', whisperModel: '',
      llmApiKey:  'sk-x',
      llmApiBase: 'https://api.x.ai/v1',
      llmModel:   'grok-2',
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true, status: 200,
      text: async () => '{"choices":[]}',
    }) as typeof fetch;

    const r = await testLlmConnection();
    expect(r.ok).toBe(true);
    expect(r.message).toContain('grok-2');
  });

  it('запрос идёт POST на /chat/completions с минимальным промптом', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: '', whisperApiBase: '', whisperModel: '',
      llmApiKey:  'sk-x',
      llmApiBase: 'https://api.x.ai/v1',
      llmModel:   'grok-2',
    });
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    globalThis.fetch = fetchSpy as typeof fetch;

    await testLlmConnection();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe('https://api.x.ai/v1/chat/completions');
    expect((init as RequestInit).method).toBe('POST');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.model).toBe('grok-2');
    expect(body.max_tokens).toBe(5);  // минимальный промпт чтобы не тратить токены
    expect(body.messages).toEqual([{ role: 'user', content: 'ping' }]);
  });

  it('401 -> ok=false', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: '', whisperApiBase: '', whisperModel: '',
      llmApiKey: 'bad', llmApiBase: 'https://api.openai.com/v1', llmModel: 'gpt-4o-mini',
    });
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false, status: 401, statusText: 'Unauthorized',
      text: async () => '{"error":"bad key"}',
    }) as typeof fetch;

    const r = await testLlmConnection();
    expect(r.ok).toBe(false);
    expect(r.message).toContain('401');
  });

  it('пустой apiKey -> ok=false без fetch', async () => {
    mocks.config.getCallAnalysisConfig.mockResolvedValue({
      whisperApiKey: '', whisperApiBase: '', whisperModel: '',
      llmApiKey: '', llmApiBase: '', llmModel: '',
    });
    const fetchSpy = vi.fn();
    globalThis.fetch = fetchSpy as typeof fetch;

    const r = await testLlmConnection();
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
