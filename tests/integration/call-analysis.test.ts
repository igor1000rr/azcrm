// Unit + Integration: lib/call-analysis
// Anna идея №12 — транскрипция + sentiment-анализ звонков.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// КРИТИЧНО: env устанавливаем через vi.hoisted, иначе ESM-импорты ниже
// сработают РАНЬШЕ присваивания process.env.* (статические import statement
// хойстятся в самый верх модуля). При первом импорте call-analysis.ts
// читает константы const WHISPER_API_KEY = process.env.WHISPER_API_KEY,
// и если env пустой → isCallAnalysisEnabled()=false → все processCall
// возвращают SKIPPED вместо ожидаемого DONE.
//
// После рефакторинга на конфиг через БД (call-analysis-config.ts):
// getCallAnalysisConfig() сначала смотрит в Setting (БД), и если там
// пусто — fallback на ENV. В тестах мокаем db.setting.findUnique → null,
// тогда конфиг тянется из ENV ровно как раньше.
vi.hoisted(() => {
  process.env.WHISPER_API_KEY  = 'test-whisper-key';
  process.env.LLM_API_KEY      = 'test-llm-key';
  process.env.WHISPER_API_BASE = 'https://api.test/v1';
  process.env.LLM_API_BASE     = 'https://api.test/v1';
  process.env.LLM_MODEL        = 'test-model';
});

// ============================================================
// Unit: parseAnalysisResponse
// ============================================================

import { parseAnalysisResponse } from '@/lib/call-analysis';

describe('parseAnalysisResponse', () => {
  it('валидный JSON → распарсенный объект', () => {
    const r = parseAnalysisResponse(JSON.stringify({
      sentiment:      'POSITIVE',
      sentimentScore: 0.7,
      summary:        'Клиент доволен консультацией',
      tags:           ['благодарность', 'договорились'],
    }));
    expect(r.sentiment).toBe('POSITIVE');
    expect(r.sentimentScore).toBe(0.7);
    expect(r.summary).toBe('Клиент доволен консультацией');
    expect(r.tags).toEqual(['благодарность', 'договорились']);
  });

  it('обёртка ```json ... ``` → распарсивается', () => {
    const r = parseAnalysisResponse('```json\n{"sentiment":"NEUTRAL","sentimentScore":0,"summary":"ok","tags":[]}\n```');
    expect(r.sentiment).toBe('NEUTRAL');
  });

  it('обёртка ``` без json → распарсивается', () => {
    const r = parseAnalysisResponse('```\n{"sentiment":"NEGATIVE","sentimentScore":-0.8,"summary":"плохо","tags":[]}\n```');
    expect(r.sentiment).toBe('NEGATIVE');
    expect(r.sentimentScore).toBe(-0.8);
  });

  it('sentiment в нижнем регистре → uppercase + проходит', () => {
    const r = parseAnalysisResponse('{"sentiment":"price_question","sentimentScore":0.2,"summary":"x","tags":[]}');
    expect(r.sentiment).toBe('PRICE_QUESTION');
  });

  it('невалидный JSON → throw', () => {
    expect(() => parseAnalysisResponse('не json вообще')).toThrow(/невалидный JSON/);
  });

  it('неизвестный sentiment → throw', () => {
    expect(() => parseAnalysisResponse('{"sentiment":"ANGRY","sentimentScore":0,"summary":"x","tags":[]}'))
      .toThrow(/Неизвестный sentiment/);
  });

  it('sentimentScore вне диапазона → зажимается в [-1,1]', () => {
    expect(parseAnalysisResponse('{"sentiment":"POSITIVE","sentimentScore":5,"summary":"x","tags":[]}').sentimentScore).toBe(1);
    expect(parseAnalysisResponse('{"sentiment":"NEGATIVE","sentimentScore":-99,"summary":"x","tags":[]}').sentimentScore).toBe(-1);
  });

  it('sentimentScore не число → 0', () => {
    expect(parseAnalysisResponse('{"sentiment":"NEUTRAL","sentimentScore":"abc","summary":"x","tags":[]}').sentimentScore).toBe(0);
    expect(parseAnalysisResponse('{"sentiment":"NEUTRAL","summary":"x","tags":[]}').sentimentScore).toBe(0);
  });

  it('tags не массив → []', () => {
    expect(parseAnalysisResponse('{"sentiment":"NEUTRAL","sentimentScore":0,"summary":"x"}').tags).toEqual([]);
    expect(parseAnalysisResponse('{"sentiment":"NEUTRAL","sentimentScore":0,"summary":"x","tags":"single"}').tags).toEqual([]);
  });

  it('tags > 5 → обрезаются до 5', () => {
    const r = parseAnalysisResponse(JSON.stringify({
      sentiment: 'NEUTRAL', sentimentScore: 0, summary: 'x',
      tags: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
    }));
    expect(r.tags).toHaveLength(5);
    expect(r.tags).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('tags содержит не-строки → фильтруются', () => {
    const r = parseAnalysisResponse(JSON.stringify({
      sentiment: 'NEUTRAL', sentimentScore: 0, summary: 'x',
      tags: ['ok', 123, null, 'second', { x: 1 }],
    }));
    expect(r.tags).toEqual(['ok', 'second']);
  });

  it('summary не строка → пустая строка', () => {
    const r = parseAnalysisResponse('{"sentiment":"NEUTRAL","sentimentScore":0,"tags":[]}');
    expect(r.summary).toBe('');
  });

  it('не объект (массив/null) → throw', () => {
    expect(() => parseAnalysisResponse('[1,2,3]')).toThrow();
    expect(() => parseAnalysisResponse('null')).toThrow();
  });
});

// ============================================================
// Integration: processCall (с моками БД, fetch, notify)
// ============================================================
//
// vi.mock хойстится в самый верх файла, поэтому обычные const'ы выше
// факториек ещё не существуют. Используем vi.hoisted.
//
// Мокаем db.setting.findUnique → null чтобы getCallAnalysisConfig упал
// на ENV-fallback (там test-ключи через hoisted process.env выше).

const mocks = vi.hoisted(() => ({
  db: {
    call: {
      findUnique: vi.fn(),
      update:     vi.fn(),
      findMany:   vi.fn(),
    },
    setting: {
      findUnique: vi.fn(),
    },
  },
  notify: vi.fn(),
}));

vi.mock('@/lib/db',     () => ({ db: mocks.db }));
vi.mock('@/lib/notify', () => ({ notify: mocks.notify }));

const { processCall, processPendingCalls } = await import('@/lib/call-analysis');

// Сохраняем оригинальный fetch чтобы корректно восстанавливать после каждого теста.
const originalFetch = globalThis.fetch;

beforeEach(() => {
  // ВАЖНО: НЕ вызываем vi.restoreAllMocks() — это сбросит mockResolvedValue
  // на db.update обратно к undefined (т.к. сами hoisted-моки тоже vi.fn).
  mocks.db.call.findUnique.mockReset();
  mocks.db.call.update.mockReset();
  mocks.db.call.findMany.mockReset();
  mocks.db.setting.findUnique.mockReset();
  mocks.notify.mockReset();
  mocks.db.call.update.mockResolvedValue({});
  // По умолчанию в Setting нет конфига — тогда getCallAnalysisConfig
  // вернёт значения из process.env (test-keys выше).
  mocks.db.setting.findUnique.mockResolvedValue(null);
  mocks.notify.mockResolvedValue(undefined);
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const fullCall = {
  id: 'call-1',
  recordLocalUrl:   '/api/files/wa-media/call-abc.mp3',
  durationSec:      120,
  transcriptStatus: 'PENDING',
  managerId:        'mgr-1',
  lead: {
    id: 'lead-1',
    legalManagerId: 'mgr-legal',
    salesManagerId: 'mgr-sales',
    client: { fullName: 'Иван Петров', phone: '+48123' },
  },
};

/** Подменяет globalThis.fetch на функцию которая по очереди возвращает:
 *  1) ответ с аудио-байтами (download recordLocalUrl)
 *  2) ответ с текстом транскрипции (Whisper)
 *  3) ответ с JSON в OpenAI-формате choices[0].message.content (LLM) */
function mockFetchOk(transcriptText: string, llmJson: Record<string, unknown>) {
  let call = 0;
  globalThis.fetch = vi.fn(async () => {
    call++;
    if (call === 1) {
      return new Response(new ArrayBuffer(1024), { status: 200 });
    }
    if (call === 2) {
      return new Response(transcriptText, { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(llmJson) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

const LONG_TRANSCRIPT = 'Здравствуйте, это разговор клиента и менеджера длиной более 10 символов.';

describe('processCall', () => {
  it('не найден → FAILED', async () => {
    mocks.db.call.findUnique.mockResolvedValue(null);
    expect(await processCall('missing')).toBe('FAILED');
  });

  it('статус не PENDING → SKIPPED, БД не трогаем', async () => {
    mocks.db.call.findUnique.mockResolvedValue({ ...fullCall, transcriptStatus: 'DONE' });
    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(mocks.db.call.update).not.toHaveBeenCalled();
  });

  it('нет recordLocalUrl → SKIPPED + transcriptError', async () => {
    mocks.db.call.findUnique.mockResolvedValue({ ...fullCall, recordLocalUrl: null });
    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(mocks.db.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'SKIPPED',
        transcriptError:  expect.stringContaining('recordLocalUrl'),
      }),
    });
  });

  it('звонок < 5 сек → SKIPPED', async () => {
    mocks.db.call.findUnique.mockResolvedValue({ ...fullCall, durationSec: 3 });
    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(mocks.db.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'SKIPPED',
        transcriptError:  expect.stringContaining('5 сек'),
      }),
    });
  });

  it('успех POSITIVE → DONE + сохраняет все поля + notify НЕ вызывается', async () => {
    mocks.db.call.findUnique.mockResolvedValue(fullCall);
    mockFetchOk(LONG_TRANSCRIPT, {
      sentiment: 'POSITIVE', sentimentScore: 0.8,
      summary: 'Клиент благодарит',  tags: ['благодарность'],
    });

    expect(await processCall('call-1')).toBe('DONE');

    expect(mocks.db.call.update).toHaveBeenCalledTimes(2);
    expect(mocks.db.call.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'call-1' }, data: { transcriptStatus: 'PROCESSING' },
    });
    expect(mocks.db.call.update).toHaveBeenNthCalledWith(2, {
      where: { id: 'call-1' },
      data: expect.objectContaining({
        transcriptStatus: 'DONE',
        sentiment:        'POSITIVE',
        sentimentScore:   0.8,
        analysisSummary:  'Клиент благодарит',
        analysisTags:     ['благодарность'],
        transcriptError:  null,
      }),
    });

    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('успех NEGATIVE → notify руководителю с правильным userId (legal приоритет)', async () => {
    mocks.db.call.findUnique.mockResolvedValue(fullCall);
    mockFetchOk(LONG_TRANSCRIPT, {
      sentiment: 'NEGATIVE', sentimentScore: -0.8,
      summary: 'Клиент возмущён сроками', tags: ['жалоба-сроки'],
    });

    await processCall('call-1');

    expect(mocks.notify).toHaveBeenCalledTimes(1);
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-legal',
      kind:   'NEGATIVE_CALL_ALERT',
      title:  expect.stringContaining('Иван Петров'),
      body:   'Клиент возмущён сроками',
      link:   '/clients/lead-1',
    }));
  });

  it('NEGATIVE без legalManager → notify salesManager', async () => {
    mocks.db.call.findUnique.mockResolvedValue({
      ...fullCall,
      lead: { ...fullCall.lead, legalManagerId: null },
    });
    mockFetchOk(LONG_TRANSCRIPT, {
      sentiment: 'NEGATIVE', sentimentScore: -0.6, summary: 'недоволен', tags: [],
    });

    await processCall('call-1');

    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-sales',
    }));
  });

  it('NEGATIVE без лида → notify managerId звонка', async () => {
    mocks.db.call.findUnique.mockResolvedValue({
      ...fullCall, lead: null, managerId: 'mgr-call-direct',
    });
    mockFetchOk(LONG_TRANSCRIPT, {
      sentiment: 'NEGATIVE', sentimentScore: -0.6, summary: 'недоволен', tags: [],
    });

    await processCall('call-1');
    expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-call-direct',
    }));
  });

  it('NEGATIVE и нет ни одного менеджера → DONE, notify не вызывается', async () => {
    mocks.db.call.findUnique.mockResolvedValue({
      ...fullCall, lead: null, managerId: null,
    });
    mockFetchOk(LONG_TRANSCRIPT, {
      sentiment: 'NEGATIVE', sentimentScore: -0.6, summary: 'недоволен', tags: [],
    });

    expect(await processCall('call-1')).toBe('DONE');
    expect(mocks.notify).not.toHaveBeenCalled();
  });

  it('пустая транскрипция → SKIPPED, LLM не вызывается', async () => {
    mocks.db.call.findUnique.mockResolvedValue(fullCall);
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response(new ArrayBuffer(100), { status: 200 });
      return new Response('', { status: 200 });   // whisper вернул пусто
    }) as typeof fetch;

    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(fetchCount).toBe(2);                    // LLM (3-й) не вызван
    expect(mocks.db.call.update).toHaveBeenLastCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'SKIPPED',
        transcriptError:  expect.stringContaining('пустая'),
      }),
    });
  });

  it('Whisper 401 → FAILED + transcriptError содержит код', async () => {
    mocks.db.call.findUnique.mockResolvedValue(fullCall);
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response(new ArrayBuffer(100), { status: 200 });
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch;

    expect(await processCall('call-1')).toBe('FAILED');
    expect(mocks.db.call.update).toHaveBeenLastCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'FAILED',
        transcriptError:  expect.stringContaining('401'),
      }),
    });
  });

  it('LLM вернул мусор → FAILED', async () => {
    mocks.db.call.findUnique.mockResolvedValue(fullCall);
    let fetchCount = 0;
    globalThis.fetch = vi.fn(async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response(new ArrayBuffer(100), { status: 200 });
      if (fetchCount === 2) return new Response(LONG_TRANSCRIPT, { status: 200 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'это вообще не json' } }],
      }), { status: 200 });
    }) as typeof fetch;

    expect(await processCall('call-1')).toBe('FAILED');
    expect(mocks.db.call.update).toHaveBeenLastCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({ transcriptStatus: 'FAILED' }),
    });
  });

  it('PROCESSING ставится ДО fetch (защита от race с повторным cron)', async () => {
    mocks.db.call.findUnique.mockResolvedValue(fullCall);
    const order: string[] = [];
    mocks.db.call.update.mockImplementation(async (args: { data: { transcriptStatus?: string } }) => {
      if (args.data.transcriptStatus) order.push(`update:${args.data.transcriptStatus}`);
      return {};
    });
    globalThis.fetch = vi.fn(async () => {
      order.push('fetch');
      return new Response('text', { status: 200 });
    }) as typeof fetch;
    await processCall('call-1');
    expect(order[0]).toBe('update:PROCESSING');
    expect(order[1]).toBe('fetch');
  });

  it('конфиг из БД перебивает ENV — другой LLM endpoint', async () => {
    // Пользователь сохранил свой ключ через UI → лежит в Setting.
    // Проверяем что endpoint берётся из БД, а не из process.env.
    mocks.db.setting.findUnique.mockResolvedValue({
      key: 'call-analysis',
      value: {
        whisperApiKey:  'db-whisper',
        whisperApiBase: 'https://api.test/v1',
        whisperModel:   'whisper-1',
        llmApiKey:      'db-llm-grok',
        llmApiBase:     'https://api.x.ai/v1',
        llmModel:       'grok-2',
      },
    });
    mocks.db.call.findUnique.mockResolvedValue(fullCall);

    const calledUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
      calledUrls.push(url);
      if (url.includes('files/wa-media')) return new Response(new ArrayBuffer(100), { status: 200 });
      if (url.includes('audio/transcriptions')) return new Response(LONG_TRANSCRIPT, { status: 200 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          sentiment: 'NEUTRAL', sentimentScore: 0, summary: 'ok', tags: [],
        })}}],
      }), { status: 200 });
    }) as typeof fetch;

    expect(await processCall('call-1')).toBe('DONE');
    // LLM endpoint должен быть из БД (api.x.ai), а не из ENV (api.test)
    expect(calledUrls.some((u) => u.startsWith('https://api.x.ai/v1/chat/completions'))).toBe(true);
  });
});

describe('processPendingCalls', () => {
  it('пусто → 0/0/0/0', async () => {
    mocks.db.call.findMany.mockResolvedValue([]);
    const r = await processPendingCalls();
    expect(r).toEqual({ processed: 0, done: 0, skipped: 0, failed: 0 });
  });

  it('limit передаётся в findMany', async () => {
    mocks.db.call.findMany.mockResolvedValue([]);
    await processPendingCalls(7);
    expect(mocks.db.call.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
  });

  it('пачка из 3 разных результатов → счётчики верны', async () => {
    mocks.db.call.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    // a → SKIPPED (нет recordLocalUrl)
    // b → DONE (всё ок, NEUTRAL)
    // c → FAILED (Whisper 500)
    mocks.db.call.findUnique
      .mockResolvedValueOnce({ ...fullCall, id: 'a', recordLocalUrl: null })
      .mockResolvedValueOnce({ ...fullCall, id: 'b' })
      .mockResolvedValueOnce({ ...fullCall, id: 'c' });

    let n = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      n++;
      const url = typeof input === 'string' ? input
                : input instanceof URL ? input.href
                : (input as Request).url;

      if (url.includes('files/wa-media')) {
        return new Response(new ArrayBuffer(100), { status: 200 });
      }

      if (n <= 3) {
        if (url.includes('audio/transcriptions')) {
          return new Response(LONG_TRANSCRIPT, { status: 200 });
        }
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            sentiment: 'NEUTRAL', sentimentScore: 0, summary: 'ok', tags: [],
          })}}],
        }), { status: 200 });
      }

      return new Response('server error', { status: 500 });
    }) as typeof fetch;

    const r = await processPendingCalls(10);

    expect(r.processed).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.done).toBe(1);
    expect(r.failed).toBe(1);
  });
});
