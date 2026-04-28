// Защищённый layout — авторизация + сайдбар + основная область
import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { Sidebar } from '@/components/sidebar';
import { Providers } from '@/components/providers';
import { leadVisibilityFilter, whatsappAccountFilter } from '@/lib/permissions';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const user = session.user;

  // Если юзер обязан сменить пароль — редирект на отдельный route /change-password
  // (проверяем в БД, а не в JWT — флаг обновляется без перелогина).
  const profile = await db.user.findUnique({
    where: { id: user.id },
    select: { mustChangePassword: true },
  });
  if (profile?.mustChangePassword) {
    redirect('/change-password');
  }

  // Параллельно: счётчики для бейджей в sidebar + WA-каналы
  const [
    leadsActive,
    tasksOpen,
    automationsActive,
    eventsToday,
    inboxUnreadAgg,
    whatsappAccounts,
    teamChatChats,
  ] = await Promise.all([
    db.lead.count({
      where: {
        isArchived: false,
        ...leadVisibilityFilter(user),
      },
    }),
    db.task.count({
      where: {
        status: 'OPEN',
        assigneeId: user.role === 'ADMIN' ? undefined : user.id,
      },
    }),
    db.automation.count({ where: { isActive: true } }),
    db.calendarEvent.count({
      where: {
        ownerId: user.role === 'ADMIN' ? undefined : user.id,
        startsAt: {
          gte: new Date(new Date().setHours(0, 0, 0, 0)),
          lt:  new Date(new Date().setHours(23, 59, 59, 999)),
        },
      },
    }),
    db.chatThread.aggregate({
      where: {
        whatsappAccount: whatsappAccountFilter(user),
      },
      _sum: { unreadCount: true },
    }),
    db.whatsappAccount.findMany({
      where: { isActive: true, ...whatsappAccountFilter(user) },
      select: {
        id: true,
        label: true,
        phoneNumber: true,
        ownerId: true,
        threads: {
          select: { unreadCount: true },
        },
      },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.teamChat.findMany({
      where: { members: { some: { userId: user.id } } },
      select: {
        lastMessageAt: true,
        members: { where: { userId: user.id }, select: { lastReadAt: true } },
      },
    }),
  ]);

  const inboxUnread = inboxUnreadAgg._sum.unreadCount ?? 0;

  // Подсчёт непрочитанных team-chat: чат имеет lastMessageAt > lastReadAt
  const teamChatUnread = teamChatChats.filter((c) => {
    const lastRead = c.members[0]?.lastReadAt;
    return c.lastMessageAt && (!lastRead || c.lastMessageAt > lastRead);
  }).length;

  // Счётчик «просроченные оплаты» отдаём посчёт на страницу /payments —
  // в сайдбаре бейдж отсутствует вместо фонового тяжёлого запроса.
  const counters = {
    inboxUnread,
    leadsActive,
    eventsToday,
    paymentsOverdue: 0,
    tasksOpen,
    automationsActive,
    teamChatUnread,
  };

  const waForSidebar = whatsappAccounts.map((wa) => ({
    id:          wa.id,
    label:       wa.label,
    phoneNumber: wa.phoneNumber,
    isOwn:       wa.ownerId === user.id || wa.ownerId === null,
    unread:      wa.threads.reduce((s, t) => s + t.unreadCount, 0),
  }));

  return (
    <Providers>
      <div className="flex min-h-dvh">
        <Sidebar
          user={user}
          counters={counters}
          whatsappAccounts={waForSidebar}
        />
        <main className="flex-1 min-w-0 flex flex-col">{children}</main>
      </div>
    </Providers>
  );
}
