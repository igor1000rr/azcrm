'use client';

// Inline-редактор даты подачи внеска в УВ (Anna 30.04.2026 «волшебная штучка»).
//
//   null  → красная рамка + бейдж «не подан» (AlertCircle)
//   дата  → отображается + кнопка «сбросить»
//
// Сохранение по onChange (без кнопки «сохранить» — тот же UX что у setWorkCity
// в DealCard). После успеха router.refresh() передёргивает страницу с новым
// initial — useEffect ниже синхронизирует локальный value.
//
// Вынесён в отдельный файл из lead-card-view.tsx — иначе полный файл
// родителя не поддаётся изолированному тестированию (обвешан импортами OnlyOffice,
// LeadChatPanel и множеством server actions).

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { setSubmittedAt } from '@/app/(app)/clients/[id]/actions';

export function SubmittedAtField({ leadId, initial }: { leadId: string; initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ? initial.slice(0, 10) : '');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  // Если данные обновились извне (router.refresh после действий) — синхронизируем
  useEffect(() => { setValue(initial ? initial.slice(0, 10) : ''); }, [initial]);

  async function commit(next: string | null) {
    setErr(null); setBusy(true);
    try { await setSubmittedAt(leadId, next); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!value) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value=""
            disabled={busy}
            onChange={(e) => { const v = e.target.value; setValue(v); if (v) commit(v); }}
            className="text-[12.5px] py-0.5 border-danger/40"
            aria-label="Дата подачи в уженд"
          />
          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-danger uppercase tracking-[0.05em] whitespace-nowrap">
            <AlertCircle size={11} /> не подан
          </span>
        </div>
        {err && <div className="text-[11px] text-danger" role="alert">{err}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={value}
          disabled={busy}
          onChange={(e) => { setValue(e.target.value); if (e.target.value) commit(e.target.value); }}
          className="text-[12.5px] py-0.5"
          aria-label="Дата подачи в уженд"
        />
        <button
          type="button"
          onClick={() => { setValue(''); commit(null); }}
          disabled={busy}
          className="text-[11px] text-ink-4 hover:text-danger transition-colors"
          title="Сбросить дату подачи"
        >
          сбросить
        </button>
      </div>
      {err && <div className="text-[11px] text-danger" role="alert">{err}</div>}
    </div>
  );
}
