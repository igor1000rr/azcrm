// Настройки → Каналы связи (WhatsApp + Telegram + Viber + Meta)
// Anna добавляет номера WhatsApp, ботов Telegram, Viber Public Accounts
// и Meta-аккаунты (Facebook Messenger + Instagram Direct).
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ChannelsView } from './channels-view';

export const dynamic = 'force-dynamic';

export default async function ChannelsSettingsPage() {
  await requireAdmin();

  const [waAccounts, tgAccounts, viberAccounts, metaAccounts, salesUsers] = await Promise.all([
    db.whatsappAccount.findMany({
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { threads: true, messages: true } },
      },
    }),
    db.telegramAccount.findMany({
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { threads: true, messages: true } },
      },
    }),
    db.viberAccount.findMany({
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { threads: true, messages: true } },
      },
    }),
    db.metaAccount.findMany({
      orderBy: [{ ownerId: 'asc' }, { label: 'asc' }],
      include: {
        owner: { select: { id: true, name: true } },
        _count: { select: { threads: true, messages: true } },
      },
    }),
    db.user.findMany({
      where: { isActive: true, role: { in: ['SALES', 'LEGAL', 'ADMIN'] } },
      select: { id: true, name: true, role: true },
      orderBy: { name: 'asc' },
    }),
  ]);

  // Публичный URL приложения нужен для построения webhook URL в инструкциях
  // подключения Meta (FB App требует ввести Callback URL вручную).
  const appPublicUrl = process.env.APP_PUBLIC_URL?.replace(/\/$/, '') || '';

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Настройки' },
          { label: 'Каналы связи' },
        ]}
      />

      <ChannelsView
        waAccounts={waAccounts.map((a) => ({
          id:            a.id,
          phoneNumber:   a.phoneNumber,
          label:         a.label,
          ownerId:       a.ownerId,
          ownerName:     a.owner?.name ?? null,
          isConnected:   a.isConnected,
          isActive:      a.isActive,
          lastSeenAt:    a.lastSeenAt?.toISOString() ?? null,
          threadsCount:  a._count.threads,
          messagesCount: a._count.messages,
        }))}
        tgAccounts={tgAccounts.map((a) => ({
          id:            a.id,
          botUsername:   a.botUsername,
          label:         a.label,
          ownerId:       a.ownerId,
          ownerName:     a.owner?.name ?? null,
          isConnected:   a.isConnected,
          isActive:      a.isActive,
          webhookUrl:    a.webhookUrl,
          lastSeenAt:    a.lastSeenAt?.toISOString() ?? null,
          threadsCount:  a._count.threads,
          messagesCount: a._count.messages,
        }))}
        viberAccounts={viberAccounts.map((a) => ({
          id:            a.id,
          paName:        a.paName,
          label:         a.label,
          ownerId:       a.ownerId,
          ownerName:     a.owner?.name ?? null,
          isConnected:   a.isConnected,
          isActive:      a.isActive,
          webhookUrl:    a.webhookUrl,
          lastSeenAt:    a.lastSeenAt?.toISOString() ?? null,
          threadsCount:  a._count.threads,
          messagesCount: a._count.messages,
        }))}
        metaAccounts={metaAccounts.map((a) => ({
          id:            a.id,
          pageId:        a.pageId,
          pageName:      a.pageName,
          igUserId:      a.igUserId,
          igUsername:    a.igUsername,
          hasMessenger:  a.hasMessenger,
          hasInstagram:  a.hasInstagram,
          verifyToken:   a.verifyToken,
          label:         a.label,
          ownerId:       a.ownerId,
          ownerName:     a.owner?.name ?? null,
          isConnected:   a.isConnected,
          isActive:      a.isActive,
          lastSeenAt:    a.lastSeenAt?.toISOString() ?? null,
          threadsCount:  a._count.threads,
          messagesCount: a._count.messages,
        }))}
        users={salesUsers}
        appPublicUrl={appPublicUrl}
      />
    </>
  );
}
