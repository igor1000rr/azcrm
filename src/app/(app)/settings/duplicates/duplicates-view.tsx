'use client';

// UI для слияния дубликатов клиентов (#2.3 аудита).
//
// Поток:
//   1. Анна видит список групп совпадающих имён.
//   2. В группе выбирает target (куда сливаем) и source (кого удаляем).
//   3. Нажимает «Слить» → confirm → вызываем mergeClients server action.
//
// Дизайн:
//   - fake-клиенты (tg:* phone) помечены ярлыком — обычно это source.
//   - Клиент с большим кол-вом leads/threads — лучший кандидат в target.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, ArrowRight, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatRelative } from '@/lib/utils';

interface ClientLite {
  id:        string;
  fullName:  string;
  phone:     string;
  email:     string | null;
  source:    string | null;
  createdAt: string;
  isFake:    boolean;
  counts: {
    leads:       number;
    chatThreads: number;
    calls:       number;
    files:       number;
  };
}

interface Group {
  fullName: string;
  clients:  ClientLite[];
}

export function DuplicatesView({ groups }: { groups: Group[] }) {
  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full">
      <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3">
        <Users size={18} className="text-info" />
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Дубликаты клиентов</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            {groups.length === 0
              ? 'Нет клиентов с одинаковыми именами'
              : `Найдено ${groups.length} групп совпадающих имён`}
          </p>
        </div>
      </div>

      <div className="bg-warning-bg border border-warning/20 rounded-md px-4 py-3 mb-3 flex gap-3">
        <AlertTriangle size={14} className="text-warning shrink-0 mt-0.5" />
        <div className="text-[12px] text-ink-2 leading-relaxed">
          Слияние НЕОБРАТИМО. Все лиды, переписки, звонки и файлы из source-клиента
          перейдут на target. Сам source-клиент будет удалён. Действие пишется в журнал аудита.
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {groups.map((g) => (
          <GroupRow key={g.fullName} group={g} />
        ))}
      </div>
    </div>
  );
}

function GroupRow({ group }: { group: Group }) {
  const router = useRouter();
  const [busy, setBusy]         = useState(false);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [targetId, setTargetId] = useState<string | null>(
    // Дефолт target = клиент с реальным номером и максимумом связей
    [...group.clients]
      .filter((c) => !c.isFake)
      .sort((a, b) => totalLinks(b) - totalLinks(a))[0]?.id ?? null,
  );

  async function onMerge() {
    if (!sourceId || !targetId) return;
    if (sourceId === targetId) {
      alert('Выберите РАЗНЫх клиентов для source и target');
      return;
    }
    const source = group.clients.find((c) => c.id === sourceId);
    const target = group.clients.find((c) => c.id === targetId);
    if (!source || !target) return;

    const msg =
      `Слить «${source.fullName} (${source.phone})» в «${target.fullName} (${target.phone})»?\n\n` +
      `Перенесёмся:\n` +
      `  • ${source.counts.leads} лидов\n` +
      `  • ${source.counts.chatThreads} переписок\n` +
      `  • ${source.counts.calls} звонков\n` +
      `  • ${source.counts.files} файлов\n\n` +
      `Исходный клиент будет удалён. Продолжить?`;
    if (!confirm(msg)) return;

    setBusy(true);
    try {
      const { mergeClients } = await import('@/app/(app)/clients/[id]/merge-actions');
      await mergeClients(sourceId, targetId);
      router.refresh();
    } catch (e) {
      alert(`Ошибка: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line bg-bg flex items-center gap-2">
        <Users size={13} className="text-ink-3" />
        <span className="text-[13px] font-semibold">{group.fullName}</span>
        <span className="text-[11px] text-ink-4 ml-auto">{group.clients.length} клиентов</span>
      </div>

      <div className="divide-y divide-line">
        {group.clients.map((c) => (
          <div key={c.id} className="px-4 py-2.5 flex items-center gap-3">
            <input
              type="radio"
              name={`source-${group.fullName}`}
              checked={sourceId === c.id}
              onChange={() => setSourceId(c.id)}
              title="Исходный (source) — будет удалён"
            />
            <input
              type="radio"
              name={`target-${group.fullName}`}
              checked={targetId === c.id}
              onChange={() => setTargetId(c.id)}
              title="Целевой (target) — в него всё перенесётся"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[13px] font-medium flex items-center gap-2">
                <span className={c.isFake ? 'text-ink-3 italic' : ''}>{c.phone}</span>
                {c.isFake && (
                  <span className="text-[10px] px-1.5 py-px rounded bg-warning/15 text-warning">fake</span>
                )}
                {c.email && <span className="text-[12px] text-ink-3">· {c.email}</span>}
              </div>
              <div className="text-[11px] text-ink-4 mt-0.5 flex flex-wrap gap-x-3">
                <span>{c.counts.leads} лидов</span>
                <span>{c.counts.chatThreads} чатов</span>
                <span>{c.counts.calls} звонков</span>
                <span>{c.counts.files} файлов</span>
                <span>· создан {formatRelative(c.createdAt)}</span>
                {c.source && <span>· {c.source.slice(0, 30)}</span>}
              </div>
            </div>
            <a
              href={`/clients/${c.id}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-info hover:underline shrink-0"
            >
              Карточка ↗
            </a>
          </div>
        ))}
      </div>

      <div className="px-4 py-2.5 border-t border-line bg-bg flex items-center gap-2">
        <span className="text-[11px] text-ink-3">Синий = source → красный = target</span>
        <Button
          variant="primary"
          size="sm"
          className="ml-auto"
          onClick={onMerge}
          disabled={busy || !sourceId || !targetId || sourceId === targetId}
        >
          <ArrowRight size={11} /> {busy ? 'Слияние...' : 'Слить'}
        </Button>
      </div>
    </div>
  );
}

function totalLinks(c: ClientLite): number {
  return c.counts.leads + c.counts.chatThreads + c.counts.calls + c.counts.files;
}
