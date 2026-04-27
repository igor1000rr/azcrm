'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

const schema = z.object({
  id:       z.string().optional(),
  name:     z.string().min(1).max(120),
  body:     z.string().min(1),
  category: z.string().nullable().optional(),
  isActive: z.boolean().default(true),
});

export async function upsertChatTemplate(input: z.infer<typeof schema>) {
  await requireAdmin();
  const data = schema.parse(input);

  if (data.id) {
    await db.chatTemplate.update({
      where: { id: data.id },
      data: {
        name: data.name, body: data.body,
        category: data.category || null, isActive: data.isActive,
      },
    });
  } else {
    await db.chatTemplate.create({
      data: {
        name: data.name, body: data.body,
        category: data.category || null, isActive: data.isActive,
      },
    });
  }

  revalidatePath('/settings/chat-templates');
  return { ok: true };
}

export async function deleteChatTemplate(id: string) {
  await requireAdmin();
  await db.chatTemplate.delete({ where: { id } });
  revalidatePath('/settings/chat-templates');
  return { ok: true };
}
