// Inbox — переписки с клиентами по WhatsApp
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter } from '@/lib/permissions';
import { InboxView } from './inbox-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ thread?: string; channel?: string }>;
}

export default async function InboxPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;

  // Каналы доступные пользователю
  const accounts = await db.whatsappAccount.findMany({
    where: { isActive: true, ...whatsappAccountFilter(user) },
    select: {
      id: true, label: true, phoneNumber: true,
      isConnected: true, ownerId: true,
    },
    orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
  });

  // Треды (ограничены каналами доступа)
  const threadsWhere = {
    channel: 'WHATSAPP' as const,
    isArchived: false,
    whatsappAccountId: params.channel
      ? params.channel
      : { in: accounts.map((a) => a.id) },
  };

  const threads = await db.chatThread.findMany({
    where: threadsWhere,
    orderBy: { lastMessageAt: 'desc' },
    take: 100,
    include: {
      client: { select: { id: true, fullName: true, phone: true } },
      whatsappAccount: { select: { id: true, label: true, phoneNumber: true } },
      lead: { select: { id: true, funnel: { select: { name: true } } } },
    },
  });

  // Если открыт thread — подгружаем сообщения
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

      // Помечаем прочитанным
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
        threads={threads.map((t) => ({
          id: t.id,
          clientName:    t.client?.fullName ?? t.externalUserName ?? t.externalPhoneNumber ?? '?',
          clientPhone:   t.client?.phone ?? t.externalPhoneNumber ?? '',
          lastMessageAt: t.lastMessageAt?.toISOString() ?? null,
          lastMessageText: t.lastMessageText,
          unreadCount:   t.unreadCount,
          accountLabel:  t.whatsappAccount?.label ?? null,
          leadId:        t.lead?.id ?? null,
          funnelName:    t.lead?.funnel.name ?? null,
        }))}
        activeChannelId={params.channel ?? null}
        activeThreadId={params.thread ?? null}
        activeMessages={activeMessages}
        activeThread={activeThread ? {
          id:           activeThread.id,
          accountId:    activeThread.whatsappAccountId ?? '',
          clientId:     activeThread.client?.id ?? null,
          clientName:   activeThread.client?.fullName ?? activeThread.externalUserName ?? activeThread.externalPhoneNumber ?? '?',
          clientPhone:  activeThread.client?.phone ?? activeThread.externalPhoneNumber ?? '',
          leadId:       activeThread.lead?.id ?? null,
        } : null}
      />
    </>
  );
}
