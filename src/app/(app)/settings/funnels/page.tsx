// Настройки → Воронки и этапы
// Anna добавляет/удаляет/переименовывает воронки и этапы

import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { FunnelsView } from './funnels-view';

export const dynamic = 'force-dynamic';

export default async function FunnelsSettingsPage() {
  await requireAdmin();

  const funnels = await db.funnel.findMany({
    orderBy: { position: 'asc' },
    include: {
      stages: { orderBy: { position: 'asc' } },
      docTemplates: { orderBy: { position: 'asc' } },
      _count: { select: { leads: true } },
    },
  });

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Настройки' },
          { label: 'Воронки' },
        ]}
      />

      <FunnelsView
        funnels={funnels.map((f) => ({
          id:          f.id,
          name:        f.name,
          description: f.description,
          color:       f.color,
          position:    f.position,
          isActive:    f.isActive,
          leadsCount:  f._count.leads,
          stages: f.stages.map((s) => ({
            id: s.id, name: s.name, color: s.color,
            position: s.position, isFinal: s.isFinal, isLost: s.isLost,
          })),
          docTemplates: f.docTemplates.map((d) => ({
            id: d.id, name: d.name, position: d.position, isRequired: d.isRequired,
          })),
        }))}
      />
    </>
  );
}
