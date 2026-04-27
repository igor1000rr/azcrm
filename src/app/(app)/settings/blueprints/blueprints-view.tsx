'use client';

// Управление шаблонами документов: загрузка .docx, удаление, просмотр плейсхолдеров
import { useState, useRef, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, FileText, Trash2, Download, Upload, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, FormField } from '@/components/ui/input';
import { formatRelative, formatPrice } from '@/lib/utils';

interface BlueprintLite {
  id: string;
  name: string;
  description: string | null;
  fileUrl: string;
  format: string;
  placeholders: string[];
  isActive: boolean;
  createdAt: string;
  usageCount: number;
}

export function BlueprintsView({ blueprints }: { blueprints: BlueprintLite[] }) {
  const [uploading, setUploading] = useState(false);

  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full">
      <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Шаблоны документов</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            {blueprints.length} {plural(blueprints.length, 'шаблон', 'шаблона', 'шаблонов')}
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setUploading(true)}>
          <Plus size={12} /> Загрузить шаблон
        </Button>
      </div>

      <div className="bg-info-bg border border-info/20 rounded-md px-4 py-3 mb-3 flex gap-3">
        <Info size={14} className="text-info shrink-0 mt-0.5" />
        <div className="text-[12px] text-ink-2 leading-relaxed">
          В шаблоне можно использовать плейсхолдеры в фигурных скобках:{' '}
          <code className="bg-paper px-1 rounded text-info font-mono">{'{client.fullName}'}</code>,{' '}
          <code className="bg-paper px-1 rounded text-info font-mono">{'{lead.service}'}</code>,{' '}
          <code className="bg-paper px-1 rounded text-info font-mono">{'{today}'}</code>.
          Полный список:{' '}
          <code className="text-ink-3">client.*, lead.*, user.*, today, company.name</code>
        </div>
      </div>

      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        {blueprints.length === 0 ? (
          <div className="p-10 text-center">
            <FileText size={36} className="mx-auto text-ink-5 mb-3" />
            <h3 className="text-[14px] font-semibold mb-1">Шаблонов пока нет</h3>
            <p className="text-[12px] text-ink-3">
              Загрузите .docx-файл с плейсхолдерами для автозаполнения
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {blueprints.map((b) => <BlueprintRow key={b.id} bp={b} />)}
          </div>
        )}
      </div>

      {uploading && <UploadModal onClose={() => setUploading(false)} />}
    </div>
  );
}

function BlueprintRow({ bp }: { bp: BlueprintLite }) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm(`Удалить шаблон «${bp.name}»? Документы созданные из него останутся.`)) return;
    try {
      const { deleteBlueprint } = await import('../../document-actions');
      await deleteBlueprint(bp.id);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="px-5 py-3.5 flex items-start gap-3 flex-wrap">
      <div className="w-9 h-9 rounded bg-info-bg text-info grid place-items-center text-[10px] font-bold shrink-0">
        {bp.format}
      </div>

      <div className="flex-1 min-w-[260px]">
        <div className="text-[14px] font-semibold text-ink">{bp.name}</div>
        {bp.description && (
          <div className="text-[12px] text-ink-3 mt-0.5">{bp.description}</div>
        )}
        <div className="text-[11px] text-ink-4 mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
          <span>создан {formatRelative(bp.createdAt)}</span>
          <span>· использован {bp.usageCount} раз</span>
        </div>
        {bp.placeholders.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1">
            {bp.placeholders.slice(0, 8).map((p) => (
              <code key={p} className="text-[10.5px] px-1.5 py-px bg-bg text-ink-2 rounded font-mono">
                {`{${p}}`}
              </code>
            ))}
            {bp.placeholders.length > 8 && (
              <span className="text-[10.5px] text-ink-4 px-1">
                +{bp.placeholders.length - 8} ещё
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-1.5 ml-auto">
        <a
          href={bp.fileUrl}
          download
          className="px-2.5 py-1.5 text-[12px] font-medium border border-line bg-paper text-ink-2 rounded-md hover:border-ink-5 inline-flex items-center gap-1.5"
        >
          <Download size={11} /> Скачать
        </a>
        <Button size="sm" variant="ghost" onClick={onDelete}>
          <Trash2 size={11} />
        </Button>
      </div>
    </div>
  );
}

function UploadModal({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const [name, setName]               = useState('');
  const [description, setDescription] = useState('');
  const [file, setFile]               = useState<File | null>(null);
  const [busy, setBusy]               = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file || !name.trim()) return;
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const { uploadBlueprint } = await import('../../document-actions');
      // Передаём как Buffer — server action её сериализует
      const arr = new Uint8Array(buffer);
      await uploadBlueprint(
        Buffer.from(arr) as unknown as Buffer,
        name.trim(),
        description.trim() || null,
        file.name,
      );
      router.refresh();
      onClose();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Загрузить шаблон Word"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={handleSubmit as unknown as () => void}
                  disabled={busy || !file || !name.trim()}>
            {busy ? 'Загрузка...' : 'Загрузить'}
          </Button>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <FormField label="Название" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Wniosek o pobyt czasowy (praca)"
            autoFocus
          />
        </FormField>
        <FormField label="Описание">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Когда использовать этот шаблон"
            rows={2}
          />
        </FormField>
        <FormField label="Файл .docx" required>
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-line rounded-md p-5 text-center cursor-pointer hover:border-ink-5 hover:bg-bg transition-colors"
          >
            <Upload size={24} className="mx-auto text-ink-4 mb-2" />
            {file ? (
              <div className="text-[13px] font-semibold text-ink">{file.name}</div>
            ) : (
              <>
                <div className="text-[13px] font-semibold text-ink-2">Выберите файл</div>
                <div className="text-[11px] text-ink-4 mt-1">только .docx с плейсхолдерами</div>
              </>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
            />
          </div>
        </FormField>
      </form>
    </Modal>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
