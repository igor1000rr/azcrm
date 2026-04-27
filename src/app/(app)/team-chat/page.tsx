// Внутренние чаты команды
// 3-колоночный интерфейс: список людей/групп / тред / детали
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { TeamChatView } from './team-chat-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ chat?: string }>;
}

export default async function TeamChatPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;

  // Все чаты юзера
  const chats = await db.teamChat.findMany({
    where: { members: { some: { userId: user.id } } },
    orderBy: { lastMessageAt: 'desc' },
    include: {
      members: { include: { user: { select: { id: true, name: true, role: true, isActive: true } } } },
    },
  });

  // Список всех остальных юзеров — для создания нового чата
  const team = await db.user.findMany({
    where: { isActive: true, id: { not: user.id } },
    select: { id: true, name: true, role: true, email: true },
    orderBy: { name: 'asc' },
  });

  // Активный чат + сообщения
  let activeMessages: Array<{
    id: string;
    body: string;
    authorId: string;
    authorName: string;
    createdAt: string;
    isMine: boolean;
  }> = [];

  let activeChat: typeof chats[0] | null = null;

  if (params.chat) {
    activeChat = chats.find((c) => c.id === params.chat) ?? null;
    if (activeChat) {
      const msgs = await db.teamChatMessage.findMany({
        where: { chatId: params.chat },
        orderBy: { createdAt: 'asc' },
        take: 200,
        include: { author: { select: { id: true, name: true } } },
      });

      activeMessages = msgs.map((m) => ({
        id: m.id,
        body: m.body,
        authorId: m.authorId,
        authorName: m.author.name,
        createdAt: m.createdAt.toISOString(),
        isMine: m.authorId === user.id,
      }));

      // Помечаем lastReadAt
      await db.teamChatMember.updateMany({
        where: { chatId: params.chat, userId: user.id },
        data:  { lastReadAt: new Date() },
      });
    }
  }

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Чат команды' }]} />

      <TeamChatView
        currentUserId={user.id}
        chats={chats.map((c) => {
          const otherMembers = c.members.filter((m) => m.userId !== user.id);
          // Для DIRECT берём имя другого участника, для GROUP — сохранённое имя
          const title = c.kind === 'GROUP'
            ? c.name ?? 'Группа'
            : otherMembers[0]?.user.name ?? 'Чат';
          const myMember = c.members.find((m) => m.userId === user.id);
          // Считаем непрочитанные — нет точного хранения, упрощаем по lastReadAt
          const unread = myMember?.lastReadAt && c.lastMessageAt && c.lastMessageAt > myMember.lastReadAt
            ? 1 : 0;
          return {
            id:    c.id,
            kind:  c.kind,
            title,
            otherMembers: otherMembers.map((m) => ({
              id: m.user.id, name: m.user.name, role: m.user.role,
            })),
            lastMessageText: c.lastMessageText,
            lastMessageAt:   c.lastMessageAt?.toISOString() ?? null,
            unread,
          };
        })}
        team={team}
        activeChatId={activeChat?.id ?? null}
        activeChatTitle={
          activeChat
            ? (activeChat.kind === 'GROUP'
                ? activeChat.name ?? 'Группа'
                : activeChat.members.find((m) => m.userId !== user.id)?.user.name ?? '?')
            : null
        }
        activeChatMembers={
          activeChat?.members.map((m) => ({
            id: m.user.id, name: m.user.name, role: m.user.role,
          })) ?? []
        }
        activeMessages={activeMessages}
      />
    </>
  );
}
