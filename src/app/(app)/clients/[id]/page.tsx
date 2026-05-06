// Страница карточки лида (полная информация по делу)
// URL: /clients/:id  где id = leadId
// Без табов, всё на одной длинной странице со скроллом
//
// 06.05.2026 — #2.20 аудита (производительность): все независимые запросы
// выполняются через Promise.all параллельно. Раньше было ~14 последовательных
// SELECT'ов, итого wall-clock = ~14 × latency. Теперь в две волны:
//   1. lead.findUnique — требуется для canViewLead и выбора funnelId/clientId
//   2. всё остальное параллельно (12 queries) + chatMessages после threads.
// На medium-loaded БД это даёт разницу в ~3-5x по времени открытия карточки.

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

  // ============ ВОЛНА 1: lead + permissions check ============
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
        where: { parentId: null },
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

  // ============ ВОЛНА 2: всё остальное параллельно ============
  // 12 запросов к БД в одном Promise.all. Все они либо от user, либо от
  // уже известных lead.funnelId / lead.clientId / lead.id — значит индепендент.
  const sendableAccountFilter = user.role === 'ADMIN'
    ? { isActive: true }
    : { isActive: true, OR: [{ ownerId: user.id }, { ownerId: null }] };

  const [
    allStages,
    allFunnels,
    team,
    attorneys,
    cities,
    allServices,
    clientFiles,
    otherLeads,
    waAccs,
    tgAccs,
    viberAccs,
    metaAccs,
    clientThreads,
    calls,
  ] = await Promise.all([
    db.stage.findMany({
      where: { funnelId: lead.funnelId },
      orderBy: { position: 'asc' },
    }),
    db.funnel.findMany({
      where: { OR: [{ isActive: true }, { id: lead.funnelId }] },
      orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      include: {
        stages: {
          orderBy: { position: 'asc' },
          select: { id: true, name: true, position: true },
        },
      },
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ['SALES', 'LEGAL'] } },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: 'asc' },
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ['LEGAL', 'ADMIN'] } },
      select: { id: true, name: true, role: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    }),
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
    db.clientFile.findMany({
      where: { clientId: lead.clientId },
      orderBy: { createdAt: 'desc' },
      take: 30,
      include: { uploadedBy: { select: { id: true, name: true } } },
    }),
    db.lead.findMany({
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
    }),
    db.whatsappAccount.findMany({
      where:  sendableAccountFilter,
      select: { id: true, label: true, phoneNumber: true, isConnected: true, ownerId: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.telegramAccount.findMany({
      where:  sendableAccountFilter,
      select: { id: true, label: true, botUsername: true, isConnected: true, ownerId: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.viberAccount.findMany({
      where:  sendableAccountFilter,
      select: { id: true, label: true, paName: true, isConnected: true, ownerId: true },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.metaAccount.findMany({
      where:  sendableAccountFilter,
      select: {
        id: true, label: true, pageName: true, igUsername: true,
        hasMessenger: true, hasInstagram: true, isConnected: true, ownerId: true,
      },
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
    }),
    db.chatThread.findMany({
      where: { clientId: lead.clientId },
      select: {
        id: true, channel: true, lastMessageAt: true,
        whatsappAccountId: true, telegramAccountId: true,
        viberAccountId: true, metaAccountId: true,
      },
      orderBy: { lastMessageAt: 'desc' },
    }),
    db.call.findMany({
      where: { leadId: lead.id },
      orderBy: { startedAt: 'desc' },
      take: 10,
      select: {
        id:               true,
        direction:        true,
        fromNumber:       true,
        toNumber:         true,
        startedAt:        true,
        durationSec:      true,
        recordUrl:        true,
        recordLocalUrl:   true,
        transcript:       true,
        transcriptStatus: true,
        sentiment:        true,
        analysisSummary:  true,
        analysisTags:     true,
      },
    }),
  ]);

  const threadIds = clientThreads.map((t) => t.id);

  // ============ ВОЛНА 3: chatMessages (нужны threadIds из волны 2) ============
  // 06.05.2026 — пункт #27 аудита: раньше было orderBy: 'asc' + take: 500.
  // Если у клиента >500 сообщений — показывались САМЫЕ СТАРЫЕ, а свежие обрезались.
  // Фикс: берём ПОСЛЕДНИЕ 500 через desc, затем reverse() для UI которое
  // ожидает хронологический порядок (старые сверху, новые внизу).
  const chatMessagesRaw = threadIds.length === 0 ? [] : (await db.chatMessage.findMany({
    where: { threadId: { in: threadIds } },
    orderBy: { createdAt: 'desc' },
    take: 500,
    include: {
      sender:          { select: { name: true } },
      whatsappAccount: { select: { id: true, label: true } },
      telegramAccount: { select: { id: true, label: true } },
      viberAccount:    { select: { id: true, label: true } },
      metaAccount:     { select: { id: true, label: true } },
      thread:          { select: { channel: true } },
    },
  })).reverse();

  // ============ КНОПКА «WhatsApp» В КАРТОЧКЕ (legacy: ведёт на самый свежий WA-thread) ============
  const waIdsForSend = waAccs.map((a) => a.id);
  const latestWaThread     = clientThreads.find((t) => t.whatsappAccountId);
  const leadWaAccountId    = lead.whatsappAccountId;
  const leadSalesManagerId = lead.salesManagerId;
  const leadLegalManagerId = lead.legalManagerId;

  let preferredWaAccountId: string | null = null;
  if (leadWaAccountId && waIdsForSend.includes(leadWaAccountId)) {
    preferredWaAccountId = leadWaAccountId;
  } else if (leadSalesManagerId) {
    const sm = waAccs.find((a) => a.ownerId === leadSalesManagerId);
    if (sm) preferredWaAccountId = sm.id;
  }
  if (!preferredWaAccountId && leadLegalManagerId) {
    const lm = waAccs.find((a) => a.ownerId === leadLegalManagerId);
    if (lm) preferredWaAccountId = lm.id;
  }

  let whatsappHref = '/inbox';
  if (latestWaThread && latestWaThread.whatsappAccountId) {
    whatsappHref = `/inbox?thread=${latestWaThread.id}&channel=${latestWaThread.whatsappAccountId}`;
  } else if (preferredWaAccountId) {
    whatsappHref = `/inbox?channel=${preferredWaAccountId}`;
  }

  const paid = lead.payments.reduce((sum, p) => sum + Number(p.amount), 0);
  const total = Number(lead.totalAmount);
  const debt = Math.max(0, total - paid);

  // Нормализация сообщений для UI: вычисляем kind/accountId/accountLabel
  // из того какое из связей у сообщения заполнено.
  const chatMessages = chatMessagesRaw.map((m) => {
    let kind: 'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM' = 'WHATSAPP';
    let accountId    = '';
    let accountLabel = '?';
    if (m.whatsappAccountId && m.whatsappAccount) {
      kind = 'WHATSAPP'; accountId = m.whatsappAccount.id; accountLabel = m.whatsappAccount.label;
    } else if (m.telegramAccountId && m.telegramAccount) {
      kind = 'TELEGRAM'; accountId = m.telegramAccount.id; accountLabel = m.telegramAccount.label;
    } else if (m.viberAccountId && m.viberAccount) {
      kind = 'VIBER';    accountId = m.viberAccount.id;    accountLabel = m.viberAccount.label;
    } else if (m.metaAccountId && m.metaAccount) {
      kind = m.thread.channel === 'INSTAGRAM' ? 'INSTAGRAM' : 'MESSENGER';
      accountId = m.metaAccount.id;
      accountLabel = m.metaAccount.label;
    }
    return {
      id:          m.id,
      direction:   m.direction,
      type:        m.type,
      body:        m.body,
      mediaUrl:    m.mediaUrl,
      mediaName:   m.mediaName,
      createdAt:   m.createdAt.toISOString(),
      isRead:      m.isRead,
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
      senderName:  m.sender?.name ?? null,
      kind,
      accountId,
      accountLabel,
    };
  });

  // Список каналов для селектора отправки — только sendable (свои + общие).
  const availableChatAccounts: Array<{
    kind:        'WHATSAPP' | 'TELEGRAM' | 'VIBER' | 'MESSENGER' | 'INSTAGRAM';
    accountId:   string;
    label:       string;
    subtitle:    string | null;
    isConnected: boolean;
    isShared:    boolean;
  }> = [
    ...waAccs.map((a) => ({
      kind:        'WHATSAPP' as const,
      accountId:   a.id,
      label:       a.label,
      subtitle:    a.phoneNumber,
      isConnected: a.isConnected,
      isShared:    a.ownerId === null,
    })),
    ...tgAccs.map((a) => ({
      kind:        'TELEGRAM' as const,
      accountId:   a.id,
      label:       a.label,
      subtitle:    `@${a.botUsername}`,
      isConnected: a.isConnected,
      isShared:    a.ownerId === null,
    })),
    ...viberAccs.map((a) => ({
      kind:        'VIBER' as const,
      accountId:   a.id,
      label:       a.label,
      subtitle:    a.paName,
      isConnected: a.isConnected,
      isShared:    a.ownerId === null,
    })),
    ...metaAccs.flatMap((a) => {
      const items: Array<{
        kind:        'MESSENGER' | 'INSTAGRAM';
        accountId:   string;
        label:       string;
        subtitle:    string | null;
        isConnected: boolean;
        isShared:    boolean;
      }> = [];
      if (a.hasMessenger) {
        items.push({
          kind:        'MESSENGER',
          accountId:   a.id,
          label:       `${a.label} · FB`,
          subtitle:    a.pageName,
          isConnected: a.isConnected,
          isShared:    a.ownerId === null,
        });
      }
      if (a.hasInstagram) {
        items.push({
          kind:        'INSTAGRAM',
          accountId:   a.id,
          label:       `${a.label} · IG`,
          subtitle:    a.igUsername ? `@${a.igUsername}` : null,
          isConnected: a.isConnected,
          isShared:    a.ownerId === null,
        });
      }
      return items;
    }),
  ];

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
          caseNumber:   lead.caseNumber,
          serviceName:  lead.service?.name ?? null,
          employerName: lead.employerName,
          employerPhone: lead.employerPhone,
          totalAmount:  total,
          firstContactAt: lead.firstContactAt?.toISOString() ?? null,
          fingerprintDate: lead.fingerprintDate?.toISOString() ?? null,
          fingerprintLocation: lead.fingerprintLocation,
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
          legalStayType:  lead.client.legalStayType,
          legalStayUntil: lead.client.legalStayUntil?.toISOString() ?? null,
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
        whatsappHref={whatsappHref}
        stages={allStages.map((s) => ({
          id: s.id, name: s.name, color: s.color, position: s.position,
          isFinal: s.isFinal, isLost: s.isLost,
        }))}
        funnels={allFunnels.map((f) => ({
          id: f.id, name: f.name, isActive: f.isActive,
          stages: f.stages,
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
        chatMessages={chatMessages}
        availableChatAccounts={availableChatAccounts}
        calls={calls.map((c) => ({
          id:               c.id,
          direction:        c.direction,
          fromNumber:       c.fromNumber,
          toNumber:         c.toNumber,
          startedAt:        c.startedAt.toISOString(),
          durationSec:      c.durationSec,
          recordUrl:        c.recordUrl,
          recordLocalUrl:   c.recordLocalUrl,
          transcript:       c.transcript,
          transcriptStatus: c.transcriptStatus,
          sentiment:        c.sentiment,
          analysisSummary:  c.analysisSummary,
          analysisTags:     c.analysisTags,
        }))}
      />
    </>
  );
}
