// Абстракция провайдера телефонии (Play в Польше).
export interface CallRecord {
  externalId:  string;
  direction:   'IN' | 'OUT' | 'MISSED';
  fromNumber:  string;
  toNumber:    string;
  startedAt:   Date;
  endedAt?:    Date;
  durationSec?: number;
  recordUrl?:  string;
  metadata?:   Record<string, unknown>;
}

export interface TelephonyProvider {
  name: string;
  fetchCalls(opts: { since: Date; until?: Date }): Promise<CallRecord[]>;
  downloadRecord?(externalId: string): Promise<Buffer | null>;
  isConfigured(): boolean;
}

const PLAY_API_BASE = process.env.PLAY_API_BASE ?? 'https://api.play.pl/v1';
const PLAY_API_KEY  = process.env.PLAY_API_KEY  ?? '';

export class PlayProvider implements TelephonyProvider {
  name = 'play';

  isConfigured(): boolean {
    return !!PLAY_API_KEY;
  }

  async fetchCalls(opts: { since: Date; until?: Date }): Promise<CallRecord[]> {
    if (!this.isConfigured()) return [];

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

let provider: TelephonyProvider | null = null;

export function getTelephonyProvider(): TelephonyProvider {
  if (provider) return provider;
  provider = new PlayProvider();
  return provider;
}

function normalizeIntl(p: string): string {
  let cleaned = p.replace(/[\s\-()]/g, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('00')) cleaned = '+' + cleaned.slice(2);
    else if (/^\d/.test(cleaned)) cleaned = '+48' + cleaned;
  }
  return cleaned;
}
