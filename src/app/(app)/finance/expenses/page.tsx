// Финансы → Расходы. Только ADMIN.
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ExpensesView } from './expenses-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ from?: string; to?: string; city?: string }>;
}

export default async function ExpensesPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;

  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1);
  const defaultTo = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  const from = params.from ? new Date(params.from) : defaultFrom;
  const to = params.to ? new Date(params.to + 'T23:59:59') : defaultTo;

  const where = {
    spentAt: { gte: from, lte: to },
    ...(params.city && params.city !== 'all' ? { cityId: params.city } : {}),
  };

  const [expenses, cities] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: { spentAt: 'desc' },
      take: 500,
      include: {
        city: { select: { id: true, name: true } },
        createdBy: { select: { name: true } },
      },
    }),
    db.city.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }),
  ]);

  // Суммы по городам
  const byCity = new Map<string, { id: string; name: string; total: number; count: number }>();
  for (const e of expenses) {
    const k = e.city?.id ?? '__none__';
    const name = e.city?.name ?? 'Без города';
    if (!byCity.has(k)) byCity.set(k, { id: k, name, total: 0, count: 0 });
    const v = byCity.get(k)!;
    v.total += Number(e.amount);
    v.count += 1;
  }
  const byCityArr = [...byCity.values()].sort((a, b) => b.total - a.total);

  // Суммы по категориям
  const byCategory = new Map<string, number>();
  for (const e of expenses) {
    byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + Number(e.amount));
  }
  const byCategoryArr = [...byCategory.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);

  const totalAmount = expenses.reduce((s, e) => s + Number(e.amount), 0);

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Финансы' }, { label: 'Расходы' }]} />
      <ExpensesView
        expenses={expenses.map((e) => ({
          id: e.id,
          cityId: e.cityId,
          cityName: e.city?.name ?? null,
          category: e.category,
          amount: Number(e.amount),
          spentAt: e.spentAt.toISOString(),
          description: e.description,
          fileUrl: e.fileUrl,
          fileName: e.fileName,
          createdByName: e.createdBy?.name ?? null,
        }))}
        cities={cities}
        byCity={byCityArr}
        byCategory={byCategoryArr}
        totalAmount={totalAmount}
        currentFilters={{
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          city: params.city ?? 'all',
        }}
      />
    </>
  );
}
