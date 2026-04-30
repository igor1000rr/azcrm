// POST /api/cron/transcribe-calls
// Anna идея №12 «Расшифровка и анализ телефонных разговоров».
//
// Берёт до 5 звонков с transcriptStatus=PENDING, прогоняет через
// Whisper + LLM, сохраняет sentiment/transcript/summary/tags в БД.
// Лимит 5 за запуск чтобы не упереться в rate limits провайдера.
//
// Конфиг (API-ключи) — Настройки → Анализ звонков (БД), либо ENV fallback.
//
// crontab пример (рекомендую раз в 15 минут):
//   */15 * * * * curl -s -X POST -H "Authorization: Bearer $CRON_SECRET" \
//                https://crm.azgroupcompany.net/api/cron/transcribe-calls
//
// Параметры:
//   ?limit=N — обработать до N звонков за один запуск (1..20, default 5)

import { NextRequest, NextResponse } from 'next/server';
import { checkCronAuth } from '@/lib/cron-auth';
import { processPendingCalls, isCallAnalysisEnabled } from '@/lib/call-analysis';

export async function POST(req: NextRequest) {
  const fail = checkCronAuth(req);
  if (fail) return fail;

  if (!(await isCallAnalysisEnabled())) {
    return NextResponse.json({
      ok: false,
      enabled: false,
      message: 'Whisper или LLM ключ не настроен (Настройки → Анализ звонков или .env)',
    });
  }

  const url = new URL(req.url);
  const limitParam = Number(url.searchParams.get('limit') ?? '5');
  const limit = Math.max(1, Math.min(20, Number.isFinite(limitParam) ? limitParam : 5));

  const result = await processPendingCalls(limit);

  return NextResponse.json({
    ok: true,
    enabled: true,
    timestamp: new Date().toISOString(),
    ...result,
  });
}
