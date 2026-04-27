'use server';

// Управление воронками, этапами, шаблонами документов
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';

// ============ ВОРОНКИ ============

const funnelSchema = z.object({
  id:          z.string().optional(),
  name:        z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  color:       z.string().nullable().optional(),
  position:    z.coerce.number().int().min(0).default(0),
});

export async function upsertFunnel(input: z.infer<typeof funnelSchema>) {
  await requireAdmin();
  const data = funnelSchema.parse(input);

  if (data.id) {
    await db.funnel.update({
      where: { id: data.id },
      data: {
        name:        data.name,
        description: data.description ?? null,
        color:       data.color ?? null,
        position:    data.position,
      },
    });
  } else {
    // Новая воронка — создаём с базовыми этапами
    const created = await db.funnel.create({
      data: {
        name:        data.name,
        description: data.description ?? null,
        color:       data.color ?? '#0A1A35',
        position:    data.position,
        stages: {
          create: [
            { name: 'Новый',          color: '#2563EB', position: 1 },
            { name: 'В работе',       color: '#CA8A04', position: 2 },
            { name: 'Завершён',       color: '#16A34A', position: 3, isFinal: true },
            { name: 'Отказ',          color: '#71717A', position: 4, isFinal: true, isLost: true },
          ],
        },
      },
    });
    return { id: created.id };
  }

  revalidatePath('/settings/funnels');
  revalidatePath('/funnel');
  return { ok: true };
}

export async function deleteFunnel(id: string) {
  await requireAdmin();

  // Проверяем — не используется ли в активных лидах
  const leadsCount = await db.lead.count({ where: { funnelId: id, isArchived: false } });
  if (leadsCount > 0) {
    throw new Error(`Нельзя удалить — есть ${leadsCount} активных лидов в этой воронке`);
  }

  await db.funnel.delete({ where: { id } });
  revalidatePath('/settings/funnels');
  revalidatePath('/funnel');
  return { ok: true };
}

export async function toggleFunnel(id: string, isActive: boolean) {
  await requireAdmin();
  await db.funnel.update({ where: { id }, data: { isActive } });
  revalidatePath('/settings/funnels');
  revalidatePath('/funnel');
  return { ok: true };
}

// ============ ЭТАПЫ ============

const stageSchema = z.object({
  id:       z.string().optional(),
  funnelId: z.string(),
  name:     z.string().min(1).max(80),
  color:    z.string().nullable().optional(),
  position: z.coerce.number().int().min(0),
  isFinal:  z.boolean().default(false),
  isLost:   z.boolean().default(false),
});

export async function upsertStage(input: z.infer<typeof stageSchema>) {
  await requireAdmin();
  const data = stageSchema.parse(input);

  if (data.id) {
    await db.stage.update({
      where: { id: data.id },
      data: {
        name:     data.name,
        color:    data.color ?? null,
        position: data.position,
        isFinal:  data.isFinal,
        isLost:   data.isLost,
      },
    });
  } else {
    // Сдвигаем существующие этапы вниз
    await db.stage.updateMany({
      where: { funnelId: data.funnelId, position: { gte: data.position } },
      data: { position: { increment: 1 } },
    });
    await db.stage.create({
      data: {
        funnelId: data.funnelId,
        name:     data.name,
        color:    data.color ?? '#71717A',
        position: data.position,
        isFinal:  data.isFinal,
        isLost:   data.isLost,
      },
    });
  }

  revalidatePath('/settings/funnels');
  revalidatePath('/funnel');
  return { ok: true };
}

export async function deleteStage(id: string) {
  await requireAdmin();

  const stage = await db.stage.findUnique({
    where: { id },
    include: { _count: { select: { leads: true } } },
  });
  if (!stage) throw new Error('Этап не найден');

  if (stage._count.leads > 0) {
    throw new Error(
      `Нельзя удалить — на этом этапе ${stage._count.leads} лидов. ` +
      `Сначала переведите их на другой этап.`,
    );
  }

  await db.stage.delete({ where: { id } });
  revalidatePath('/settings/funnels');
  revalidatePath('/funnel');
  return { ok: true };
}

export async function reorderStages(funnelId: string, orderedIds: string[]) {
  await requireAdmin();

  await db.$transaction(
    orderedIds.map((id, idx) =>
      db.stage.update({
        where: { id },
        data:  { position: idx + 1 },
      }),
    ),
  );

  revalidatePath('/settings/funnels');
  revalidatePath('/funnel');
  return { ok: true };
}

// ============ ШАБЛОНЫ ДОКУМЕНТОВ (чек-лист) ============

const docTemplateSchema = z.object({
  id:        z.string().optional(),
  funnelId:  z.string(),
  name:      z.string().min(1).max(120),
  position:  z.coerce.number().int().min(0).default(0),
  isRequired: z.boolean().default(true),
});

export async function upsertDocTemplate(input: z.infer<typeof docTemplateSchema>) {
  await requireAdmin();
  const data = docTemplateSchema.parse(input);

  if (data.id) {
    await db.documentTemplate.update({
      where: { id: data.id },
      data: { name: data.name, position: data.position, isRequired: data.isRequired },
    });
  } else {
    await db.documentTemplate.create({
      data: {
        funnelId:   data.funnelId,
        name:       data.name,
        position:   data.position,
        isRequired: data.isRequired,
      },
    });
  }

  revalidatePath('/settings/funnels');
  return { ok: true };
}

export async function deleteDocTemplate(id: string) {
  await requireAdmin();
  await db.documentTemplate.delete({ where: { id } });
  revalidatePath('/settings/funnels');
  return { ok: true };
}
