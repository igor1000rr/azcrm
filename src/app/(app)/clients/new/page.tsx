// Страница создания нового лида
// Сценарии: с нуля (новый клиент) или для существующего клиента (?clientId=...)

import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { whatsappAccountFilter } from '@/lib/permissions';
import { NewLeadForm } from './new-lead-form';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{
    clientId?: string;
    funnel?:   string;
    stage?:    string;
    phone?:    string;
  }>;
}

export default async function NewLeadPage({ searchParams }: PageProps) {
  const user = await requireUser();
  const params = await searchParams;

  // Подгружаем справочники
  const [funnels, cities, team, waAccounts, services, existingClient] = await Promise.all([
    db.funnel.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      include: {
        stages: { orderBy: { position: 'asc' }, select: { id: true, name: true, position: true } },
      },
    }),
    db.city.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
    db.whatsappAccount.findMany({
      where: { isActive: true, ...whatsappAccountFilter(user) },
      select: { id: true, label: true, phoneNumber: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.service.findMany({
      where: { isActive: true },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, basePrice: true, funnelId: true },
    }),
    params.clientId
      ? db.client.findUnique({
          where: { id: params.clientId },
          select: {
            id: true, fullName: true, birthDate: true, nationality: true,
            phone: true, email: true, addressPL: true, addressHome: true,
            cityId: true,
          },
        })
      : null,
  ]);

  if (funnels.length === 0) {
    redirect('/funnel');
  }

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Клиенты', href: '/clients' },
          { label: 'Новый лид' },
        ]}
      />

      <div className="p-4 md:p-6 max-w-[820px] mx-auto w-full">
        <NewLeadForm
          currentUser={user}
          funnels={funnels.map((f) => ({
            id: f.id, name: f.name,
            stages: f.stages,
          }))}
          cities={cities}
          team={team}
          waAccounts={waAccounts}
          services={services.map((s) => ({
            id: s.id, name: s.name, basePrice: Number(s.basePrice), funnelId: s.funnelId,
          }))}
          defaults={{
            funnelId: params.funnel ?? funnels[0].id,
            stageId:  params.stage,
            phone:    params.phone,
          }}
          existingClient={existingClient ? {
            id:          existingClient.id,
            fullName:    existingClient.fullName,
            birthDate:   existingClient.birthDate?.toISOString().slice(0, 10) ?? null,
            nationality: existingClient.nationality,
            phone:       existingClient.phone,
            email:       existingClient.email,
            addressPL:   existingClient.addressPL,
            addressHome: existingClient.addressHome,
            cityId:      existingClient.cityId,
          } : null}
        />
      </div>
    </>
  );
}
