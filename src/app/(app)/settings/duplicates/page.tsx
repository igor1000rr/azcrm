// Настройки → Дубликаты клиентов
//
// 06.05.2026 — пункт #2.3 аудита. UI для mergeClients server action'а.
//
// ПОКАЗЫВАЕМ:
//   - Группы клиентов с одинаковым fullName (потенциальные дубли).
//   - Для каждого клиента в группе: phone, source, кол-во leads/threads/calls.
//   - Клиенты с fake-phone (tg:* / vb:* / meta:*) выделяются ярлыком «fake»
//     — вероятные кандидаты на слияние в клиента с реальным номером.
//
// Доступ: только ADMIN.
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { DuplicatesView } from './duplicates-view';

export const dynamic = 'force-dynamic';

export default async function DuplicatesPage() {
  await requireAdmin();

  // Группируем по fullName, берём те у которых > 1 клиента.
  // having + groupBy — эффективный SQL aggregate, работает быстро даже
  // на 1000+ клиентов.
  const groups = await db.client.groupBy({
    by: ['fullName'],
    where: { isArchived: false },
    having: { fullName: { _count: { gt: 1 } } },
    _count: { id: true },
    orderBy: { _count: { id: 'desc' } },
    take: 100,
  });

  // Для каждой группы подгружаем самих клиентов + счётчики связанных.
  // Параллельно через Promise.all — иначе страница открывается медленно при много
  // дублей.
  const groupsWithClients = await Promise.all(
    groups.map(async (g) => {
      const clients = await db.client.findMany({
        where:  { fullName: g.fullName, isArchived: false },
        select: {
          id: true, fullName: true, phone: true, email: true,
          source: true, createdAt: true,
          _count: { select: { leads: true, chatThreads: true, calls: true, files: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      return {
        fullName: g.fullName,
        clients:  clients.map((c) => ({
          id:        c.id,
          fullName:  c.fullName,
          phone:     c.phone,
          email:     c.email,
          source:    c.source,
          createdAt: c.createdAt.toISOString(),
          isFake:    c.phone.startsWith('tg:') || c.phone.startsWith('vb:') || c.phone.startsWith('meta:'),
          counts:    c._count,
        })),
      };
    }),
  );

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Настройки' },
          { label: 'Дубликаты клиентов' },
        ]}
      />
      <DuplicatesView groups={groupsWithClients} />
    </>
  );
}
