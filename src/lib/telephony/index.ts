// Абстракция провайдера телефонии.
// Сейчас реализован Play (Польша). При смене провайдера — добавить новый класс
// и переключить через TELEPHONY_PROVIDER в .env

export interface CallRecord {
  /** Уникальный ID звонка у провайдера — для дедупликации */
  externalId:  string;
  direction:   'IN' | 'OUT' | 'MISSED';
  /** Кто звонил (международный формат +48...) */
  fromNumber:  string;
  /** Кому звонил */
  toNumber:    string;
  startedAt:   Date;
  endedAt?:    Date;
  durationSec?: number;
  /** Прямая ссылка на запись (mp3) если есть */
  recordUrl?:  string;
  /** Сырые данные провайдера для архива */
  metadata?:   Record<string, unknown>;
}

export interface TelephonyProvider {
  name: string;
  /**
   * Получить новые звонки за период.
   * Возвращает массив звонков, готовых к импорту.
   */
  fetchCalls(opts: { since: Date; until?: Date }): Promise<CallRecord[]>;
  /**
   * Скачать запись разговора если нужно.
   * Возвращает Buffer или null если нет записи.
   */
  downloadRecord?(externalId: string): Promise<Buffer | null>;
  /**
   * Проверка что провайдер настроен (есть API ключ и т.д.)
   */
  isConfigured(): boolean;
}

// ============ PLAY (Польша) ============

const PLAY_API_BASE = process.env.PLAY_API_BASE ?? 'https://api.play.pl/v1';
const PLAY_API_KEY  = process.env.PLAY_API_KEY  ?? '';

export class PlayProvider implements TelephonyProvider {
  name = 'play';

  isConfigured(): boolean {
    return !!PLAY_API_KEY;
  }

  async fetchCalls(opts: { since: Date; until?: Date }): Promise<CallRecord[]> {
    if (!this.isConfigured()) return [];

    // ВАЖНО: точный формат API Play узнаем когда Anna даст документацию.
    // Сейчас — placeholder с правдоподобной структурой запроса.
    // После получения доступа — меняем endpoint, заголовки, парсинг.

    const params = new URLSearchParams({
      from: opts.since.toISOString(),
      to:   (opts.until ?? new Date()).toISOString(),
    });

    try {
      const res = await fetch(`${PLAY_API_BASE}/calls?${params}`, {
        headers: {
          'Authorization': `Bearer ${PLAY_API_KEY}`,
          'Accept':        'application/json',
        },
        signal: AbortSignal.timeout(30_000),
      });

      if (!res.ok) {
        console.error(`[play] fetch failed: ${res.status}`);
        return [];
      }

      const data = await res.json() as {
        calls?: Array<{
          id: string;
          direction: 'inbound' | 'outbound' | 'missed';
          from: string;
          to: string;
          started_at: string;
          ended_at?: string;
          duration?: number;
          recording_url?: string;
        }>;
      };

      return (data.calls ?? []).map((c) => ({
        externalId:  c.id,
        direction:   c.direction === 'inbound' ? 'IN'
                    : c.direction === 'outbound' ? 'OUT'
                    : 'MISSED',
        fromNumber:  normalizeIntl(c.from),
        toNumber:    normalizeIntl(c.to),
        startedAt:   new Date(c.started_at),
        endedAt:     c.ended_at ? new Date(c.ended_at) : undefined,
        durationSec: c.duration,
        recordUrl:   c.recording_url,
        metadata:    c as unknown as Record<string, unknown>,
      }));
    } catch (e) {
      console.error('[play] error:', e);
      return [];
    }
  }

  async downloadRecord(externalId: string): Promise<Buffer | null> {
    if (!this.isConfigured()) return null;
    try {
      const res = await fetch(`${PLAY_API_BASE}/calls/${externalId}/recording`, {
        headers: { 'Authorization': `Bearer ${PLAY_API_KEY}` },
      });
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    } catch {
      return null;
    }
  }
}

// ============ ВЫБОР ПРОВАЙДЕРА ============

let provider: TelephonyProvider | null = null;

export function getTelephonyProvider(): TelephonyProvider {
  if (provider) return provider;
  // Сейчас только Play. Можно расширить через ENV переменную TELEPHONY_PROVIDER.
  provider = new PlayProvider();
  return provider;
}

function normalizeIntl(p: string): string {
  let cleaned = p.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
    else if (/^\d/.test(cleaned)) cleaned = '+48' + cleaned; // дефолт PL
  }
  return cleaned;
}
