// Настройки → Шаблоны Word
// Anna загружает .docx с плейсхолдерами для автогенерации
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { BlueprintsView } from './blueprints-view';

export const dynamic = 'force-dynamic';

export default async function BlueprintsPage() {
  await requireAdmin();

  const blueprints = await db.documentBlueprint.findMany({
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { documents: true } } },
  });

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Настройки' },
          { label: 'Шаблоны документов' },
        ]}
      />

      <BlueprintsView
        blueprints={blueprints.map((b) => ({
          id:           b.id,
          name:         b.name,
          description:  b.description,
          fileUrl:      b.fileUrl,
          format:       b.format,
          placeholders: b.placeholders,
          isActive:     b.isActive,
          createdAt:    b.createdAt.toISOString(),
          usageCount:   b._count.documents,
        }))}
      />
    </>
  );
}
