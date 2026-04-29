// Страница карточки лида (полная информация по делу)
// URL: /clients/:id  где id = leadId
// Без табов, всё на одной длинной странице со скроллом

import { notFound } from 'next/navigation';
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { canViewLead, whatsappAccountFilter } from '@/lib/permissions';
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
      workCity:      { select: { id: true, name: true } },
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
      service: { select: { id: true, name: true } },
      services: {
        orderBy: { position: 'asc' },
        include: { service: { select: { id: true, name: true } } },
      },
    },
  });

  if (!lead) notFound();
  if (!canViewLead(user, lead)) notFound();

  const allStages = await db.stage.findMany({
    where: { funnelId: lead.funnelId },
    orderBy: { position: 'asc' },
  });

  const team = await db.user.findMany({
    where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
    select: { id: true, name: true, email: true, role: true },
    orderBy: { name: 'asc' },
  });

  // Пелномоцники: менеджеры легализации + админы (Anna просила «легализация + я»)
  const attorneys = await db.user.findMany({
    where: { isActive: true, role: { in: ['LEGAL', 'ADMIN'] } },
    select: { id: true, name: true, role: true },
    orderBy: [{ role: 'asc' }, { name: 'asc' }],
  });

  // Города (для селекта «город работы») и каталог услуг (для multi-service редактора)
  const [cities, allServices] = await Promise.all([
    db.city.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true },
    }),
    db.service.findMany({
      where: { isActive: true },
      orderBy: { position: 'asc' },
      select: { id: true, name: true, basePrice: true },
    }),
  ]);

  const clientFiles = await db.clientFile.findMany({
    where: { clientId: lead.clientId },
    orderBy: { createdAt: 'desc' },
    take: 30,
    include: { uploadedBy: { select: { id: true, name: true } } },
  });

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

  // ============ ОБЪЕДИНЁННАЯ ПЕРЕПИСКА КЛИЕНТА ============
  // Anna хочет видеть всю историю общения по клиенту независимо от
  // того с какого канала писали. Собираем сообщения со всех каналов
  // которые пользователю доступны (через whatsappAccountFilter).
  //
  // Также подгружаем СПИСОК доступных каналов для селектора при ответе:
  //   ADMIN — все активные
  //   SALES/LEGAL — свои (ownerId == user.id) + общие (ownerId == null)

  const visibleAccountFilter = whatsappAccountFilter(user);

  const clientThreads = await db.chatThread.findMany({
    where: {
      clientId:        lead.clientId,
      channel:         'WHATSAPP',
      whatsappAccount: visibleAccountFilter,
    },
    select: { id: true },
  });
  const threadIds = clientThreads.map((t) => t.id);

  const chatMessagesRaw = threadIds.length === 0 ? [] : await db.chatMessage.findMany({
    where: { threadId: { in: threadIds } },
    orderBy: { createdAt: 'asc' },
    take: 500,                                         // последние 500 — хватит для большинства лидов
    include: {
      sender:          { select: { name: true } },
      whatsappAccount: { select: { id: true, label: true } },
    },
  });

  const availableChatAccounts = await db.whatsappAccount.findMany({
    where: { isActive: true, ...visibleAccountFilter },
    select: {
      id:          true,
      label:       true,
      phoneNumber: true,
      isConnected: true,
      ownerId:     true,
    },
    orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],   // общие (ownerId=null) первыми
  });

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
          serviceName:  lead.service?.name ?? null,
          employerName: lead.employerName,
          employerPhone: lead.employerPhone,
          totalAmount:  total,
          firstContactAt: lead.firstContactAt?.toISOString() ?? null,
          fingerprintDate: lead.fingerprintDate?.toISOString() ?? null,
          fingerprintLocation: lead.fingerprintLocation,
          // Дата подачи в уженд (Anna 30.04.2026 — «волшебная штучка»)
          submittedAt:  lead.submittedAt?.toISOString() ?? null,
          isArchived:   lead.isArchived,
          summary:      lead.summary,
          paid,
          debt,
          createdAt:    lead.createdAt.toISOString(),
        }}
        client={{
          id:             lead.client.id,
          fullName:       lead.client.fullName,
          birthDate:      lead.client.birthDate?.toISOString() ?? null,
          nationality:    lead.client.nationality,
          phone:          lead.client.phone,
          altPhone:       lead.client.altPhone,
          altPhone2:      lead.client.altPhone2,
          altPhone3:      lead.client.altPhone3,
          email:          lead.client.email,
          addressPL:      lead.client.addressPL,
          addressHome:    lead.client.addressHome,
          // Легальный побыт — тип и срок (Anna 29.04.2026)
          legalStayType:  lead.client.legalStayType,
          legalStayUntil: lead.client.legalStayUntil?.toISOString() ?? null,
          // Срок паспорта (Anna идея №7 «Календарь сроков виз и документов»)
          passportExpiresAt: lead.client.passportExpiresAt?.toISOString() ?? null,
        }}
        city={lead.city ? { id: lead.city.id, name: lead.city.name } : null}
        workCity={lead.workCity ? { id: lead.workCity.id, name: lead.workCity.name } : null}
        cities={cities}
        allServices={allServices.map((s) => ({
          id: s.id, name: s.name, basePrice: Number(s.basePrice),
        }))}
        leadServices={lead.services.map((ls) => ({
          id:          ls.id,
          serviceId:   ls.serviceId,
          serviceName: ls.service.name,
          amount:      Number(ls.amount),
          qty:         ls.qty,
          notes:       ls.notes,
          position:    ls.position,
        }))}
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
        attorneys={attorneys}
        chatMessages={chatMessagesRaw.map((m) => ({
          id:           m.id,
          direction:    m.direction,
          type:         m.type,
          body:         m.body,
          mediaUrl:     m.mediaUrl,
          mediaName:    m.mediaName,
          createdAt:    m.createdAt.toISOString(),
          isRead:       m.isRead,
          deliveredAt:  m.deliveredAt?.toISOString() ?? null,
          senderName:   m.sender?.name ?? null,
          accountId:    m.whatsappAccount?.id ?? '',
          accountLabel: m.whatsappAccount?.label ?? '?',
        }))}
        availableChatAccounts={availableChatAccounts.map((a) => ({
          id:          a.id,
          label:       a.label,
          phoneNumber: a.phoneNumber,
          isConnected: a.isConnected,
          isShared:    a.ownerId === null,
        }))}
      />
    </>
  );
}
