// /settings/cities — управление списком городов
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { CitiesView } from './cities-view';

export const dynamic = 'force-dynamic';

export default async function CitiesPage() {
  await requireAdmin();

  const cities = await db.city.findMany({
    orderBy: [{ position: 'asc' }, { name: 'asc' }],
    select: {
      id: true,
      name: true,
      isDefault: true,
      isActive: true,
      _count: {
        select: {
          clients: true,
          leads: true,
          workLeads: true,
          expenses: true,
        },
      },
    },
  });

  // Подготовим суммарный счётчик использования для UI
  const list = cities.map((c) => ({
    id: c.id,
    name: c.name,
    isDefault: c.isDefault,
    isActive: c.isActive,
    usageCount: c._count.clients + c._count.leads + c._count.workLeads + c._count.expenses,
  }));

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Настройки' }, { label: 'Города' }]} />
      <div className="p-4 md:p-5 max-w-[760px] w-full">
        <CitiesView cities={list} />
      </div>
    </>
  );
}
