'use server';

// Server Actions для управления WhatsApp каналами
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { workerDisconnect } from '@/lib/whatsapp';
import { normalizePhone } from '@/lib/utils';

const upsertSchema = z.object({
  id:          z.string().optional(),
  phoneNumber: z.string().min(5),
  label:       z.string().min(1).max(80),
  ownerId:     z.string().nullable().optional(),
});

export async function upsertWhatsappAccount(input: z.infer<typeof upsertSchema>) {
  await requireAdmin();
  const data = upsertSchema.parse(input);
  const phone = normalizePhone(data.phoneNumber);

  if (data.id) {
    await db.whatsappAccount.update({
      where: { id: data.id },
      data: {
        phoneNumber: phone,
        label:       data.label,
        ownerId:     data.ownerId ?? null,
      },
    });
  } else {
    await db.whatsappAccount.create({
      data: {
        phoneNumber: phone,
        label:       data.label,
        ownerId:     data.ownerId ?? null,
        isActive:    true,
      },
    });
  }

  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function deleteWhatsappAccount(id: string) {
  await requireAdmin();

  // Сначала отключаем worker
  try { await workerDisconnect(id); } catch {}

  await db.whatsappAccount.delete({ where: { id } });
  revalidatePath('/settings/channels');
  return { ok: true };
}

export async function toggleWhatsappAccount(id: string, isActive: boolean) {
  await requireAdmin();
  await db.whatsappAccount.update({
    where: { id },
    data:  { isActive },
  });
  revalidatePath('/settings/channels');
  return { ok: true };
}
