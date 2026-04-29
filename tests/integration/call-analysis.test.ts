// Unit + Integration: lib/call-analysis
// Anna идея №12 — транскрипция + sentiment-анализ звонков.

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Подменяем env ДО импорта модуля (он читает их на верхнем уровне).
// Без этого helper сразу пометит SKIPPED по причине "ENV не заданы".
process.env.WHISPER_API_KEY  = 'test-whisper-key';
process.env.LLM_API_KEY      = 'test-llm-key';
process.env.WHISPER_API_BASE = 'https://api.test/v1';
process.env.LLM_API_BASE     = 'https://api.test/v1';
process.env.LLM_MODEL        = 'test-model';

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

type AnyFn = ReturnType<typeof vi.fn>;

const mockDb = {
  call: {
    findUnique: vi.fn() as AnyFn,
    update:     vi.fn() as AnyFn,
    findMany:   vi.fn() as AnyFn,
  },
};
const mockNotify = vi.fn();

vi.mock('@/lib/db',     () => ({ db: mockDb }));
vi.mock('@/lib/notify', () => ({ notify: mockNotify }));

const { processCall, processPendingCalls } = await import('@/lib/call-analysis');

beforeEach(() => {
  mockDb.call.findUnique.mockReset();
  mockDb.call.update.mockReset();
  mockDb.call.findMany.mockReset();
  mockNotify.mockReset();
  mockDb.call.update.mockResolvedValue({});
  mockNotify.mockResolvedValue(undefined);
  vi.restoreAllMocks();
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

function mockFetchOk(transcriptText: string, llmJson: Record<string, unknown>) {
  let call = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
    call++;
    if (call === 1) {
      // download audio
      return new Response(new ArrayBuffer(1024), { status: 200 });
    }
    if (call === 2) {
      // whisper
      return new Response(transcriptText, { status: 200 });
    }
    // llm
    return new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify(llmJson) } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch);
}

describe('processCall', () => {
  it('не найден → FAILED', async () => {
    mockDb.call.findUnique.mockResolvedValue(null);
    expect(await processCall('missing')).toBe('FAILED');
  });

  it('статус не PENDING → SKIPPED, БД не трогаем', async () => {
    mockDb.call.findUnique.mockResolvedValue({ ...fullCall, transcriptStatus: 'DONE' });
    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(mockDb.call.update).not.toHaveBeenCalled();
  });

  it('нет recordLocalUrl → SKIPPED + transcriptError', async () => {
    mockDb.call.findUnique.mockResolvedValue({ ...fullCall, recordLocalUrl: null });
    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(mockDb.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'SKIPPED',
        transcriptError:  expect.stringContaining('recordLocalUrl'),
      }),
    });
  });

  it('звонок < 5 сек → SKIPPED', async () => {
    mockDb.call.findUnique.mockResolvedValue({ ...fullCall, durationSec: 3 });
    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(mockDb.call.update).toHaveBeenCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'SKIPPED',
        transcriptError:  expect.stringContaining('5 сек'),
      }),
    });
  });

  it('успех POSITIVE → DONE + сохраняет все поля + notify НЕ вызывается', async () => {
    mockDb.call.findUnique.mockResolvedValue(fullCall);
    mockFetchOk('Здравствуйте, спасибо большое за консультацию!', {
      sentiment: 'POSITIVE', sentimentScore: 0.8,
      summary: 'Клиент благодарит',  tags: ['благодарность'],
    });

    expect(await processCall('call-1')).toBe('DONE');

    // 2 update: PROCESSING → DONE
    expect(mockDb.call.update).toHaveBeenCalledTimes(2);
    expect(mockDb.call.update).toHaveBeenNthCalledWith(1, {
      where: { id: 'call-1' }, data: { transcriptStatus: 'PROCESSING' },
    });
    expect(mockDb.call.update).toHaveBeenNthCalledWith(2, {
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

    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('успех NEGATIVE → notify руководителю с правильным userId (legal приоритет)', async () => {
    mockDb.call.findUnique.mockResolvedValue(fullCall);
    mockFetchOk('Это безобразие! Уже месяц жду!', {
      sentiment: 'NEGATIVE', sentimentScore: -0.8,
      summary: 'Клиент возмущён сроками', tags: ['жалоба-сроки'],
    });

    await processCall('call-1');

    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-legal',                    // legal приоритет, не sales
      kind:   'NEGATIVE_CALL_ALERT',
      title:  expect.stringContaining('Иван Петров'),
      body:   'Клиент возмущён сроками',
      link:   '/clients/lead-1',
    }));
  });

  it('NEGATIVE без legalManager → notify salesManager', async () => {
    mockDb.call.findUnique.mockResolvedValue({
      ...fullCall,
      lead: { ...fullCall.lead, legalManagerId: null },
    });
    mockFetchOk('плохо', {
      sentiment: 'NEGATIVE', sentimentScore: -0.6, summary: 'x', tags: [],
    });

    await processCall('call-1');

    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-sales',
    }));
  });

  it('NEGATIVE без лида → notify managerId звонка', async () => {
    mockDb.call.findUnique.mockResolvedValue({
      ...fullCall, lead: null, managerId: 'mgr-call-direct',
    });
    mockFetchOk('плохо', {
      sentiment: 'NEGATIVE', sentimentScore: -0.6, summary: 'x', tags: [],
    });

    await processCall('call-1');
    expect(mockNotify).toHaveBeenCalledWith(expect.objectContaining({
      userId: 'mgr-call-direct',
    }));
  });

  it('NEGATIVE и нет ни одного менеджера → DONE, notify не вызывается', async () => {
    mockDb.call.findUnique.mockResolvedValue({
      ...fullCall, lead: null, managerId: null,
    });
    mockFetchOk('плохо', {
      sentiment: 'NEGATIVE', sentimentScore: -0.6, summary: 'x', tags: [],
    });

    expect(await processCall('call-1')).toBe('DONE');
    expect(mockNotify).not.toHaveBeenCalled();
  });

  it('пустая транскрипция → SKIPPED, LLM не вызывается', async () => {
    mockDb.call.findUnique.mockResolvedValue(fullCall);
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response(new ArrayBuffer(100), { status: 200 });
      return new Response('', { status: 200 });   // whisper вернул пусто
    }) as typeof fetch);

    expect(await processCall('call-1')).toBe('SKIPPED');
    expect(fetchCount).toBe(2);                    // LLM (3-й) не вызван
    expect(mockDb.call.update).toHaveBeenLastCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'SKIPPED',
        transcriptError:  expect.stringContaining('пустая'),
      }),
    });
  });

  it('Whisper 401 → FAILED + transcriptError содержит код', async () => {
    mockDb.call.findUnique.mockResolvedValue(fullCall);
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response(new ArrayBuffer(100), { status: 200 });
      return new Response('Unauthorized', { status: 401 });
    }) as typeof fetch);

    expect(await processCall('call-1')).toBe('FAILED');
    expect(mockDb.call.update).toHaveBeenLastCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({
        transcriptStatus: 'FAILED',
        transcriptError:  expect.stringContaining('401'),
      }),
    });
  });

  it('LLM вернул мусор → FAILED', async () => {
    mockDb.call.findUnique.mockResolvedValue(fullCall);
    let fetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      fetchCount++;
      if (fetchCount === 1) return new Response(new ArrayBuffer(100), { status: 200 });
      if (fetchCount === 2) return new Response('Текст транскрипции достаточно длинный для прохождения', { status: 200 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: 'это вообще не json' } }],
      }), { status: 200 });
    }) as typeof fetch);

    expect(await processCall('call-1')).toBe('FAILED');
    expect(mockDb.call.update).toHaveBeenLastCalledWith({
      where: { id: 'call-1' },
      data:  expect.objectContaining({ transcriptStatus: 'FAILED' }),
    });
  });

  it('PROCESSING ставится ДО fetch (защита от race с повторным cron)', async () => {
    mockDb.call.findUnique.mockResolvedValue(fullCall);
    const order: string[] = [];
    mockDb.call.update.mockImplementation(async (args: { data: { transcriptStatus?: string } }) => {
      if (args.data.transcriptStatus) order.push(`update:${args.data.transcriptStatus}`);
      return {};
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation((async () => {
      order.push('fetch');
      return new Response('text', { status: 200 });
    }) as typeof fetch);
    // Заставим LLM упасть чтобы не идти дальше — нам важен порядок update до fetch.
    // На самом деле всё равно дойдёт до FAILED, проверим первые два события.
    await processCall('call-1');
    expect(order[0]).toBe('update:PROCESSING');
    expect(order[1]).toBe('fetch');
  });
});

describe('processPendingCalls', () => {
  it('пусто → 0/0/0/0', async () => {
    mockDb.call.findMany.mockResolvedValue([]);
    const r = await processPendingCalls();
    expect(r).toEqual({ processed: 0, done: 0, skipped: 0, failed: 0 });
  });

  it('limit передаётся в findMany', async () => {
    mockDb.call.findMany.mockResolvedValue([]);
    await processPendingCalls(7);
    expect(mockDb.call.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 7 }));
  });

  it('пачка из 3 разных результатов → счётчики верны', async () => {
    mockDb.call.findMany.mockResolvedValue([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);

    // a → SKIPPED (нет recordLocalUrl)
    // b → DONE (всё ок, NEUTRAL)
    // c → FAILED (Whisper 500)
    mockDb.call.findUnique
      .mockResolvedValueOnce({ ...fullCall, id: 'a', recordLocalUrl: null })
      .mockResolvedValueOnce({ ...fullCall, id: 'b' })
      .mockResolvedValueOnce({ ...fullCall, id: 'c' });

    let cFetchCount = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation((async (input: RequestInfo | URL) => {
      cFetchCount++;
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

      // Для b — успешный pipeline
      if (cFetchCount <= 3) {
        if (url.includes('files/wa-media')) return new Response(new ArrayBuffer(100), { status: 200 });
        if (url.includes('audio/transcriptions')) return new Response('Достаточно длинный текст разговора', { status: 200 });
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({
            sentiment: 'NEUTRAL', sentimentScore: 0, summary: 'ok', tags: [],
          })}}],
        }), { status: 200 });
      }

      // Для c — Whisper падает
      if (url.includes('files/wa-media')) return new Response(new ArrayBuffer(100), { status: 200 });
      return new Response('server error', { status: 500 });
    }) as typeof fetch);

    const r = await processPendingCalls(10);

    expect(r.processed).toBe(3);
    expect(r.skipped).toBe(1);
    expect(r.done).toBe(1);
    expect(r.failed).toBe(1);
  });
});
