// Финансы → Услуги (прайс-лист). Только ADMIN.
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ServicesView } from './services-view';

export const dynamic = 'force-dynamic';

export default async function ServicesPage() {
  await requireAdmin();

  const [services, funnels, setting] = await Promise.all([
    db.service.findMany({
      orderBy: [{ isActive: 'desc' }, { position: 'asc' }, { name: 'asc' }],
      include: { funnel: { select: { id: true, name: true } } },
    }),
    db.funnel.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }),
    db.setting.findUnique({ where: { key: 'commission.startFromPaymentNumber' } }),
  ]);

  const startFromN = Number(setting?.value ?? 2) === 1 ? 1 : 2;

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'Финансы' }, { label: 'Услуги' }]} />
      <ServicesView
        services={services.map((s) => ({
          id: s.id,
          name: s.name,
          description: s.description,
          basePrice: Number(s.basePrice),
          salesCommissionPercent: Number(s.salesCommissionPercent),
          legalCommissionPercent: Number(s.legalCommissionPercent),
          funnelId: s.funnelId,
          funnelName: s.funnel?.name ?? null,
          position: s.position,
          isActive: s.isActive,
        }))}
        funnels={funnels}
        commissionStartFromN={startFromN}
      />
    </>
  );
}
