// Настройки → Команда
// Anna добавляет/деактивирует пользователей, меняет роли и пароли
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { TeamView } from './team-view';

export const dynamic = 'force-dynamic';

export default async function TeamPage() {
  await requireAdmin();

  const users = await db.user.findMany({
    orderBy: [{ isActive: 'desc' }, { role: 'asc' }, { name: 'asc' }],
    select: {
      id: true, email: true, name: true, role: true, phone: true,
      isActive: true, lastSeenAt: true, createdAt: true,
      googleConnectedAt: true,
      commissionPercent: true,
      _count: {
        select: {
          salesLeads: { where: { isArchived: false } },
          legalLeads: { where: { isArchived: false } },
        },
      },
    },
  });

  return (
    <>
      <Topbar
        breadcrumbs={[{ label: 'CRM' }, { label: 'Настройки' }, { label: 'Команда' }]}
      />

      <TeamView
        users={users.map((u) => ({
          id: u.id, email: u.email, name: u.name, role: u.role,
          phone: u.phone, isActive: u.isActive,
          lastSeenAt: u.lastSeenAt?.toISOString() ?? null,
          createdAt:  u.createdAt.toISOString(),
          googleConnected: !!u.googleConnectedAt,
          commissionPercent: u.commissionPercent != null ? Number(u.commissionPercent) : null,
          activeLeadsCount: u._count.salesLeads + u._count.legalLeads,
        }))}
      />
    </>
  );
}
