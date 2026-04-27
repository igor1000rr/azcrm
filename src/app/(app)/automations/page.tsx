// Автоматизации — список триггеров и действий
import { Topbar } from '@/components/topbar';
import { db } from '@/lib/db';
import { requireAdmin } from '@/lib/auth';
import { Zap, Clock } from 'lucide-react';
import { formatRelative } from '@/lib/utils';

export const dynamic = 'force-dynamic';

export default async function AutomationsPage() {
  await requireAdmin();

  const automations = await db.automation.findMany({
    orderBy: { createdAt: 'asc' },
  });

  return (
    <>
      <Topbar breadcrumbs={[{ label: 'CRM' }, { label: 'Автоматизации' }]} />

      <div className="p-4 md:p-5 max-w-[920px] w-full">
        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          <div className="px-5 py-3.5 border-b border-line flex items-center justify-between">
            <h2 className="text-[15px] font-bold tracking-tight">Автоматизации</h2>
            <span className="text-[12px] text-ink-3">
              {automations.filter((a) => a.isActive).length} активных из {automations.length}
            </span>
          </div>

          <div className="divide-y divide-line">
            {automations.map((a) => (
              <div key={a.id} className="px-5 py-3.5 flex items-start gap-3">
                <div className={`w-8 h-8 rounded-md grid place-items-center shrink-0 ${
                  a.isActive ? 'bg-success-bg text-success' : 'bg-bg text-ink-4'
                }`}>
                  <Zap size={14} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-semibold text-ink">{a.name}</div>
                  {a.description && (
                    <div className="text-[12px] text-ink-3 mt-0.5">{a.description}</div>
                  )}
                  <div className="text-[11px] text-ink-4 mt-1.5 flex items-center gap-2 font-mono">
                    <span className="px-1.5 py-px bg-bg rounded">{a.trigger}</span>
                    <span>→</span>
                    <span className="px-1.5 py-px bg-bg rounded">{a.action}</span>
                  </div>
                </div>
                <label className="inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" defaultChecked={a.isActive} className="sr-only peer" disabled />
                  <div className="relative w-9 h-5 bg-line rounded-full peer-checked:bg-success after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-4" />
                </label>
              </div>
            ))}
          </div>

          {automations.length === 0 && (
            <div className="text-center py-10 text-[13px] text-ink-4">
              Автоматизаций пока нет
            </div>
          )}
        </div>

        <p className="text-[11.5px] text-ink-4 mt-3">
          Включение / отключение автоматизаций будет доступно в следующей версии.
        </p>
      </div>
    </>
  );
}
