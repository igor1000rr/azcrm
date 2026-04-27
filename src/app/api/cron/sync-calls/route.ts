// POST /api/cron/sync-calls
// Импортирует свежие звонки из Play, дедуплицирует, привязывает к клиентам
//
// crontab: */5 * * * * curl -X POST -H "Authorization: Bearer $CRON_SECRET" .../api/cron/sync-calls

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getTelephonyProvider } from '@/lib/telephony';
import { saveBuffer } from '@/lib/storage';
import { notify } from '@/lib/notify';
import { sanitizeDownloadName } from '@/lib/storage';

const CRON_SECRET = process.env.CRON_SECRET ?? '';
const SAVE_RECORDS_LOCALLY = process.env.SAVE_CALL_RECORDS === 'true';

export async function POST(req: NextRequest) {
  if (CRON_SECRET) {
    const auth = req.headers.get('authorization') ?? '';
    if (auth !== `Bearer ${CRON_SECRET}`) {
      return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
    }
  }

  const provider = getTelephonyProvider();
  if (!provider.isConfigured()) {
    return NextResponse.json({
      ok: false,
      error: 'Telephony provider not configured (set PLAY_API_KEY)',
    });
  }

  // Берём звонки за последний час (с запасом, дедуп защитит от дублей)
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const calls = await provider.fetchCalls({ since });

  let imported = 0, skipped = 0, attached = 0, errors = 0;

  for (const call of calls) {
    try {
      // Дедупликация по externalId
      const existing = await db.call.findUnique({
        where: { externalId: call.externalId },
        select: { id: true },
      });
      if (existing) { skipped++; continue; }

      // Ищем клиента по обоим номерам (для INCOMING — fromNumber, для OUTGOING — toNumber)
      const phoneToFind = call.direction === 'IN' ? call.fromNumber : call.toNumber;
      const client = await db.client.findUnique({
        where: { phone: phoneToFind },
        select: {
          id: true,
          ownerId: true,
          fullName: true,
          leads: {
            where: { isArchived: false },
            select: { id: true, salesManagerId: true },
            orderBy: { updatedAt: 'desc' },
            take: 1,
          },
        },
      });

      // Скачать запись если включено
      let recordLocalUrl: string | null = null;
      if (SAVE_RECORDS_LOCALLY && call.recordUrl && provider.downloadRecord) {
        try {
          const buf = await provider.downloadRecord(call.externalId);
          if (buf) {
            const saved = await saveBuffer(
              'wa-media',
              buf,
              `call-${sanitizeDownloadName(call.externalId)}.mp3`,
            );
            recordLocalUrl = saved.url;
          }
        } catch (e) {
          console.error('record download failed:', e);
        }
      }

      // Создаём запись звонка
      await db.call.create({
        data: {
          externalId:    call.externalId,
          direction:     call.direction,
          fromNumber:    call.fromNumber,
          toNumber:      call.toNumber,
          startedAt:     call.startedAt,
          endedAt:       call.endedAt,
          durationSec:   call.durationSec,
          recordUrl:     call.recordUrl,
          recordLocalUrl,
          metadata:      call.metadata as never,
          clientId:      client?.id,
          leadId:        client?.leads[0]?.id,
          managerId:     client?.leads[0]?.salesManagerId,
        },
      });

      imported++;
      if (client) attached++;

      // Создать LeadEvent если привязан к лиду
      if (client?.leads[0]) {
        await db.leadEvent.create({
          data: {
            leadId:  client.leads[0].id,
            kind:    'CALL_LOGGED',
            message: `${call.direction === 'IN' ? 'Входящий' : call.direction === 'OUT' ? 'Исходящий' : 'Пропущенный'} звонок` +
                     (call.durationSec ? ` (${Math.round(call.durationSec / 60)} мин)` : ''),
          },
        });
      }

      // Уведомление если пропущенный + есть владелец
      if (call.direction === 'MISSED' && client?.ownerId) {
        await notify({
          userId: client.ownerId,
          kind:   'CUSTOM',
          title:  `Пропущенный звонок: ${client.fullName}`,
          body:   `с номера ${call.fromNumber}`,
          link:   client.leads[0] ? `/clients/${client.leads[0].id}` : '/clients',
        });
      }
    } catch (e) {
      console.error('import call failed:', e);
      errors++;
    }
  }

  return NextResponse.json({
    ok: true,
    timestamp: new Date().toISOString(),
    fetched: calls.length,
    imported,
    skipped,
    attached,
    errors,
  });
}
