// Конфиг расшифровки звонков (Anna идея №12).
// Хранится в Setting (key='call-analysis') как JSON. Если поле пустое —
// берётся из ENV. Это позволяет настроить через UI и оставить fallback
// для локального dev / смены провайдера через .env.
//
// Поля:
//   whisperApiKey  — ключ Whisper-совместимого API (Groq, OpenAI, etc)
//   whisperApiBase — base URL, default https://api.openai.com/v1
//   whisperModel   — название модели (whisper-1 / whisper-large-v3)
//   llmApiKey      — ключ LLM-совместимого API
//   llmApiBase     — base URL
//   llmModel       — модель (gpt-4o-mini / llama-3.3-70b-versatile / grok-2)
//
// Секреты хранятся в открытом виде в БД — это риск, но Setting видят
// только ADMIN'ы (защита через requireAdmin в server actions).

import { db } from '@/lib/db';

export interface CallAnalysisConfig {
  whisperApiKey:  string;
  whisperApiBase: string;
  whisperModel:   string;
  llmApiKey:      string;
  llmApiBase:     string;
  llmModel:       string;
}

const SETTING_KEY = 'call-analysis';

const DEFAULTS: CallAnalysisConfig = {
  whisperApiKey:  '',
  whisperApiBase: 'https://api.openai.com/v1',
  whisperModel:   'whisper-1',
  llmApiKey:      '',
  llmApiBase:     'https://api.openai.com/v1',
  llmModel:       'gpt-4o-mini',
};

/** Загружает конфиг: БД > ENV > дефолты. Каждое поле резолвится отдельно
 *  чтобы можно было задать через UI только часть, а остальное оставить в .env. */
export async function getCallAnalysisConfig(): Promise<CallAnalysisConfig> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  const stored = (row?.value as Partial<CallAnalysisConfig> | null) ?? {};

  const env = {
    whisperApiKey:  process.env.WHISPER_API_KEY  ?? '',
    whisperApiBase: process.env.WHISPER_API_BASE ?? '',
    whisperModel:   process.env.WHISPER_MODEL    ?? '',
    llmApiKey:      process.env.LLM_API_KEY      ?? '',
    llmApiBase:     process.env.LLM_API_BASE     ?? '',
    llmModel:       process.env.LLM_MODEL        ?? '',
  };

  // Приоритет: БД (если непустое) → ENV (если непустое) → дефолт
  return {
    whisperApiKey:  stored.whisperApiKey  || env.whisperApiKey  || DEFAULTS.whisperApiKey,
    whisperApiBase: stored.whisperApiBase || env.whisperApiBase || DEFAULTS.whisperApiBase,
    whisperModel:   stored.whisperModel   || env.whisperModel   || DEFAULTS.whisperModel,
    llmApiKey:      stored.llmApiKey      || env.llmApiKey      || DEFAULTS.llmApiKey,
    llmApiBase:     stored.llmApiBase     || env.llmApiBase     || DEFAULTS.llmApiBase,
    llmModel:       stored.llmModel       || env.llmModel       || DEFAULTS.llmModel,
  };
}

/** Сохраняет конфиг в БД (upsert). Пустые строки в полях НЕ перезаписывают
 *  ENV — мы их сохраняем как есть (пустые), а getCallAnalysisConfig сделает fallback. */
export async function saveCallAnalysisConfig(config: CallAnalysisConfig): Promise<void> {
  await db.setting.upsert({
    where:  { key: SETTING_KEY },
    create: { key: SETTING_KEY, value: config as unknown as object },
    update: { value: config as unknown as object },
  });
}

/** Что сейчас лежит в БД (без fallback на ENV). Для UI чтобы показать
 *  откуда берётся каждое значение и какие поля админ задал явно. */
export async function getStoredCallAnalysisConfig(): Promise<Partial<CallAnalysisConfig>> {
  const row = await db.setting.findUnique({ where: { key: SETTING_KEY } });
  return (row?.value as Partial<CallAnalysisConfig> | null) ?? {};
}

/** Текущий статус (для UI / cron): включена ли фича. */
export async function isCallAnalysisEnabled(): Promise<boolean> {
  const cfg = await getCallAnalysisConfig();
  return Boolean(cfg.whisperApiKey && cfg.llmApiKey);
}
