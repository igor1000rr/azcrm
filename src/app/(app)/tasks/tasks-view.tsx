'use client';

// Задачи: Kanban (3 колонки: открытые/в работе.../выполненные) + создание
import { useState, type DragEvent } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus, Calendar, CheckCircle, Trash2,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, Select, FormField } from '@/components/ui/input';
import { cn, formatDate, daysUntil } from '@/lib/utils';
import { upsertTask, setTaskStatus, deleteTask } from './actions';
import type { UserRole, TaskStatus, TaskPriority } from '@prisma/client';

interface TaskLite {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  assignee: { id: string; name: string } | null;
  creator: { id: string; name: string };
  lead: { id: string; clientName: string } | null;
}

interface Props {
  currentUserId: string;
  currentUserRole: UserRole;
  view: 'mine' | 'all';
  currentAssignee: string;
  team: Array<{ id: string; name: string; role: UserRole }>;
  tasks: TaskLite[];
}

export function TasksView({
  currentUserId, currentUserRole, view, currentAssignee, team, tasks,
}: Props) {
  const [editing, setEditing]   = useState<TaskLite | null>(null);
  const [creating, setCreating] = useState(false);

  const open      = tasks.filter((t) => t.status === 'OPEN');
  const done      = tasks.filter((t) => t.status === 'DONE');
  const cancelled = tasks.filter((t) => t.status === 'CANCELLED');

  return (
    <div className="p-4 md:p-5 max-w-[1640px] w-full">
      {/* Toolbar */}
      <div className="bg-paper border border-line rounded-lg mb-3 p-3 flex items-center gap-3 flex-wrap">
        {currentUserRole === 'ADMIN' && (
          <div className="flex border border-line rounded-md p-0.5">
            <Link
              href="/tasks?view=mine"
              className={`px-3 py-1 text-[12px] font-medium rounded ${
                view === 'mine' ? 'bg-navy text-white' : 'text-ink-3'
              }`}
            >
              Мои
            </Link>
            <Link
              href="/tasks?view=all"
              className={`px-3 py-1 text-[12px] font-medium rounded ${
                view === 'all' ? 'bg-navy text-white' : 'text-ink-3'
              }`}
            >
              Все
            </Link>
          </div>
        )}

        {currentUserRole === 'ADMIN' && view === 'all' && (
          <select
            value={currentAssignee}
            onChange={(e) => {
              const v = e.target.value;
              window.location.href = v
                ? `/tasks?view=all&assignee=${v}`
                : `/tasks?view=all`;
            }}
            className="px-2.5 py-1.5 text-[12px] bg-paper border border-line rounded-md font-medium"
          >
            <option value="">Все исполнители</option>
            {team.map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        )}

        <div className="text-[12px] text-ink-3 ml-auto">
          <strong className="text-ink">{open.length}</strong> открытых ·
          {' '}<span className="text-success font-semibold">{done.length}</span> выполнено
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus size={12} /> Новая задача
        </Button>
      </div>

      {/* Kanban */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        <Column
          title="К выполнению"
          color="bg-info"
          tasks={open}
          status="OPEN"
          onEdit={setEditing}
        />
        <Column
          title="Выполнено"
          color="bg-success"
          tasks={done}
          status="DONE"
          onEdit={setEditing}
        />
        <Column
          title="Отменено"
          color="bg-ink-4"
          tasks={cancelled}
          status="CANCELLED"
          onEdit={setEditing}
        />
      </div>

      {(editing || creating) && (
        <TaskFormModal
          task={editing}
          team={team}
          currentUserId={currentUserId}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function Column({
  title, color, tasks, status, onEdit,
}: {
  title: string;
  color: string;
  tasks: TaskLite[];
  status: TaskStatus;
  onEdit: (t: TaskLite) => void;
}) {
  const router = useRouter();

  async function handleDrop(e: DragEvent) {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    if (!id) return;
    try {
      await setTaskStatus(id, status);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className="bg-bg-alt border border-line rounded-lg min-h-[400px] flex flex-col"
    >
      <div className="px-3.5 py-2.5 flex items-center justify-between border-b border-line bg-paper rounded-t-lg sticky top-0 z-10">
        <div className="flex items-center gap-2">
          <span className={cn('w-1.5 h-1.5 rounded-full', color)} />
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-2">
            {title}
          </span>
          <span className="text-[11px] text-ink-3 font-mono">{tasks.length}</span>
        </div>
      </div>

      <div className="p-2 flex-1 flex flex-col gap-1.5 overflow-y-auto thin-scroll">
        {tasks.length === 0 ? (
          <div className="text-center p-4 border border-dashed border-line-strong rounded-md text-ink-4 text-[11.5px] my-1">
            Перетащите задачу сюда
          </div>
        ) : (
          tasks.map((t) => <TaskCard key={t.id} task={t} onEdit={() => onEdit(t)} />)
        )}
      </div>
    </div>
  );
}

function TaskCard({ task, onEdit }: { task: TaskLite; onEdit: () => void }) {
  const router = useRouter();
  const overdue = task.status === 'OPEN' && task.dueAt && new Date(task.dueAt) < new Date();
  const dueDays = task.dueAt ? daysUntil(task.dueAt) : null;

  async function handleDragStart(e: DragEvent) {
    e.dataTransfer.setData('text/plain', task.id);
    e.dataTransfer.effectAllowed = 'move';
  }

  async function onDelete(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Удалить задачу?')) return;
    try { await deleteTask(task.id); router.refresh(); }
    catch (e) { alert((e as Error).message); }
  }

  async function quickToggle(e: React.MouseEvent) {
    e.stopPropagation();
    try {
      await setTaskStatus(task.id, task.status === 'DONE' ? 'OPEN' : 'DONE');
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div
      draggable
      onDragStart={handleDragStart}
      onClick={onEdit}
      className={cn(
        'bg-paper border border-line rounded-md p-2.5 cursor-grab active:cursor-grabbing',
        'hover:border-ink-5 transition-all flex flex-col gap-2 group',
        overdue && 'border-l-2 border-l-danger',
        task.status === 'DONE' && 'opacity-60',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          onClick={quickToggle}
          className={cn(
            'w-4 h-4 rounded shrink-0 border-[1.5px] grid place-items-center mt-0.5 transition-colors',
            task.status === 'DONE'
              ? 'bg-success border-success text-white'
              : 'border-line-strong hover:border-success',
          )}
        >
          {task.status === 'DONE' && <CheckCircle size={10} strokeWidth={3} />}
        </button>
        <div className="flex-1 min-w-0">
          <div className={cn(
            'text-[13px] leading-snug',
            task.status === 'DONE' ? 'line-through text-ink-3' : 'text-ink font-semibold',
          )}>
            {task.title}
          </div>
          {task.description && (
            <p className="text-[11.5px] text-ink-3 mt-0.5 line-clamp-2">{task.description}</p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {task.priority !== 'NORMAL' && (
          <Badge variant={
            task.priority === 'URGENT' ? 'danger'
            : task.priority === 'HIGH' ? 'warn' : 'default'
          }>
            {priorityLabel(task.priority)}
          </Badge>
        )}
        {task.dueAt && (
          <Badge variant={overdue ? 'danger' : dueDays !== null && dueDays <= 1 ? 'warn' : 'default'}>
            <Calendar size={9} />
            {formatDate(task.dueAt)}
            {dueDays !== null && dueDays >= 0 && dueDays <= 7 && ` · ${dueDays === 0 ? 'сегодня' : `${dueDays}д`}`}
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between pt-1.5 border-t border-line-2 gap-2">
        {task.lead ? (
          <Link
            href={`/clients/${task.lead.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-[11px] text-info hover:underline truncate"
          >
            {task.lead.clientName}
          </Link>
        ) : (
          <span className="text-[11px] text-ink-4">без лида</span>
        )}
        <div className="flex items-center gap-1">
          {task.assignee && <Avatar name={task.assignee.name} size="xs" />}
          <button
            onClick={onDelete}
            className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger transition-opacity"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>
    </div>
  );
}

function TaskFormModal({
  task, team, currentUserId, onClose,
}: {
  task: TaskLite | null;
  team: Array<{ id: string; name: string; role: UserRole }>;
  currentUserId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [title, setTitle]             = useState(task?.title ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  const [assigneeId, setAssigneeId]   = useState(task?.assignee?.id ?? currentUserId);
  const [priority, setPriority]       = useState<TaskPriority>(task?.priority ?? 'NORMAL');
  const [dueAt, setDueAt]             = useState(task?.dueAt ? task.dueAt.slice(0, 10) : '');
  const [busy, setBusy]               = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsertTask({
        id:          task?.id,
        title,
        description: description || null,
        leadId:      null,
        assigneeId:  assigneeId || null,
        priority,
        dueAt:       dueAt ? new Date(dueAt + 'T18:00:00').toISOString() : null,
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
      title={task ? 'Редактирование задачи' : 'Новая задача'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !title}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Что сделать" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus
                 placeholder="Позвонить клиенту, отправить документы..." />
        </FormField>
        <FormField label="Описание">
          <Textarea value={description ?? ''} onChange={(e) => setDescription(e.target.value)} rows={3} />
        </FormField>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <FormField label="Исполнитель">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">— не назначен —</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Приоритет">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as TaskPriority)}>
              <option value="LOW">Низкий</option>
              <option value="NORMAL">Обычный</option>
              <option value="HIGH">Высокий</option>
              <option value="URGENT">Срочно</option>
            </Select>
          </FormField>
          <FormField label="Срок">
            <Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </FormField>
        </div>
      </div>
    </Modal>
  );
}

function priorityLabel(p: TaskPriority): string {
  return ({URGENT: 'Срочно', HIGH: 'Высокий', NORMAL: 'Обычный', LOW: 'Низкий'} as const)[p];
}
