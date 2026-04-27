'use server';

// Server Actions для внутренних чатов команды
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';

// Создать или открыть DIRECT-чат с другим юзером
export async function openDirectChat(otherUserId: string): Promise<{ chatId: string }> {
  const user = await requireUser();
  if (otherUserId === user.id) throw new Error('Нельзя писать самому себе');

  // Ищем существующий DIRECT-чат между двумя
  const existing = await db.teamChat.findFirst({
    where: {
      kind: 'DIRECT',
      AND: [
        { members: { some: { userId: user.id } } },
        { members: { some: { userId: otherUserId } } },
      ],
    },
    select: { id: true, members: { select: { userId: true } } },
  });

  if (existing && existing.members.length === 2) {
    return { chatId: existing.id };
  }

  // Создаём
  const chat = await db.teamChat.create({
    data: {
      kind: 'DIRECT',
      members: {
        create: [
          { userId: user.id },
          { userId: otherUserId },
        ],
      },
    },
  });

  revalidatePath('/team-chat');
  return { chatId: chat.id };
}

// Создать групповой чат
const createGroupSchema = z.object({
  name:      z.string().min(1).max(80),
  memberIds: z.array(z.string()).min(1),
});

export async function createGroupChat(input: z.infer<typeof createGroupSchema>) {
  const user = await requireUser();
  const data = createGroupSchema.parse(input);

  const memberIds = [...new Set([user.id, ...data.memberIds])];

  const chat = await db.teamChat.create({
    data: {
      kind: 'GROUP',
      name: data.name,
      members: {
        create: memberIds.map((userId) => ({ userId })),
      },
    },
  });

  revalidatePath('/team-chat');
  return { chatId: chat.id };
}

// Отправить сообщение
const sendSchema = z.object({
  chatId: z.string(),
  body:   z.string().min(1).max(5000),
});

export async function sendTeamChatMessage(input: z.infer<typeof sendSchema>) {
  const user = await requireUser();
  const data = sendSchema.parse(input);

  // Проверяем что юзер — участник чата
  const member = await db.teamChatMember.findUnique({
    where: { chatId_userId: { chatId: data.chatId, userId: user.id } },
  });
  if (!member) throw new Error('Не участник этого чата');

  await db.$transaction([
    db.teamChatMessage.create({
      data: {
        chatId:   data.chatId,
        authorId: user.id,
        body:     data.body,
      },
    }),
    db.teamChat.update({
      where: { id: data.chatId },
      data: {
        lastMessageAt:   new Date(),
        lastMessageText: data.body.slice(0, 200),
      },
    }),
    db.teamChatMember.updateMany({
      where: { chatId: data.chatId, userId: user.id },
      data:  { lastReadAt: new Date() },
    }),
  ]);

  // Уведомления остальным участникам
  const otherMembers = await db.teamChatMember.findMany({
    where: { chatId: data.chatId, userId: { not: user.id } },
    select: { userId: true },
  });

  await db.notification.createMany({
    data: otherMembers.map((m) => ({
      userId: m.userId,
      kind:   'NEW_MESSAGE' as const,
      title:  `${user.name}: ${data.body.slice(0, 80)}`,
      link:   `/team-chat?chat=${data.chatId}`,
    })),
  });

  revalidatePath('/team-chat');
  return { ok: true };
}
