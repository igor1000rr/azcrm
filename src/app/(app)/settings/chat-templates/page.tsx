// Настройки → Шаблоны сообщений
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { ChatTemplatesView } from './chat-templates-view';

export const dynamic = 'force-dynamic';

export default async function ChatTemplatesPage() {
  await requireAdmin();

  const templates = await db.chatTemplate.findMany({
    orderBy: [{ category: 'asc' }, { name: 'asc' }],
  });

  return (
    <>
      <Topbar
        breadcrumbs={[{ label: 'CRM' }, { label: 'Настройки' }, { label: 'Шаблоны сообщений' }]}
      />
      <ChatTemplatesView
        templates={templates.map((t) => ({
          id: t.id, name: t.name, body: t.body,
          category: t.category, isActive: t.isActive,
        }))}
      />
    </>
  );
}
