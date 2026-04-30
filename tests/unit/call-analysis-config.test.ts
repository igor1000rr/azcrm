// Unit: call-analysis-config — приоритет БД > ENV > defaults.
// Anna идея №12. Тесты гарантируют что:
//   1. Если поле есть в БД (Setting) — оно перебивает ENV.
//   2. Если в БД пусто — берётся из ENV.
//   3. Если и в БД и в ENV пусто — используется default (https://api.openai.com/v1, etc).
//   4. Пустые строки в БД эквивалентны "не задано" — НЕ перезаписывают ENV.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  db: {
    setting: {
      findUnique: vi.fn(),
      upsert:     vi.fn(),
    },
  },
}));

vi.mock('@/lib/db', () => ({ db: mocks.db }));

const {
  getCallAnalysisConfig,
  saveCallAnalysisConfig,
  getStoredCallAnalysisConfig,
  isCallAnalysisEnabled,
} = await import('@/lib/call-analysis-config');

// Снимок ENV перед тестами чтобы восстанавливать после каждого
const envSnapshot = { ...process.env };

beforeEach(() => {
  mocks.db.setting.findUnique.mockReset();
  mocks.db.setting.upsert.mockReset();
  mocks.db.setting.upsert.mockResolvedValue({});

  // Очищаем ENV-переменные конфига перед каждым тестом — каждый тест сам решает
  // что должно быть установлено.
  delete process.env.WHISPER_API_KEY;
  delete process.env.WHISPER_API_BASE;
  delete process.env.WHISPER_MODEL;
  delete process.env.LLM_API_KEY;
  delete process.env.LLM_API_BASE;
  delete process.env.LLM_MODEL;
});

afterEach(() => {
  // Восстанавливаем оригинальные ENV
  Object.assign(process.env, envSnapshot);
});
function afterEach(fn: () => void) { return import('vitest').then(({ afterEach: ae }) => ae(fn)); }

describe('getCallAnalysisConfig — fallback логика', () => {
  it('БД пуста, ENV пуст -> defaults (api.openai.com, whisper-1, gpt-4o-mini)', async () => {
    mocks.db.setting.findUnique.mockResolvedValue(null);

    const cfg = await getCallAnalysisConfig();

    expect(cfg.whisperApiKey).toBe('');
    expect(cfg.whisperApiBase).toBe('https://api.openai.com/v1');
    expect(cfg.whisperModel).toBe('whisper-1');
    expect(cfg.llmApiKey).toBe('');
    expect(cfg.llmApiBase).toBe('https://api.openai.com/v1');
    expect(cfg.llmModel).toBe('gpt-4o-mini');
  });

  it('БД пуста, ENV задан -> значения из ENV', async () => {
    mocks.db.setting.findUnique.mockResolvedValue(null);
    process.env.WHISPER_API_KEY  = 'env-whisper';
    process.env.WHISPER_API_BASE = 'https://env-whisper-base/v1';
    process.env.WHISPER_MODEL    = 'env-whisper-model';
    process.env.LLM_API_KEY      = 'env-llm';
    process.env.LLM_API_BASE     = 'https://env-llm-base/v1';
    process.env.LLM_MODEL        = 'env-llm-model';

    const cfg = await getCallAnalysisConfig();

    expect(cfg.whisperApiKey).toBe('env-whisper');
    expect(cfg.whisperApiBase).toBe('https://env-whisper-base/v1');
    expect(cfg.whisperModel).toBe('env-whisper-model');
    expect(cfg.llmApiKey).toBe('env-llm');
    expect(cfg.llmApiBase).toBe('https://env-llm-base/v1');
    expect(cfg.llmModel).toBe('env-llm-model');
  });

  it('БД задана, ENV задан -> БД перебивает ENV', async () => {
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: {
        whisperApiKey:  'db-whisper',
        whisperApiBase: 'https://db-whisper-base/v1',
        whisperModel:   'db-whisper-model',
        llmApiKey:      'db-llm',
        llmApiBase:     'https://db-llm-base/v1',
        llmModel:       'db-llm-model',
      },
    });
    process.env.WHISPER_API_KEY = 'env-whisper';
    process.env.LLM_API_KEY     = 'env-llm';

    const cfg = await getCallAnalysisConfig();

    expect(cfg.whisperApiKey).toBe('db-whisper');
    expect(cfg.whisperApiBase).toBe('https://db-whisper-base/v1');
    expect(cfg.whisperModel).toBe('db-whisper-model');
    expect(cfg.llmApiKey).toBe('db-llm');
    expect(cfg.llmApiBase).toBe('https://db-llm-base/v1');
    expect(cfg.llmModel).toBe('db-llm-model');
  });

  it('частичный конфиг в БД -> для пустых полей fallback на ENV', async () => {
    // Админ задал только LLM-ключ через UI, Whisper остаётся в .env
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: {
        llmApiKey:    'db-grok-key',
        llmApiBase:   'https://api.x.ai/v1',
        llmModel:     'grok-2',
        // whisper-поля пустые
      },
    });
    process.env.WHISPER_API_KEY  = 'env-whisper';
    process.env.WHISPER_API_BASE = 'https://api.groq.com/openai/v1';

    const cfg = await getCallAnalysisConfig();

    // LLM из БД
    expect(cfg.llmApiKey).toBe('db-grok-key');
    expect(cfg.llmApiBase).toBe('https://api.x.ai/v1');
    expect(cfg.llmModel).toBe('grok-2');
    // Whisper из ENV
    expect(cfg.whisperApiKey).toBe('env-whisper');
    expect(cfg.whisperApiBase).toBe('https://api.groq.com/openai/v1');
    // whisperModel — нет ни в БД, ни в ENV -> default
    expect(cfg.whisperModel).toBe('whisper-1');
  });

  it('пустые строки в БД -> НЕ перезаписывают ENV', async () => {
    // Регрессионный тест: если в БД лежит value: { llmApiKey: '' },
    // не должно быть превращено в "пустой ключ", должно подхватить ENV.
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: { llmApiKey: '', whisperApiKey: '' },
    });
    process.env.WHISPER_API_KEY = 'env-fallback';
    process.env.LLM_API_KEY     = 'env-fallback-llm';

    const cfg = await getCallAnalysisConfig();

    expect(cfg.whisperApiKey).toBe('env-fallback');
    expect(cfg.llmApiKey).toBe('env-fallback-llm');
  });
});

describe('isCallAnalysisEnabled', () => {
  it('оба ключа заданы -> true', async () => {
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: { whisperApiKey: 'a', llmApiKey: 'b' },
    });
    expect(await isCallAnalysisEnabled()).toBe(true);
  });

  it('только Whisper -> false', async () => {
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: { whisperApiKey: 'a' },
    });
    expect(await isCallAnalysisEnabled()).toBe(false);
  });

  it('только LLM -> false', async () => {
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: { llmApiKey: 'b' },
    });
    expect(await isCallAnalysisEnabled()).toBe(false);
  });

  it('оба пустые -> false', async () => {
    mocks.db.setting.findUnique.mockResolvedValue(null);
    expect(await isCallAnalysisEnabled()).toBe(false);
  });

  it('Whisper из ENV + LLM из БД -> true (комбинированный источник)', async () => {
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: { llmApiKey: 'db-llm' },
    });
    process.env.WHISPER_API_KEY = 'env-whisper';
    expect(await isCallAnalysisEnabled()).toBe(true);
  });
});

describe('getStoredCallAnalysisConfig', () => {
  it('запись отсутствует -> {}', async () => {
    mocks.db.setting.findUnique.mockResolvedValue(null);
    expect(await getStoredCallAnalysisConfig()).toEqual({});
  });

  it('запись есть -> возвращается value без fallback', async () => {
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: { llmModel: 'grok-2' },
    });
    const stored = await getStoredCallAnalysisConfig();
    expect(stored).toEqual({ llmModel: 'grok-2' });
    // Защита: проверяем что fallback на ENV/defaults НЕ применяется
    expect(stored.whisperApiBase).toBeUndefined();
  });
});

describe('saveCallAnalysisConfig', () => {
  it('upsert с key=call-analysis и value=config', async () => {
    await saveCallAnalysisConfig({
      whisperApiKey:  'k1',
      whisperApiBase: 'https://api.openai.com/v1',
      whisperModel:   'whisper-1',
      llmApiKey:      'k2',
      llmApiBase:     'https://api.openai.com/v1',
      llmModel:       'gpt-4o-mini',
    });

    expect(mocks.db.setting.upsert).toHaveBeenCalledWith({
      where:  { key: 'call-analysis' },
      create: { key: 'call-analysis', value: expect.objectContaining({ llmApiKey: 'k2' }) },
      update: { value: expect.objectContaining({ llmApiKey: 'k2' }) },
    });
  });
});
