'use client';

// UI для CRUD городов
import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Star, Edit2, Check, X, Power, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  createCity, renameCity, toggleCity, deleteCity, setDefaultCity,
} from './actions';

interface CityRow {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  usageCount: number;
}

export function CitiesView({ cities }: { cities: CityRow[] }) {
  const router = useRouter();
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [busy, setBusy] = useState(false);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!newName.trim() || busy) return;
    setBusy(true);
    try {
      await createCity({ name: newName.trim() });
      setNewName('');
      setAdding(false);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось добавить');
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(id: string) {
    if (!editName.trim() || busy) return;
    setBusy(true);
    try {
      await renameCity(id, { name: editName.trim() });
      setEditingId(null);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось переименовать');
    } finally {
      setBusy(false);
    }
  }

  async function handleToggle(c: CityRow) {
    setBusy(true);
    try {
      await toggleCity(c.id, !c.isActive);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(c: CityRow) {
    if (!confirm(`Удалить город «${c.name}»?`)) return;
    setBusy(true);
    try {
      await deleteCity(c.id);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Не удалось удалить');
    } finally {
      setBusy(false);
    }
  }

  async function handleSetDefault(c: CityRow) {
    setBusy(true);
    try {
      await setDefaultCity(c.id);
      router.refresh();
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Ошибка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      {/* Шапка */}
      <div className="px-4 py-3 border-b border-line flex items-center justify-between">
        <div>
          <h1 className="text-[15px] font-bold text-ink">Города</h1>
          <p className="text-[12px] text-ink-3 mt-0.5">
            Используются для города обращения, города работы и расходов
          </p>
        </div>
        {!adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={13} /> Добавить город
          </Button>
        )}
      </div>

      {/* Форма добавления */}
      {adding && (
        <form onSubmit={handleAdd} className="px-4 py-3 border-b border-line bg-bg flex gap-2">
          <input
            type="text"
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Например: Краков, Гданьск"
            className="flex-1 px-3 py-1.5 text-[13px] bg-paper border border-line rounded-md focus:border-navy focus:outline-none"
          />
          <Button type="submit" disabled={!newName.trim() || busy}>
            <Check size={13} /> Добавить
          </Button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewName(''); }}
            className="px-3 py-1.5 text-[12.5px] text-ink-3 hover:text-ink"
          >
            Отмена
          </button>
        </form>
      )}

      {/* Список */}
      <div>
        {cities.length === 0 ? (
          <div className="px-4 py-12 text-center text-ink-4 text-[13px]">
            Городов пока нет. Добавьте первый.
          </div>
        ) : (
          cities.map((c) => (
            <div
              key={c.id}
              className={cn(
                'flex items-center gap-2 px-4 py-2.5 border-b border-line-2 last:border-0',
                !c.isActive && 'bg-bg opacity-60',
              )}
            >
              {/* Звёздочка по умолчанию */}
              <button
                type="button"
                onClick={() => handleSetDefault(c)}
                disabled={busy || c.isDefault}
                className={cn(
                  'shrink-0 transition-colors',
                  c.isDefault ? 'text-gold' : 'text-ink-5 hover:text-gold',
                  busy && 'cursor-not-allowed',
                )}
                title={c.isDefault ? 'Город по умолчанию' : 'Сделать городом по умолчанию'}
              >
                <Star size={14} className={c.isDefault ? 'fill-gold' : ''} />
              </button>

              {/* Имя — режим редактирования или просмотра */}
              <div className="flex-1 min-w-0">
                {editingId === c.id ? (
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      autoFocus
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRename(c.id);
                        else if (e.key === 'Escape') setEditingId(null);
                      }}
                      className="flex-1 px-2 py-1 text-[13px] bg-paper border border-line rounded-md focus:border-navy focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => handleRename(c.id)}
                      disabled={busy}
                      className="text-success p-1 hover:bg-success-bg rounded"
                      title="Сохранить"
                    >
                      <Check size={14} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingId(null)}
                      className="text-ink-4 p-1 hover:bg-bg rounded"
                      title="Отмена"
                    >
                      <X size={14} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-semibold text-ink">{c.name}</span>
                    {c.isDefault && (
                      <span className="text-[10px] px-1.5 py-px bg-gold-pale text-gold rounded font-semibold">
                        по умолчанию
                      </span>
                    )}
                    {!c.isActive && (
                      <span className="text-[10px] px-1.5 py-px bg-bg-alt text-ink-4 rounded font-medium">
                        отключён
                      </span>
                    )}
                    {c.usageCount > 0 && (
                      <span className="text-[11px] text-ink-4">
                        используется в {c.usageCount}
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Действия */}
              {editingId !== c.id && (
                <div className="flex items-center gap-0.5 shrink-0">
                  <button
                    type="button"
                    onClick={() => { setEditingId(c.id); setEditName(c.name); }}
                    className="text-ink-4 hover:text-ink p-1.5 rounded hover:bg-bg"
                    title="Переименовать"
                  >
                    <Edit2 size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggle(c)}
                    disabled={busy}
                    className={cn(
                      'p-1.5 rounded hover:bg-bg',
                      c.isActive ? 'text-ink-3 hover:text-ink' : 'text-success',
                    )}
                    title={c.isActive ? 'Отключить' : 'Включить'}
                  >
                    <Power size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDelete(c)}
                    disabled={busy || c.usageCount > 0}
                    className={cn(
                      'p-1.5 rounded',
                      c.usageCount > 0
                        ? 'text-ink-5 cursor-not-allowed'
                        : 'text-ink-4 hover:text-danger hover:bg-danger-bg',
                    )}
                    title={c.usageCount > 0
                      ? 'Нельзя удалить — используется. Сначала отключите.'
                      : 'Удалить'}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
