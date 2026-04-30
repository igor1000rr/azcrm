// Inbox — переписки с клиентами по всем каналам (WhatsApp/Telegram/Viber/Messenger/Instagram)
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { InboxView } from './inbox-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ thread?: string; channel?: string }>;
}

type ChannelKindStr = 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM';

export default async function InboxPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;

  // Permission policy: ADMIN — все, остальные — свои + общие.
  const accountFilter = user.role === 'ADMIN'
    ? { isActive: true }
    : { isActive: true, OR: [{ ownerId: user.id }, { ownerId: null }] };

  // Грузим аккаунты со всех 4 типов параллельно
  const [waAccs, tgAccs, viberAccs, metaAccs] = await Promise.all([
    db.whatsappAccount.findMany({
      where:  accountFilter,
      select: { id: true, label: true, phoneNumber: true, isConnected: true, ownerId: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.telegramAccount.findMany({
      where:  accountFilter,
      select: { id: true, label: true, botUsername: true, isConnected: true, ownerId: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.viberAccount.findMany({
      where:  accountFilter,
      select: { id: true, label: true, paName: true, isConnected: true, ownerId: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.metaAccount.findMany({
      where:  accountFilter,
      select: {
        id: true, label: true, pageName: true, igUsername: true,
        hasMessenger: true, hasInstagram: true, isConnected: true, ownerId: true,
      },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
  ]);

  const waIds    = waAccs.map((a) => a.id);
  const tgIds    = tgAccs.map((a) => a.id);
  const viberIds = viberAccs.map((a) => a.id);
  const metaIds  = metaAccs.map((a) => a.id);

  // Объединённый список аккаунтов для левой колонки фильтров.
  // Один MetaAccount → один пункт (внутренне фильтр по metaAccountId, в трэдах
  // channel различает Messenger vs Instagram).
  const accounts: Array<{
    kind:        ChannelKindStr;
    id:          string;
    label:       string;
    subtitle:    string;
    isConnected: boolean;
    ownerId:     string | null;
  }> = [
    ...waAccs.map((a) => ({
      kind: 'WHATSAPP' as const, id: a.id, label: a.label,
      subtitle: a.phoneNumber, isConnected: a.isConnected, ownerId: a.ownerId,
    })),
    ...tgAccs.map((a) => ({
      kind: 'TELEGRAM' as const, id: a.id, label: a.label,
      subtitle: `@${a.botUsername}`, isConnected: a.isConnected, ownerId: a.ownerId,
    })),
    ...viberAccs.map((a) => ({
      kind: 'VIBER' as const, id: a.id, label: a.label,
      subtitle: a.paName, isConnected: a.isConnected, ownerId: a.ownerId,
    })),
    ...metaAccs.map((a) => ({
      // MESSENGER как основной kind для Meta — даже если есть IG, фильтр в
      // левой колонке всё равно по metaAccountId, не по kind. Эта запись
      // визуально объединяет оба под одной FB Page.
      kind: 'MESSENGER' as const, id: a.id, label: a.label,
      subtitle: a.igUsername ? `${a.pageName} · @${a.igUsername}` : a.pageName,
      isConnected: a.isConnected, ownerId: a.ownerId,
    })),
  ];

  // ============ THREADS ============
  // Собираем threads со всех 4 типов аккаунтов с permission-фильтром.
  // Если задан params.channel — фильтруем по конкретному accountId
  // (ищем в каждом из 4 типов какой это).

  const channelFilter = params.channel ? resolveChannelFilter(params.channel, waIds, tgIds, viberIds, metaIds) : null;

  const threads = await db.chatThread.findMany({
    where: channelFilter ?? {
      isArchived: false,
      OR: [
        { whatsappAccountId: { in: waIds } },
        { telegramAccountId: { in: tgIds } },
        { viberAccountId:    { in: viberIds } },
        { metaAccountId:     { in: metaIds } },
      ],
    },
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    include: {
      client: { select: { id: true, fullName: true, phone: true } },
      whatsappAccount: { select: { id: true, label: true } },
      telegramAccount: { select: { id: true, label: true } },
      viberAccount:    { select: { id: true, label: true } },
      metaAccount:     { select: { id: true, label: true } },
      lead: { select: { id: true, funnel: { select: { name: true } } } },
    },
  });

  // ============ FALLBACK leadId через клиента ============
  // Бывает thread.leadId = null (worker не привязал, или другой канал создал
  // thread до того как лид появился). Для кнопки «Открыть карточку» резолвим
  // через clientId → последний активный лид.
  const clientIdsForFallback = threads
    .filter((t) => !t.leadId && t.clientId)
    .map((t) => t.clientId as string);

  let fallbackLeadByClient = new Map<string, { id: string; funnelName: string }>();
  if (clientIdsForFallback.length > 0) {
    const fallbackLeads = await db.lead.findMany({
      where: { clientId: { in: clientIdsForFallback }, isArchived: false },
      orderBy: { createdAt: 'desc' },
      select: { id: true, clientId: true, funnel: { select: { name: true } } },
    });
    for (const l of fallbackLeads) {
      if (!fallbackLeadByClient.has(l.clientId)) {
        fallbackLeadByClient.set(l.clientId, { id: l.id, funnelName: l.funnel.name });
      }
    }
  }

  function resolveLead(t: typeof threads[number]) {
    if (t.lead) return { id: t.lead.id, funnelName: t.lead.funnel.name };
    if (t.clientId) return fallbackLeadByClient.get(t.clientId) ?? null;
    return null;
  }

  /** Из thread'а определяем kind/accountId/accountLabel для UI. */
  function resolveThreadChannel(t: typeof threads[number]): {
    kind: ChannelKindStr; accountId: string; accountLabel: string | null;
  } {
    if (t.whatsappAccountId && t.whatsappAccount) {
      return { kind: 'WHATSAPP', accountId: t.whatsappAccount.id, accountLabel: t.whatsappAccount.label };
    }
    if (t.telegramAccountId && t.telegramAccount) {
      return { kind: 'TELEGRAM', accountId: t.telegramAccount.id, accountLabel: t.telegramAccount.label };
    }
    if (t.viberAccountId && t.viberAccount) {
      return { kind: 'VIBER', accountId: t.viberAccount.id, accountLabel: t.viberAccount.label };
    }
    if (t.metaAccountId && t.metaAccount) {
      // Channel самого thread'а различает MESSENGER/INSTAGRAM
      return {
        kind: t.channel === 'INSTAGRAM' ? 'INSTAGRAM' : 'MESSENGER',
        accountId: t.metaAccount.id,
        accountLabel: t.metaAccount.label,
      };
    }
    return { kind: 'WHATSAPP', accountId: '', accountLabel: null };
  }

  // ============ АКТИВНЫЙ ТРЕД И СООБЩЕНИЯ ============
  let activeThread = null;
  let activeMessages: Array<{
    id: string; direction: 'IN' | 'OUT' | 'SYSTEM'; type: string;
    body: string | null; mediaUrl: string | null; mediaName: string | null;
    createdAt: string; isRead: boolean; deliveredAt: string | null;
    senderName: string | null;
  }> = [];

  if (params.thread) {
    const t = threads.find((x) => x.id === params.thread);
    if (t) {
      activeThread = t;
      const msgs = await db.chatMessage.findMany({
        where: { threadId: params.thread },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: { sender: { select: { name: true } } },
      });
      activeMessages = msgs.map((m) => ({
        id: m.id,
        direction: m.direction,
        type: m.type,
        body: m.body,
        mediaUrl: m.mediaUrl,
        mediaName: m.mediaName,
        createdAt: m.createdAt.toISOString(),
        isRead: m.isRead,
        deliveredAt: m.deliveredAt?.toISOString() ?? null,
        senderName: m.sender?.name ?? null,
      }));

      await db.chatThread.update({
        where: { id: params.thread },
        data: { unreadCount: 0 },
      });
    }
  }

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Inbox' }]} />

      <InboxView
        accounts={accounts}
        threads={threads.map((t) => {
          const resolved = resolveLead(t);
          const ch = resolveThreadChannel(t);
          return {
            id: t.id,
            kind:          ch.kind,
            clientName:    t.client?.fullName ?? t.externalUserName ?? t.externalPhoneNumber ?? '?',
            clientPhone:   t.client?.phone ?? t.externalPhoneNumber ?? '',
            lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
            lastMessageText: t.lastMessageText,
            unreadCount:   t.unreadCount,
            accountLabel:  ch.accountLabel,
            leadId:        resolved?.id ?? null,
            funnelName:    resolved?.funnelName ?? null,
          };
        })}
        activeChannelId={params.channel ?? null}
        activeThreadId={params.thread ?? null}
        activeMessages={activeMessages}
        activeThread={activeThread ? {
          id:           activeThread.id,
          kind:         resolveThreadChannel(activeThread).kind,
          clientId:     activeThread.client?.id ?? null,
          clientName:   activeThread.client?.fullName ?? activeThread.externalUserName ?? activeThread.externalPhoneNumber ?? '?',
          clientPhone:  activeThread.client?.phone ?? activeThread.externalPhoneNumber ?? '',
          leadId:       resolveLead(activeThread)?.id ?? null,
        } : null}
      />
    </>
  );
}

/**
 * Превращает ?channel=<accountId> в Prisma where для поиска по нужному типу.
 * Ищет accountId в одном из 4 типов и возвращает соответствующий фильтр.
 * Если не нашёл — возвращает null (тогда покажем все доступные).
 */
function resolveChannelFilter(
  accountId: string,
  waIds: string[], tgIds: string[], viberIds: string[], metaIds: string[],
) {
  const base = { isArchived: false };
  if (waIds.includes(accountId))    return { ...base, whatsappAccountId: accountId };
  if (tgIds.includes(accountId))    return { ...base, telegramAccountId: accountId };
  if (viberIds.includes(accountId)) return { ...base, viberAccountId:    accountId };
  if (metaIds.includes(accountId))  return { ...base, metaAccountId:     accountId };
  return null;
}
