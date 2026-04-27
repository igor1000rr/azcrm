'use client';

// UI: управление воронками и этапами
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, Trash2, Edit3, Power, ChevronDown, ChevronRight,
  GripVertical, FileText, Check, X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, FormField } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  upsertFunnel, deleteFunnel, toggleFunnel,
  upsertStage, deleteStage,
  upsertDocTemplate, deleteDocTemplate,
} from './actions';

interface StageLite {
  id: string; name: string; color: string | null;
  position: number; isFinal: boolean; isLost: boolean;
}

interface FunnelLite {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  position: number;
  isActive: boolean;
  leadsCount: number;
  stages: StageLite[];
  docTemplates: Array<{ id: string; name: string; position: number; isRequired: boolean }>;
}

const PRESET_COLORS = [
  '#0A1A35', '#2563EB', '#7C3AED', '#DC2626',
  '#CA8A04', '#16A34A', '#0891B2', '#71717A',
];

export function FunnelsView({ funnels }: { funnels: FunnelLite[] }) {
  const [editing, setEditing]     = useState<FunnelLite | null>(null);
  const [creating, setCreating]   = useState(false);
  const [expanded, setExpanded]   = useState<Set<string>>(new Set());

  function toggle(id: string) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  }

  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full">
      <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Воронки и этапы</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            {funnels.length} {plural(funnels.length, 'воронка', 'воронки', 'воронок')}
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus size={12} /> Новая воронка
        </Button>
      </div>

      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        <div className="divide-y divide-line">
          {funnels.map((f) => (
            <FunnelRow
              key={f.id}
              funnel={f}
              expanded={expanded.has(f.id)}
              onToggle={() => toggle(f.id)}
              onEdit={() => setEditing(f)}
            />
          ))}
        </div>
      </div>

      {(editing || creating) && (
        <FunnelFormModal
          funnel={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function FunnelRow({
  funnel, expanded, onToggle, onEdit,
}: {
  funnel: FunnelLite;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
}) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm(`Удалить воронку «${funnel.name}»? Это действие нельзя отменить.`)) return;
    try {
      await deleteFunnel(funnel.id);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  async function onPowerToggle() {
    try {
      await toggleFunnel(funnel.id, !funnel.isActive);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div className={cn(!funnel.isActive && 'opacity-60')}>
      <div className="px-5 py-3.5 flex items-center gap-3">
        <button
          type="button"
          onClick={onToggle}
          className="text-ink-3 hover:text-ink"
          aria-label={expanded ? 'Свернуть' : 'Развернуть'}
        >
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>

        <div
          className="w-3 h-3 rounded shrink-0"
          style={{ background: funnel.color || '#71717A' }}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-[14px] text-ink">{funnel.name}</strong>
            {!funnel.isActive && <Badge>выключена</Badge>}
            <span className="text-[11.5px] text-ink-4">
              {funnel.stages.length} {plural(funnel.stages.length, 'этап', 'этапа', 'этапов')} ·
              {' '}{funnel.leadsCount} {plural(funnel.leadsCount, 'лид', 'лида', 'лидов')}
            </span>
          </div>
          {funnel.description && (
            <p className="text-[12px] text-ink-3 mt-0.5 truncate">{funnel.description}</p>
          )}
        </div>

        <div className="flex gap-1.5">
          <Button size="sm" onClick={onEdit}><Edit3 size={11} /></Button>
          <Button size="sm" onClick={onPowerToggle}><Power size={11} /></Button>
          <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 size={11} /></Button>
        </div>
      </div>

      {expanded && (
        <div className="px-5 pb-4 pl-12">
          <StagesEditor funnelId={funnel.id} stages={funnel.stages} />
          <DocTemplatesEditor funnelId={funnel.id} templates={funnel.docTemplates} />
        </div>
      )}
    </div>
  );
}

// ============ ЭТАПЫ ============

function StagesEditor({
  funnelId, stages,
}: { funnelId: string; stages: StageLite[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<StageLite | null>(null);
  const [creating, setCreating] = useState(false);

  async function onDelete(s: StageLite) {
    if (!confirm(`Удалить этап «${s.name}»?`)) return;
    try {
      await deleteStage(s.id);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="bg-bg rounded-md p-3 mb-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] uppercase tracking-[0.06em] text-ink-2 font-bold">Этапы</h4>
        <Button size="sm" onClick={() => setCreating(true)}>
          <Plus size={11} /> Этап
        </Button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {stages.map((s) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setEditing(s)}
            className="group inline-flex items-center gap-1.5 px-2 py-1 rounded border bg-paper text-[11.5px] hover:border-ink-5 transition-colors"
            style={{
              borderLeftWidth: 2,
              borderLeftColor: s.color || '#71717A',
            }}
          >
            <span className="text-ink font-medium">{s.position}.</span>
            <span className="text-ink">{s.name}</span>
            {s.isFinal && (
              <Badge variant={s.isLost ? 'danger' : 'success'}>
                {s.isLost ? 'отказ' : 'успех'}
              </Badge>
            )}
          </button>
        ))}
      </div>

      {(editing || creating) && (
        <StageFormModal
          funnelId={funnelId}
          stage={editing}
          nextPosition={stages.length + 1}
          onClose={() => { setEditing(null); setCreating(false); }}
          onDeleteClick={editing ? () => { onDelete(editing); setEditing(null); } : undefined}
        />
      )}
    </div>
  );
}

function StageFormModal({
  funnelId, stage, nextPosition, onClose, onDeleteClick,
}: {
  funnelId: string;
  stage: StageLite | null;
  nextPosition: number;
  onClose: () => void;
  onDeleteClick?: () => void;
}) {
  const router = useRouter();
  const [name, setName]         = useState(stage?.name ?? '');
  const [color, setColor]       = useState(stage?.color ?? '#71717A');
  const [position, setPosition] = useState(stage?.position ?? nextPosition);
  const [isFinal, setIsFinal]   = useState(stage?.isFinal ?? false);
  const [isLost, setIsLost]     = useState(stage?.isLost ?? false);
  const [busy, setBusy]         = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsertStage({
        id: stage?.id, funnelId, name, color, position, isFinal, isLost,
      });
      router.refresh();
      onClose();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={stage ? 'Редактирование этапа' : 'Новый этап'}
      footer={
        <>
          {onDeleteClick && (
            <Button variant="ghost" onClick={onDeleteClick} className="mr-auto">
              <Trash2 size={11} /> Удалить
            </Button>
          )}
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !name}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Название" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>

        <FormField label="Цвет">
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'w-7 h-7 rounded border-2',
                  color === c ? 'border-navy ring-2 ring-navy/20' : 'border-line',
                )}
                style={{ background: c }}
                aria-label={c}
              />
            ))}
          </div>
        </FormField>

        <FormField label="Позиция">
          <Input
            type="number" min="1" value={position}
            onChange={(e) => setPosition(Number(e.target.value))}
          />
        </FormField>

        <div className="flex flex-col gap-2 pt-2 border-t border-line">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={isFinal}
              onChange={(e) => { setIsFinal(e.target.checked); if (!e.target.checked) setIsLost(false); }}
            />
            <span className="text-[13px]">Финальный этап (закрывает дело)</span>
          </label>
          {isFinal && (
            <label className="flex items-center gap-2 cursor-pointer ml-5">
              <input
                type="checkbox"
                checked={isLost}
                onChange={(e) => setIsLost(e.target.checked)}
              />
              <span className="text-[13px]">Негативный финал (отказ / неудача)</span>
            </label>
          )}
        </div>
      </div>
    </Modal>
  );
}

// ============ ШАБЛОНЫ ДОКУМЕНТОВ ============

function DocTemplatesEditor({
  funnelId,
  templates,
}: {
  funnelId: string;
  templates: Array<{ id: string; name: string; position: number; isRequired: boolean }>;
}) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');

  async function add() {
    if (!newName.trim()) return;
    try {
      await upsertDocTemplate({
        funnelId,
        name:     newName.trim(),
        position: templates.length + 1,
        isRequired: true,
      });
      setNewName('');
      setAdding(false);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  async function remove(id: string) {
    if (!confirm('Удалить документ из шаблона?')) return;
    try {
      await deleteDocTemplate(id);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="bg-bg rounded-md p-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-[11px] uppercase tracking-[0.06em] text-ink-2 font-bold">
          Чек-лист документов ({templates.length})
        </h4>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus size={11} /> Документ
        </Button>
      </div>

      {templates.length === 0 ? (
        <p className="text-[12px] text-ink-4 py-2">
          Список документов будет автоматически создаваться для каждого нового лида в этой воронке
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {templates.map((t) => (
            <div key={t.id} className="group flex items-center gap-2 px-2 py-1.5 rounded bg-paper border border-line text-[12.5px]">
              <FileText size={11} className="text-ink-4" />
              <span className="text-ink flex-1">{t.name}</span>
              <button
                type="button"
                onClick={() => remove(t.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding && (
        <div className="mt-2 flex gap-1.5">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Название документа"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') add(); if (e.key === 'Escape') setAdding(false); }}
            className="flex-1 text-[12px] py-1.5"
          />
          <Button size="sm" variant="primary" onClick={add}><Check size={11} /></Button>
          <Button size="sm" onClick={() => setAdding(false)}><X size={11} /></Button>
        </div>
      )}
    </div>
  );
}

// ============ ВОРОНКА ============

function FunnelFormModal({
  funnel, onClose,
}: {
  funnel: FunnelLite | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(funnel?.name ?? '');
  const [description, setDescription] = useState(funnel?.description ?? '');
  const [color, setColor] = useState(funnel?.color ?? '#0A1A35');
  const [position, setPosition] = useState(funnel?.position ?? 99);
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsertFunnel({
        id: funnel?.id, name, description: description || null, color, position,
      });
      router.refresh();
      onClose();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={funnel ? 'Редактирование воронки' : 'Новая воронка'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !name}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Название" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Описание">
          <Textarea value={description ?? ''} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </FormField>
        <FormField label="Цвет">
          <div className="flex gap-1.5 flex-wrap">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={cn(
                  'w-7 h-7 rounded border-2',
                  color === c ? 'border-navy ring-2 ring-navy/20' : 'border-line',
                )}
                style={{ background: c }}
              />
            ))}
          </div>
        </FormField>
        <FormField label="Позиция в списке">
          <Input type="number" min="1" value={position} onChange={(e) => setPosition(Number(e.target.value))} />
        </FormField>
        {!funnel && (
          <p className="text-[11.5px] text-ink-4">
            Будут автоматически созданы базовые этапы: Новый, В работе, Завершён, Отказ.
            Их можно править после создания.
          </p>
        )}
      </div>
    </Modal>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
