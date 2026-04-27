// Задачи — Kanban + создание + детали
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { TasksView } from './tasks-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    assignee?: string;
    view?: 'mine' | 'all';
  }>;
}

export default async function TasksPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;
  const view = params.view ?? 'mine';

  // Фильтр: для не-админа всегда только свои; админ может выбрать view=all
  const where = user.role === 'ADMIN' && view === 'all'
    ? (params.assignee ? { assigneeId: params.assignee } : {})
    : { assigneeId: user.id };

  const tasks = await db.task.findMany({
    where,
    orderBy: [
      { status: 'asc' },           // OPEN сначала
      { priority: 'desc' },         // URGENT > HIGH > NORMAL > LOW
      { dueAt: 'asc' },
    ],
    include: {
      assignee: { select: { id: true, name: true } },
      creator:  { select: { id: true, name: true } },
      lead: {
        select: {
          id: true,
          client: { select: { fullName: true } },
        },
      },
    },
  });

  // Для админа — список всех юзеров для фильтра
  const team = user.role === 'ADMIN'
    ? await db.user.findMany({
        where: { isActive: true },
        select: { id: true, name: true, role: true },
        orderBy: { name: 'asc' },
      })
    : [];

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Задачи' }]} />

      <TasksView
        currentUserId={user.id}
        currentUserRole={user.role}
        view={view}
        currentAssignee={params.assignee ?? ''}
        team={team}
        tasks={tasks.map((t) => ({
          id:          t.id,
          title:       t.title,
          description: t.description,
          status:      t.status,
          priority:    t.priority,
          dueAt:       t.dueAt?.toISOString() ?? null,
          completedAt: t.completedAt?.toISOString() ?? null,
          createdAt:   t.createdAt.toISOString(),
          assignee:    t.assignee,
          creator:     t.creator,
          lead:        t.lead ? {
            id: t.lead.id,
            clientName: t.lead.client.fullName,
          } : null,
        }))}
      />
    </>
  );
}
