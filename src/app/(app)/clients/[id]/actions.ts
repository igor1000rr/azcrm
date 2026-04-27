'use server';

// Редактирование клиента + удаление файлов
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canEditLead } from '@/lib/permissions';
import { normalizePhone } from '@/lib/utils';
import { audit } from '@/lib/audit';

const clientSchema = z.object({
  id:          z.string(),
  fullName:    z.string().min(2).max(200),
  phone:       z.string().min(5),
  altPhone:    z.string().nullable().optional(),
  email:       z.string().email().nullable().optional().or(z.literal('')),
  birthDate:   z.string().nullable().optional(),
  nationality: z.string().nullable().optional(),
  addressPL:   z.string().nullable().optional(),
  addressHome: z.string().nullable().optional(),
  cityId:      z.string().nullable().optional(),
});

export async function updateClient(input: z.infer<typeof clientSchema>) {
  const user = await requireUser();
  const data = clientSchema.parse(input);

  // Проверка прав: должен быть доступ хотя бы к одному лиду этого клиента
  const client = await db.client.findUnique({
    where: { id: data.id },
    include: {
      leads: {
        select: { salesManagerId: true, legalManagerId: true },
        take: 1,
      },
    },
  });
  if (!client) throw new Error('Клиент не найден');
  if (
    user.role !== 'ADMIN'
    && !client.leads.some((l) => canEditLead(user, l))
  ) {
    throw new Error('Недостаточно прав');
  }

  const before = {
    fullName: client.fullName, phone: client.phone, email: client.email,
  };

  const newPhone = normalizePhone(data.phone);
  // Проверка что новый телефон не занят другим клиентом
  if (newPhone !== client.phone) {
    const dup = await db.client.findUnique({ where: { phone: newPhone } });
    if (dup && dup.id !== client.id) {
      throw new Error('Этот телефон уже привязан к другому клиенту');
    }
  }

  await db.client.update({
    where: { id: data.id },
    data: {
      fullName:    data.fullName,
      phone:       newPhone,
      altPhone:    data.altPhone || null,
      email:       data.email || null,
      birthDate:   data.birthDate ? new Date(data.birthDate) : null,
      nationality: data.nationality || null,
      addressPL:   data.addressPL || null,
      addressHome: data.addressHome || null,
      cityId:      data.cityId || null,
    },
  });

  await audit({
    userId:     user.id,
    action:     'client.update',
    entityType: 'Client',
    entityId:   data.id,
    before,
    after:      { fullName: data.fullName, phone: newPhone, email: data.email },
  });

  // Обновляем все страницы лидов этого клиента
  const leads = await db.lead.findMany({
    where: { clientId: data.id },
    select: { id: true },
  });
  for (const l of leads) revalidatePath(`/clients/${l.id}`);
  revalidatePath('/clients');

  return { ok: true };
}

// Удаление файла клиента
export async function removeClientFile(fileId: string) {
  const user = await requireUser();

  const file = await db.clientFile.findUnique({
    where: { id: fileId },
    include: {
      client: {
        include: { leads: { select: { salesManagerId: true, legalManagerId: true } } },
      },
    },
  });
  if (!file) throw new Error('Файл не найден');

  const hasAccess = user.role === 'ADMIN'
    || file.client.leads.some((l) => canEditLead(user, l));
  if (!hasAccess) throw new Error('Недостаточно прав');

  // Удаляем физический файл
  const m = file.fileUrl.match(/^\/api\/files\/uploads\/(.+)$/);
  if (m) {
    const { removeFile } = await import('@/lib/storage');
    await removeFile('uploads', m[1]);
  }

  await db.clientFile.delete({ where: { id: fileId } });

  // Обновляем все страницы лидов
  const leads = await db.lead.findMany({
    where: { clientId: file.clientId },
    select: { id: true },
  });
  for (const l of leads) revalidatePath(`/clients/${l.id}`);

  return { ok: true };
}
