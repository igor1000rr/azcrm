// Anna идея №12 «Расшифровка и анализ телефонных разговоров».
//
// Pipeline для одного звонка:
//   1. Скачиваем аудио по recordLocalUrl
//   2. Транскрибируем через Whisper API (OpenAI-совместимый — можно
//      подключить Groq, OpenAI, любого совместимого провайдера)
//   3. Шлём транскрипт в LLM с system-prompt просящим JSON-ответ:
//      sentiment / sentimentScore / summary / tags
//   4. Сохраняем результаты в Call.{transcript, sentiment, ...}
//   5. Если sentiment=NEGATIVE — шлём notify руководителю
//
// ENV (если не заданы — gracefully SKIPPED, cron не падает):
//   WHISPER_API_KEY    — обязателен для транскрипции
//   WHISPER_API_BASE   — default https://api.openai.com/v1
//   WHISPER_MODEL      — default whisper-1
//   LLM_API_KEY        — обязателен для анализа
//   LLM_API_BASE       — default https://api.openai.com/v1
//   LLM_MODEL          — default gpt-4o-mini
//
// Пример Groq: WHISPER_API_BASE=https://api.groq.com/openai/v1
//              WHISPER_MODEL=whisper-large-v3
//              LLM_MODEL=llama-3.3-70b-versatile

import { db } from '@/lib/db';
import { notify } from '@/lib/notify';
import type { CallSentiment } from '@prisma/client';

const WHISPER_API_KEY  = process.env.WHISPER_API_KEY;
const WHISPER_API_BASE = process.env.WHISPER_API_BASE ?? 'https://api.openai.com/v1';
const WHISPER_MODEL    = process.env.WHISPER_MODEL    ?? 'whisper-1';
const LLM_API_KEY      = process.env.LLM_API_KEY;
const LLM_API_BASE     = process.env.LLM_API_BASE     ?? 'https://api.openai.com/v1';
const LLM_MODEL        = process.env.LLM_MODEL        ?? 'gpt-4o-mini';

const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? 'http://localhost:3000';

const SYSTEM_PROMPT = `Ты анализируешь телефонные разговоры менеджера юридической миграционной фирмы с клиентом.
Фирма помогает с легализацией в Польше: карта побыта, виза, karta praca.
Определи тональность клиента и верни СТРОГО JSON-объект следующего формата (без markdown, без пояснений):

{
  "sentiment": "POSITIVE" | "NEUTRAL" | "NEGATIVE" | "PRICE_QUESTION",
  "sentimentScore": число от -1.0 до +1.0,
  "summary": "1-2 предложения по-русски: о чём был разговор",
  "tags": ["тег-1", "тег-2", ...]
}

Категории sentiment:
- POSITIVE: клиент доволен, благодарит, всё понятно, договорились
- NEUTRAL: обычный рабочий разговор без ярких эмоций
- NEGATIVE: клиент раздражён, жалуется, угрожает уйти, недоволен сроками или ценой
- PRICE_QUESTION: клиент в первую очередь спрашивает цену / условия (горячий лид)

sentimentScore: -1.0 для очень негативных, -0.5 для лёгкого раздражения,
0 для нейтральных, +0.5 для довольных, +1.0 для очень благодарных.
Для PRICE_QUESTION выбирай 0.0..+0.3 (интерес — это положительный сигнал).

Теги — короткие маркеры на русском в kebab-case без пробелов:
'жалоба-сроки', 'спросил-цену', 'упомянул-конкурента', 'благодарность',
'отказ', 'просит-перезвонить', 'нужна-консультация'. Не больше 5 тегов.`;

interface AnalysisResult {
  sentiment:      CallSentiment;
  sentimentScore: number;
  summary:        string;
  tags:           string[];
}

/** Парсит ответ LLM (строку или объект) в типизированный AnalysisResult.
 *  LLM иногда оборачивает JSON в ```json блоки — обрезаем. Pure для unit-тестов. */
export function parseAnalysisResponse(raw: string): AnalysisResult {
  // Удаляем markdown code fence если есть
  let cleaned = raw.trim();
  const fenceMatch = cleaned.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(cleaned);
  } catch {
    throw new Error(`LLM вернул невалидный JSON: ${raw.slice(0, 200)}`);
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('LLM вернул не объект');
  }

  const obj = parsed as Record<string, unknown>;

  // sentiment — обязателен и должен быть из enum
  const sentimentRaw = String(obj.sentiment ?? '').toUpperCase();
  if (!['POSITIVE', 'NEUTRAL', 'NEGATIVE', 'PRICE_QUESTION'].includes(sentimentRaw)) {
    throw new Error(`Неизвестный sentiment: ${sentimentRaw}`);
  }
  const sentiment = sentimentRaw as CallSentiment;

  // sentimentScore — число в [-1, 1], если вне диапазона зажимаем
  let sentimentScore = Number(obj.sentimentScore);
  if (!Number.isFinite(sentimentScore)) sentimentScore = 0;
  sentimentScore = Math.max(-1, Math.min(1, sentimentScore));

  const summary = typeof obj.summary === 'string' ? obj.summary.trim() : '';

  let tags: string[] = [];
  if (Array.isArray(obj.tags)) {
    tags = obj.tags
      .filter((t): t is string => typeof t === 'string')
      .map((t) => t.trim())
      .filter((t) => t.length > 0)
      .slice(0, 5);
  }

  return { sentiment, sentimentScore, summary, tags };
}

/** Вызывает Whisper API. Возвращает текст транскрипции. */
export async function transcribeAudio(audioUrl: string): Promise<string> {
  if (!WHISPER_API_KEY) throw new Error('WHISPER_API_KEY не задан');

  // Скачиваем аудио (recordLocalUrl это /api/files/wa-media/... — internal URL)
  const fullUrl = audioUrl.startsWith('http') ? audioUrl : `${APP_PUBLIC_URL}${audioUrl}`;
  const audioResp = await fetch(fullUrl);
  if (!audioResp.ok) {
    throw new Error(`Не удалось скачать аудио (${audioResp.status}): ${fullUrl}`);
  }
  const audioBuf = await audioResp.arrayBuffer();

  const form = new FormData();
  form.append('file', new Blob([audioBuf], { type: 'audio/mpeg' }), 'call.mp3');
  form.append('model', WHISPER_MODEL);
  form.append('response_format', 'text');

  const resp = await fetch(`${WHISPER_API_BASE}/audio/transcriptions`, {
    method:  'POST',
    headers: { Authorization: `Bearer ${WHISPER_API_KEY}` },
    body:    form,
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Whisper ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const text = await resp.text();
  return text.trim();
}

/** Вызывает LLM для sentiment-анализа. Возвращает разобранный AnalysisResult. */
export async function analyzeTranscript(transcript: string): Promise<AnalysisResult> {
  if (!LLM_API_KEY) throw new Error('LLM_API_KEY не задан');

  const resp = await fetch(`${LLM_API_BASE}/chat/completions`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${LLM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:       LLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: `Транскрипт разговора:\n\n${transcript}` },
      ],
      response_format: { type: 'json_object' },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`LLM ${resp.status}: ${errText.slice(0, 300)}`);
  }

  const data = await resp.json() as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM вернул пустой ответ');

  return parseAnalysisResponse(content);
}

const MIN_DURATION_SEC = 5;

/** Главная функция: обработать один звонок целиком. Возвращает финальный
 *  статус (для счётчика в cron). Никогда не бросает — все ошибки сохраняются
 *  в Call.transcriptError со статусом FAILED. */
export async function processCall(callId: string): Promise<'DONE' | 'SKIPPED' | 'FAILED'> {
  const call = await db.call.findUnique({
    where: { id: callId },
    select: {
      id: true, recordLocalUrl: true, durationSec: true,
      transcriptStatus: true, managerId: true,
      lead: {
        select: {
          id: true, legalManagerId: true, salesManagerId: true,
          client: { select: { fullName: true, phone: true } },
        },
      },
    },
  });

  if (!call) return 'FAILED';
  if (call.transcriptStatus !== 'PENDING') return 'SKIPPED';

  // Ранний отказ: нет записи или слишком короткий звонок
  if (!call.recordLocalUrl || (call.durationSec ?? 0) < MIN_DURATION_SEC) {
    await db.call.update({
      where: { id: callId },
      data:  {
        transcriptStatus: 'SKIPPED',
        transcriptError:  !call.recordLocalUrl ? 'нет recordLocalUrl' : `звонок < ${MIN_DURATION_SEC} сек`,
      },
    });
    return 'SKIPPED';
  }

  // Если ENV не сконфигурирован — корректно SKIPPED с понятной причиной.
  // Cron не падает, Igor увидит причину в transcriptError.
  if (!WHISPER_API_KEY || !LLM_API_KEY) {
    await db.call.update({
      where: { id: callId },
      data:  {
        transcriptStatus: 'SKIPPED',
        transcriptError:  'WHISPER_API_KEY или LLM_API_KEY не заданы в env',
      },
    });
    return 'SKIPPED';
  }

  // Помечаем PROCESSING — защита от повторного входа если cron срабатывает
  // ещё до завершения предыдущего запроса
  await db.call.update({
    where: { id: callId },
    data:  { transcriptStatus: 'PROCESSING' },
  });

  try {
    const transcript = await transcribeAudio(call.recordLocalUrl);
    if (!transcript || transcript.length < 10) {
      await db.call.update({
        where: { id: callId },
        data:  {
          transcript,
          transcriptStatus: 'SKIPPED',
          transcriptError:  'пустая транскрипция (тишина / шум)',
          transcribedAt:    new Date(),
        },
      });
      return 'SKIPPED';
    }

    const analysis = await analyzeTranscript(transcript);

    await db.call.update({
      where: { id: callId },
      data:  {
        transcript,
        transcriptStatus: 'DONE',
        transcribedAt:    new Date(),
        sentiment:        analysis.sentiment,
        sentimentScore:   analysis.sentimentScore,
        analysisSummary:  analysis.summary,
        analysisTags:     analysis.tags,
        transcriptError:  null,
      },
    });

    // Anna идея №12: «Видны проблемные звонки, требующие внимания
    // руководителя» — шлём NEGATIVE_CALL_ALERT.
    if (analysis.sentiment === 'NEGATIVE') {
      const managerId = call.lead?.legalManagerId
        ?? call.lead?.salesManagerId
        ?? call.managerId
        ?? null;

      if (managerId) {
        await notify({
          userId: managerId,
          kind:   'NEGATIVE_CALL_ALERT',
          title:  `Проблемный звонок: ${call.lead?.client.fullName ?? call.lead?.client.phone ?? 'клиент'}`,
          body:   analysis.summary || 'Клиент раздражён в разговоре. Послушайте запись.',
          link:   call.lead ? `/clients/${call.lead.id}` : null,
        }).catch((e) => console.error('NEGATIVE_CALL_ALERT notify failed:', e));
      }
    }

    return 'DONE';
  } catch (e) {
    const errMsg = (e as Error).message ?? String(e);
    await db.call.update({
      where: { id: callId },
      data:  {
        transcriptStatus: 'FAILED',
        transcriptError:  errMsg.slice(0, 500),
      },
    });
    console.error(`processCall ${callId} failed:`, errMsg);
    return 'FAILED';
  }
}

interface BatchResult {
  processed: number;
  done:      number;
  skipped:   number;
  failed:    number;
}

/** Берёт пачку PENDING звонков и обрабатывает по одному.
 *  Используется из cron-endpoint /api/cron/transcribe-calls. */
export async function processPendingCalls(limit = 5): Promise<BatchResult> {
  const calls = await db.call.findMany({
    where:   { transcriptStatus: 'PENDING' },
    select:  { id: true },
    orderBy: { startedAt: 'desc' },                // свежие первыми
    take:    limit,
  });

  const result: BatchResult = { processed: 0, done: 0, skipped: 0, failed: 0 };

  for (const c of calls) {
    const status = await processCall(c.id);
    result.processed++;
    if (status === 'DONE')    result.done++;
    if (status === 'SKIPPED') result.skipped++;
    if (status === 'FAILED')  result.failed++;
  }

  return result;
}

/** Включена ли фича. Для UI чтобы скрыть бейдж "анализируется"
 *  если ENV даже не настроены и обработка не запустится. */
export function isCallAnalysisEnabled(): boolean {
  return Boolean(WHISPER_API_KEY && LLM_API_KEY);
}
