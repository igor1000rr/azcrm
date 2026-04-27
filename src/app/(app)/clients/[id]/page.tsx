// Страница карточки лида (полная информация по делу)
// URL: /clients/:id  где id = leadId
// Без табов, всё на одной длинной странице со скроллом

import { notFound } from 'next/navigation';
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canViewLead } from '@/lib/permissions';
import { LeadCardView } from './lead-card-view';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function LeadPage({ params }: PageProps) {
  const { id } = await params;
  const user = await requireUser();

  const lead = await db.lead.findUnique({
    where: { id },
    include: {
      client:        true,
      funnel:        { select: { id: true, name: true, color: true } },
      stage:         { select: { id: true, name: true, color: true, position: true } },
      city:          { select: { id: true, name: true } },
      salesManager:  { select: { id: true, name: true, email: true } },
      legalManager:  { select: { id: true, name: true, email: true } },
      documents:     { orderBy: { position: 'asc' } },
      payments: {
        orderBy: { paidAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true } } },
      },
      notes: {
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { author: { select: { id: true, name: true, email: true } } },
      },
      events: {
        orderBy: { createdAt: 'desc' },
        take: 30,
        include: { author: { select: { id: true, name: true } } },
      },
      calendarEvents: {
        orderBy: { startsAt: 'asc' },
        include: { owner: { select: { id: true, name: true } } },
      },
      internalDocs: {
        where: { parentId: null }, // только корневые версии
        orderBy: { updatedAt: 'desc' },
        include: { createdBy: { select: { id: true, name: true } } },
      },
      whatsappAccount: { select: { id: true, label: true, phoneNumber: true } },
    },
  });

  if (!lead) notFound();

  if (!canViewLead(user, lead)) {
    notFound(); // не показываем что лид существует, если нет прав
  }

  // Все этапы воронки лида (для прогресс-бара)
  const allStages = await db.stage.findMany({
    where: { funnelId: lead.funnelId },
    orderBy: { position: 'asc' },
  });

  // Команда (для выпадашек переназначения)
  const team = await db.user.findMany({
    where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });

  // Все файлы клиента (общая папка, не привязано к лиду)
  const clientFiles = await db.clientFile.findMany({
    where: { clientId: lead.clientId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

  // Другие лиды этого клиента (для блока "другие дела клиента")
  const otherLeads = await db.lead.findMany({
    where: { clientId: lead.clientId, id: { not: lead.id } },
    select: {
      id: true,
      funnel: { select: { name: true } },
      stage:  { select: { name: true, color: true, isFinal: true, isLost: true } },
      createdAt: true,
      isArchived: true,
    },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Подсчёт финансов
  const paid = lead.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const total = Number(lead.totalAmount);
  const debt = Math.max(0, total - paid);

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Воронки', href: `/funnel?funnel=${lead.funnel.id}` },
          { label: lead.client.fullName },
        ]}
      />

      <LeadCardView
        currentUser={user}
        lead={{
          id:           lead.id,
          stageId:      lead.stage.id,
          funnelId:     lead.funnel.id,
          funnelName:   lead.funnel.name,
          stageName:    lead.stage.name,
          source:       lead.source,
          attorney:     lead.attorney,
          totalAmount:  total,
          firstContactAt: lead.firstContactAt?.toISOString() ?? null,
          fingerprintDate: lead.fingerprintDate?.toISOString() ?? null,
          fingerprintLocation: lead.fingerprintLocation,
          isArchived:   lead.isArchived,
          summary:      lead.summary,
          paid,
          debt,
          createdAt:    lead.createdAt.toISOString(),
        }}
        client={{
          id:          lead.client.id,
          fullName:    lead.client.fullName,
          birthDate:   lead.client.birthDate?.toISOString() ?? null,
          nationality: lead.client.nationality,
          phone:       lead.client.phone,
          altPhone:    lead.client.altPhone,
          email:       lead.client.email,
          addressPL:   lead.client.addressPL,
          addressHome: lead.client.addressHome,
        }}
        city={lead.city ? { id: lead.city.id, name: lead.city.name } : null}
        salesManager={lead.salesManager}
        legalManager={lead.legalManager}
        whatsappAccount={lead.whatsappAccount}
        stages={allStages.map((s) => ({
          id: s.id, name: s.name, color: s.color, position: s.position,
          isFinal: s.isFinal, isLost: s.isLost,
        }))}
        documents={lead.documents.map((d) => ({
          id: d.id, name: d.name, isPresent: d.isPresent,
          fileUrl: d.fileUrl, fileName: d.fileName, position: d.position,
        }))}
        payments={lead.payments.map((p) => ({
          id:     p.id,
          amount: Number(p.amount),
          method: p.method,
          paidAt: p.paidAt.toISOString(),
          notes:  p.notes,
          author: p.createdBy?.name ?? null,
        }))}
        notes={lead.notes.map((n) => ({
          id:        n.id,
          body:      n.body,
          createdAt: n.createdAt.toISOString(),
          author:    n.author,
        }))}
        events={lead.events.map((e) => ({
          id:        e.id,
          kind:      e.kind,
          message:   e.message,
          createdAt: e.createdAt.toISOString(),
          author:    e.author,
        }))}
        calendarEvents={lead.calendarEvents.map((e) => ({
          id:       e.id,
          kind:     e.kind,
          title:    e.title,
          location: e.location,
          startsAt: e.startsAt.toISOString(),
          endsAt:   e.endsAt?.toISOString() ?? null,
          owner:    e.owner,
          googleId: e.googleId,
        }))}
        internalDocs={lead.internalDocs.map((d) => ({
          id:        d.id,
          name:      d.name,
          format:    d.format,
          fileSize:  d.fileSize,
          fileUrl:   d.fileUrl,
          createdAt: d.createdAt.toISOString(),
          version:   d.version,
          author:    d.createdBy?.name ?? null,
        }))}
        clientFiles={clientFiles.map((f) => ({
          id:        f.id,
          name:      f.name,
          fileUrl:   f.fileUrl,
          fileSize:  f.fileSize,
          mimeType:  f.mimeType,
          category:  f.category,
          createdAt: f.createdAt.toISOString(),
          uploader:  f.uploadedBy?.name ?? null,
        }))}
        otherLeads={otherLeads.map((l) => ({
          id:         l.id,
          funnelName: l.funnel.name,
          stageName:  l.stage.name,
          stageColor: l.stage.color,
          isFinal:    l.stage.isFinal,
          isLost:     l.stage.isLost,
          isArchived: l.isArchived,
          createdAt:  l.createdAt.toISOString(),
        }))}
        team={team}
      />
    </>
  );
}
