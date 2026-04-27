'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Edit3, Trash2, Sparkles, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, FormField } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { upsertChatTemplate, deleteChatTemplate } from './actions';

interface TplLite {
  id: string;
  name: string;
  body: string;
  category: string | null;
  isActive: boolean;
}

const KNOWN_PLACEHOLDERS = [
  '{client.fullName}', '{client.phone}', '{client.email}',
  '{lead.fingerprintDate}', '{lead.fingerprintTime}', '{lead.fingerprintLocation}',
  '{lead.totalAmount}', '{lead.paid}', '{lead.debt}',
  '{user.name}', '{today}',
];

export function ChatTemplatesView({ templates }: { templates: TplLite[] }) {
  const [editing, setEditing]   = useState<TplLite | null>(null);
  const [creating, setCreating] = useState(false);

  // Группировка по категории
  const grouped: Record<string, TplLite[]> = {};
  for (const t of templates) {
    const cat = t.category || 'Прочее';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(t);
  }

  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full">
      <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Шаблоны сообщений</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">{templates.length} шаблонов</p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus size={12} /> Новый шаблон
        </Button>
      </div>

      <div className="bg-info-bg border border-info/20 rounded-md px-4 py-3 mb-3 flex gap-3">
        <Info size={14} className="text-info shrink-0 mt-0.5" />
        <div className="text-[12px] text-ink-2 leading-relaxed">
          В тексте можно использовать плейсхолдеры:{' '}
          {KNOWN_PLACEHOLDERS.slice(0, 5).map((p, i) => (
            <code key={p} className="bg-paper px-1 rounded text-info font-mono">{p}{i < 4 && ', '}</code>
          ))}
          ...
        </div>
      </div>

      <div className="flex flex-col gap-3">
        {Object.entries(grouped).map(([cat, items]) => (
          <div key={cat} className="bg-paper border border-line rounded-lg overflow-hidden">
            <div className="px-4 py-2.5 border-b border-line bg-bg">
              <h3 className="text-[12px] font-bold uppercase tracking-[0.05em] text-ink-2">
                {cat} ({items.length})
              </h3>
            </div>
            <div className="divide-y divide-line">
              {items.map((t) => (
                <Row key={t.id} tpl={t} onEdit={() => setEditing(t)} />
              ))}
            </div>
          </div>
        ))}
      </div>

      {(editing || creating) && (
        <FormModal
          tpl={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}
    </div>
  );
}

function Row({ tpl, onEdit }: { tpl: TplLite; onEdit: () => void }) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm(`Удалить шаблон «${tpl.name}»?`)) return;
    await deleteChatTemplate(tpl.id);
    router.refresh();
  }

  return (
    <div className={`px-5 py-3 flex items-start gap-3 ${!tpl.isActive ? 'opacity-50' : ''}`}>
      <Sparkles size={14} className="text-gold shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <strong className="text-[14px] text-ink">{tpl.name}</strong>
          {!tpl.isActive && <Badge>выключен</Badge>}
        </div>
        <p className="text-[12px] text-ink-3 mt-1 whitespace-pre-wrap line-clamp-2">{tpl.body}</p>
      </div>
      <div className="flex gap-1.5">
        <Button size="sm" onClick={onEdit}><Edit3 size={11} /></Button>
        <Button size="sm" variant="ghost" onClick={onDelete}><Trash2 size={11} /></Button>
      </div>
    </div>
  );
}

function FormModal({ tpl, onClose }: { tpl: TplLite | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName]         = useState(tpl?.name ?? '');
  const [body, setBody]         = useState(tpl?.body ?? '');
  const [category, setCategory] = useState(tpl?.category ?? '');
  const [isActive, setActive]   = useState(tpl?.isActive ?? true);
  const [busy, setBusy]         = useState(false);

  async function save() {
    setBusy(true);
    try {
      await upsertChatTemplate({
        id: tpl?.id, name, body, category: category || null, isActive,
      });
      router.refresh();
      onClose();
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  function insertPlaceholder(p: string) {
    setBody((b) => b + p);
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={tpl ? 'Редактирование шаблона' : 'Новый шаблон'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !name || !body}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="Название" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Категория" hint="Например: приветствия, документы">
            <Input value={category ?? ''} onChange={(e) => setCategory(e.target.value)} />
          </FormField>
        </div>
        <FormField label="Текст" required>
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            placeholder="Здравствуйте, {client.fullName}!"
          />
        </FormField>
        <div>
          <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-1">
            Вставить плейсхолдер
          </div>
          <div className="flex flex-wrap gap-1">
            {KNOWN_PLACEHOLDERS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => insertPlaceholder(p)}
                className="text-[10.5px] px-1.5 py-0.5 bg-bg hover:bg-info-bg hover:text-info rounded font-mono text-ink-2 transition-colors"
              >
                {p}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer pt-2 border-t border-line">
          <input type="checkbox" checked={isActive} onChange={(e) => setActive(e.target.checked)} />
          <span className="text-[13px]">Шаблон активен (показывать в списке для отправки)</span>
        </label>
      </div>
    </Modal>
  );
}
