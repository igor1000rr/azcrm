// Календарь работы — менеджер сам отмечает рабочие часы.
// Админ может выбрать любого сотрудника.
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canViewAllWorkLogs } from '@/lib/permissions';
import { WorkCalendarView } from './work-calendar-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ user?: string; year?: string; month?: string }>;
}

export default async function WorkCalendarPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;

  const isAdmin = canViewAllWorkLogs(user);
  const targetUserId = isAdmin ? (params.user || user.id) : user.id;

  const now = new Date();
  const year = params.year ? Number(params.year) : now.getFullYear();
  const month = params.month ? Number(params.month) - 1 : now.getMonth(); // 0..11

  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0, 23, 59, 59);

  const [logs, allUsers, target] = await Promise.all([
    db.workLog.findMany({
      where: { userId: targetUserId, date: { gte: monthStart, lte: monthEnd } },
      orderBy: { date: 'asc' },
    }),
    isAdmin
      ? db.user.findMany({
          where: { isActive: true, role: { in: ['SALES', 'LEGAL', 'ADMIN'] } },
          select: { id: true, name: true, role: true },
          orderBy: { name: 'asc' },
        })
      : [],
    db.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, name: true, role: true },
    }),
  ]);

  const totalHours = logs.reduce((s, l) => s + Number(l.hours), 0);
  const workDays = logs.length;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Календарь работы' }]} />

      <WorkCalendarView
        year={year}
        month={month}
        targetUser={target ? { id: target.id, name: target.name, role: target.role } : null}
        canPickUser={isAdmin}
        allUsers={allUsers}
        canEdit={isAdmin || targetUserId === user.id}
        logs={logs.map((l) => ({
          date: l.date.toISOString().slice(0, 10),
          startTime: l.startTime,
          endTime: l.endTime,
          hours: Number(l.hours),
          notes: l.notes,
        }))}
        totals={{ totalHours, workDays }}
      />
    </>
  );
}
