'use server';

// Server actions для управления настройками анализа звонков (Anna идея №12).
//
// Что делают:
//   saveCallAnalysisSettings — сохраняет ключи и модели в Setting (БД)
//   testWhisperConnection    — проверяет ключ Whisper коротким HEAD-запросом
//   testLlmConnection        — проверяет ключ LLM запросом /models
//
// Только ADMIN. Секреты (API-ключи) хранятся в БД в открытом виде —
// requireAdmin защищает от доступа других ролей.

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { requireAdmin } from '@/lib/auth';
import {
  saveCallAnalysisConfig,
  getCallAnalysisConfig,
  type CallAnalysisConfig,
} from '@/lib/call-analysis-config';

const configSchema = z.object({
  whisperApiKey:  z.string().max(200),
  whisperApiBase: z.string().max(200),
  whisperModel:   z.string().max(80),
  llmApiKey:      z.string().max(200),
  llmApiBase:     z.string().max(200),
  llmModel:       z.string().max(80),
});

export async function saveCallAnalysisSettings(input: CallAnalysisConfig) {
  await requireAdmin();
  const data = configSchema.parse(input);

  // Нормализуем base URLs: убираем trailing slash чтобы не было `..//audio/`
  data.whisperApiBase = data.whisperApiBase.replace(/\/+$/, '');
  data.llmApiBase     = data.llmApiBase.replace(/\/+$/, '');

  await saveCallAnalysisConfig(data);
  revalidatePath('/settings/call-analysis');
  return { ok: true };
}

/**
 * Проверка Whisper API: короткий запрос к /models. Большинство OpenAI-совместимых
 * провайдеров (OpenAI, Groq) реализуют этот endpoint и возвращают список моделей.
 * Если 200 — ключ валиден. Иначе показываем код ошибки.
 */
export async function testWhisperConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const cfg = await getCallAnalysisConfig();
  if (!cfg.whisperApiKey) return { ok: false, message: 'API-ключ не задан' };

  try {
    const resp = await fetch(`${cfg.whisperApiBase}/models`, {
      method:  'GET',
      headers: { Authorization: `Bearer ${cfg.whisperApiKey}` },
      signal:  AbortSignal.timeout(10000),
    });
    if (resp.ok) {
      return { ok: true, message: `Подключение работает (${resp.status})` };
    }
    const errText = await resp.text().catch(() => '');
    return {
      ok:      false,
      message: `${resp.status} ${resp.statusText}: ${errText.slice(0, 200)}`,
    };
  } catch (e) {
    return { ok: false, message: `Сетевая ошибка: ${(e as Error).message}` };
  }
}

/**
 * Проверка LLM API: запрос /chat/completions с минимальным промптом.
 * Это надёжнее чем /models — некоторые провайдеры (xAI Grok) /models не отдают.
 */
export async function testLlmConnection(): Promise<{ ok: boolean; message: string }> {
  await requireAdmin();
  const cfg = await getCallAnalysisConfig();
  if (!cfg.llmApiKey) return { ok: false, message: 'API-ключ не задан' };

  try {
    const resp = await fetch(`${cfg.llmApiBase}/chat/completions`, {
      method:  'POST',
      headers: {
        Authorization:  `Bearer ${cfg.llmApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model:       cfg.llmModel,
        max_tokens:  5,
        messages:    [{ role: 'user', content: 'ping' }],
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (resp.ok) {
      return { ok: true, message: `Подключение работает, модель «${cfg.llmModel}» доступна` };
    }
    const errText = await resp.text().catch(() => '');
    return {
      ok:      false,
      message: `${resp.status} ${resp.statusText}: ${errText.slice(0, 200)}`,
    };
  } catch (e) {
    return { ok: false, message: `Сетевая ошибка: ${(e as Error).message}` };
  }
}
