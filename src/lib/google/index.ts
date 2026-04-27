// Google Calendar OAuth + API
import { db } from '@/lib/db';

const GOOGLE_CLIENT_ID     = process.env.GOOGLE_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? '';
const GOOGLE_REDIRECT_URI  = process.env.GOOGLE_REDIRECT_URI
  ?? `${process.env.AUTH_URL ?? 'http://localhost:3000'}/api/google/callback`;

const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'openid', 'email', 'profile',
];

export function isGoogleConfigured(): boolean {
  return !!(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET);
}

export function buildAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id:     GOOGLE_CLIENT_ID,
    redirect_uri:  GOOGLE_REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES.join(' '),
    access_type:   'offline',
    prompt:        'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeCodeForTokens(code: string): Promise<{
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      redirect_uri:  GOOGLE_REDIRECT_URI,
      grant_type:    'authorization_code',
    }),
  });
  if (!res.ok) {
    throw new Error(`OAuth exchange failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string; expires_in: number;
}> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id:     GOOGLE_CLIENT_ID,
      client_secret: GOOGLE_CLIENT_SECRET,
      grant_type:    'refresh_token',
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function getAccessTokenForUser(userId: string): Promise<string | null> {
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { googleAccessToken: true, googleRefreshToken: true },
  });
  if (!user?.googleRefreshToken) return null;

  try {
    const fresh = await refreshAccessToken(user.googleRefreshToken);
    await db.user.update({
      where: { id: userId },
      data: { googleAccessToken: fresh.access_token },
    });
    return fresh.access_token;
  } catch (e) {
    console.error('refresh token failed:', e);
    return null;
  }
}

interface GoogleEventPayload {
  summary:     string;
  description?: string;
  location?:   string;
  start:       { dateTime: string; timeZone?: string };
  end:         { dateTime: string; timeZone?: string };
  reminders?:  {
    useDefault: boolean;
    overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  };
}

export async function createGoogleEvent(
  userId: string,
  event: GoogleEventPayload,
): Promise<string | null> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return null;

  const res = await fetch(
    'https://www.googleapis.com/calendar/v3/calendars/primary/events',
    {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(event),
    },
  );

  if (!res.ok) {
    console.error('Google Calendar create failed:', res.status, await res.text());
    return null;
  }

  const data = await res.json() as { id: string };
  return data.id;
}

export async function updateGoogleEvent(
  userId: string,
  eventId: string,
  event: Partial<GoogleEventPayload>,
): Promise<boolean> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return false;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(event),
    },
  );

  return res.ok;
}

export async function deleteGoogleEvent(userId: string, eventId: string): Promise<boolean> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return false;

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
    {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${token}` },
    },
  );
  return res.ok || res.status === 410;
}

export interface GoogleEventLite {
  id:          string;
  summary?:    string;
  description?: string;
  location?:   string;
  start?:      { dateTime?: string; date?: string; timeZone?: string };
  end?:        { dateTime?: string; date?: string; timeZone?: string };
  status?:     'confirmed' | 'tentative' | 'cancelled';
  updated?:    string;
}

export async function listGoogleEvents(
  userId:    string,
  timeMin:   Date,
  timeMax:   Date,
): Promise<GoogleEventLite[]> {
  const token = await getAccessTokenForUser(userId);
  if (!token) return [];

  const params = new URLSearchParams({
    timeMin:      timeMin.toISOString(),
    timeMax:      timeMax.toISOString(),
    singleEvents: 'true',
    orderBy:      'startTime',
    maxResults:   '250',
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  );

  if (!res.ok) {
    console.error('listGoogleEvents failed:', res.status);
    return [];
  }

  const data = await res.json() as { items?: GoogleEventLite[] };
  return data.items ?? [];
}
