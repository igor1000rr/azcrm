'use client';

// Расходы Анны: список + добавление + сводки по городам/категориям.
// Поддерживается прикрепление скана файла (использует /api/files/upload).
import { useState, useTransition, useRef } from 'react';
import { Plus, Trash2, Paperclip, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatDate, formatMoney } from '@/lib/utils';
import { upsertExpense, deleteExpense } from './actions';

interface Expense {
  id: string;
  cityId: string | null;
  cityName: string | null;
  category: string;
  amount: number;
  spentAt: string;
  description: string | null;
  fileUrl: string | null;
  fileName: string | null;
  createdByName: string | null;
}

interface Props {
  expenses: Expense[];
  cities: Array<{ id: string; name: string }>;
  byCity: Array<{ id: string; name: string; total: number; count: number }>;
  byCategory: Array<{ category: string; total: number }>;
  totalAmount: number;
  currentFilters: { from: string; to: string; city: string };
}

const COMMON_CATEGORIES = ['аренда', 'интернет', 'связь', 'налоги', 'канцелярия', 'реклама', 'софт', 'банк', 'ZUS', 'другое'];

export function ExpensesView({ expenses, cities, byCity, byCategory, totalAmount, currentFilters }: Props) {
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="p-4 md:p-5 max-w-[1400px] w-full">
      {/* Фильтры */}
      <form method="GET" className="bg-paper border border-line rounded-lg p-3 mb-3 flex items-end gap-3 flex-wrap">
        <Field label="С">
          <input type="date" name="from" defaultValue={currentFilters.from} className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
        </Field>
        <Field label="По">
          <input type="date" name="to" defaultValue={currentFilters.to} className="text-[12px] border border-line rounded px-2 py-1 bg-paper" />
        </Field>
        <Field label="Город">
          <select name="city" defaultValue={currentFilters.city} className="text-[12px] border border-line rounded px-2 py-1 bg-paper min-w-[140px]">
            <option value="all">— все —</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <button type="submit" className="px-3 py-1.5 text-[12px] font-semibold bg-navy text-white rounded">Применить</button>
        <Button onClick={(e) => { e.preventDefault(); setAdding(true); }} className="ml-auto">
          <Plus size={14} /> Добавить расход
        </Button>
      </form>

      {/* Добавление */}
      {adding && <ExpenseForm onCancel={() => setAdding(false)} cities={cities} />}

      {/* KPI */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <KpiCard label="Всего расходов" value={`${formatMoney(totalAmount)} zł`} highlight="danger" />
        <KpiCard label="Записей" value={String(expenses.length)} />
        <KpiCard label="Топ категория" value={byCategory[0]?.category ?? '—'} subtitle={byCategory[0] ? `${formatMoney(byCategory[0].total)} zł` : ''} />
        <KpiCard label="Топ город" value={byCity[0]?.name ?? '—'} subtitle={byCity[0] ? `${formatMoney(byCity[0].total)} zł` : ''} />
      </div>

      {/* Сводки */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
        <Summary title="По городам" rows={byCity.map((c) => ({ name: c.name, total: c.total, sub: `${c.count} запис.` }))} />
        <Summary title="По категориям" rows={byCategory.map((c) => ({ name: c.category, total: c.total }))} />
      </div>

      {/* Таблица */}
      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-line">
          <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
            Все расходы за период
          </h3>
        </div>
        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-bg border-b border-line">
                <Th>Дата</Th>
                <Th>Город</Th>
                <Th>Категория</Th>
                <Th>Описание</Th>
                <Th>Файл</Th>
                <Th>Кто</Th>
                <Th align="right">Сумма</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {expenses.map((e) => (
                <tr key={e.id} className="border-b border-line-2 last:border-0 hover:bg-bg">
                  <td className="px-4 py-2.5 font-mono text-ink-3 whitespace-nowrap">{formatDate(e.spentAt)}</td>
                  <td className="px-4 py-2.5">{e.cityName ?? <span className="text-ink-4">—</span>}</td>
                  <td className="px-4 py-2.5"><Badge>{e.category}</Badge></td>
                  <td className="px-4 py-2.5 text-ink-2 max-w-[280px] truncate">{e.description ?? <span className="text-ink-4">—</span>}</td>
                  <td className="px-4 py-2.5">
                    {e.fileUrl ? (
                      <a href={e.fileUrl} target="_blank" rel="noreferrer" className="text-navy hover:underline inline-flex items-center gap-1 text-[11.5px]">
                        <Paperclip size={12} />
                        {e.fileName ? (e.fileName.length > 22 ? e.fileName.slice(0, 22) + '…' : e.fileName) : 'файл'}
                      </a>
                    ) : <span className="text-ink-4">—</span>}
                  </td>
                  <td className="px-4 py-2.5 text-ink-3">{e.createdByName ?? '—'}</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-danger whitespace-nowrap">−{formatMoney(e.amount)} zł</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      disabled={pending}
                      onClick={() => {
                        if (!confirm('Удалить запись расхода?')) return;
                        startTransition(() => deleteExpense(e.id).then(() => location.reload()));
                      }}
                      className="p-1.5 text-ink-3 hover:text-danger hover:bg-bg rounded"
                      aria-label="Удалить"
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {expenses.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-ink-4">
                    Расходов за период нет
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ExpenseForm({ onCancel, cities }: { onCancel: () => void; cities: Array<{ id: string; name: string }> }) {
  const [cityId, setCityId] = useState(cities[0]?.id ?? '');
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState('');
  const [spentAt, setSpentAt] = useState(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState('');
  const [file, setFile] = useState<{ url: string; name: string; size: number } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (f: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', f);
      fd.append('bucket', 'expenses');
      const res = await fetch('/api/files/upload-generic', { method: 'POST', body: fd });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setFile({ url: data.url, name: f.name, size: f.size });
    } catch (e) {
      alert('Ошибка загрузки: ' + (e instanceof Error ? e.message : 'неизвестная'));
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    if (!category.trim()) return alert('Укажите категорию');
    if (!amount || Number(amount) <= 0) return alert('Сумма должна быть больше 0');
    startTransition(async () => {
      try {
        await upsertExpense({
          cityId: cityId || undefined,
          category: category.trim(),
          amount: Number(amount),
          spentAt,
          description,
          fileUrl: file?.url,
          fileName: file?.name,
          fileSize: file?.size,
        });
        onCancel();
        location.reload();
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  };

  return (
    <div className="bg-paper border border-line rounded-lg p-4 mb-3">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[14px] font-bold text-ink">Новый расход</h3>
        <button onClick={onCancel} className="p-1.5 text-ink-3 hover:text-ink hover:bg-bg rounded" aria-label="Закрыть">
          <X size={16} />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
        <Field label="Дата">
          <input type="date" value={spentAt} onChange={(e) => setSpentAt(e.target.value)}
            className="w-full text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper" />
        </Field>
        <Field label="Город">
          <select value={cityId} onChange={(e) => setCityId(e.target.value)}
            className="w-full text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper">
            <option value="">— без города —</option>
            {cities.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Сумма (zł)">
          <input type="number" min={0} step={1} value={amount} onChange={(e) => setAmount(e.target.value)}
            className="w-full text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper font-mono" />
        </Field>
      </div>

      <Field label="Категория">
        <input list="exp-cats" value={category} onChange={(e) => setCategory(e.target.value)}
          placeholder="Напр. интернет, аренда, ZUS"
          className="w-full text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper" />
        <datalist id="exp-cats">
          {COMMON_CATEGORIES.map((c) => <option key={c} value={c} />)}
        </datalist>
      </Field>

      <Field label="Описание (опционально)">
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="w-full text-[12.5px] border border-line rounded px-2 py-1.5 bg-paper" />
      </Field>

      <div className="mb-3 mt-2">
        <input
          type="file"
          ref={fileRef}
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) upload(f);
          }}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="text-[12px] text-navy border border-line rounded px-3 py-1.5 hover:bg-bg inline-flex items-center gap-1.5"
        >
          <Paperclip size={13} />
          {uploading ? 'Загрузка…' : file ? `✓ ${file.name}` : 'Прикрепить скан'}
        </button>
        {file && (
          <button onClick={() => setFile(null)} className="ml-2 text-[12px] text-ink-3 hover:text-danger">
            убрать
          </button>
        )}
      </div>

      <div className="flex justify-end gap-2 mt-4">
        <button onClick={onCancel} className="px-3 py-1.5 text-[12px] text-ink-3 border border-line rounded hover:bg-bg">
          Отмена
        </button>
        <button onClick={save} disabled={pending}
          className="px-3 py-1.5 text-[12px] font-semibold bg-navy text-white rounded inline-flex items-center gap-1.5 disabled:opacity-50">
          <Save size={13} /> Сохранить
        </button>
      </div>
    </div>
  );
}

function Summary({ title, rows }: { title: string; rows: Array<{ name: string; total: number; sub?: string }> }) {
  const max = Math.max(1, ...rows.map((r) => r.total));
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">{title}</h3>
      </div>
      <div className="p-3">
        {rows.length === 0 ? (
          <div className="text-center py-4 text-ink-4 text-[12px]">Нет данных</div>
        ) : (
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.name}>
                <div className="flex items-center justify-between text-[12px] mb-1">
                  <span className="text-ink-2 font-medium">{r.name}</span>
                  <span className="font-mono font-semibold text-danger">−{formatMoney(r.total)} zł</span>
                </div>
                <div className="h-1.5 rounded bg-bg overflow-hidden">
                  <div className="h-full bg-danger/70" style={{ width: `${(r.total / max) * 100}%` }} />
                </div>
                {r.sub && <div className="text-[10.5px] text-ink-4 mt-0.5">{r.sub}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 mb-2">
      <span className="text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">{label}</span>
      {children}
    </label>
  );
}

function KpiCard({ label, value, subtitle, highlight }: { label: string; value: string; subtitle?: string; highlight?: 'danger' | 'success' | 'default' }) {
  return (
    <div className="bg-paper border border-line rounded-lg p-3.5">
      <div className="text-[10.5px] text-ink-4 uppercase tracking-[0.06em] font-semibold mb-1.5">{label}</div>
      <div className={`text-[18px] font-bold tracking-tight font-mono leading-tight ${highlight === 'danger' ? 'text-danger' : highlight === 'success' ? 'text-success' : ''}`}>{value}</div>
      {subtitle && <div className="text-[10.5px] text-ink-4 mt-1">{subtitle}</div>}
    </div>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
