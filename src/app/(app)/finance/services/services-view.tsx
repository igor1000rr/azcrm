'use client';

// Управление услугами: список, добавление, редактирование, цены и %.
import { useState, useTransition } from 'react';
import { Plus, Pencil, Trash2, Save, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { formatMoney } from '@/lib/utils';
import { upsertService, deleteService, setCommissionStartPayment } from './actions';

interface Service {
  id: string;
  name: string;
  description: string | null;
  basePrice: number;
  salesCommissionPercent: number;
  legalCommissionPercent: number;
  funnelId: string | null;
  funnelName: string | null;
  position: number;
  isActive: boolean;
}

interface Props {
  services: Service[];
  funnels: Array<{ id: string; name: string }>;
  commissionStartFromN: number;
}

export function ServicesView({ services, funnels, commissionStartFromN }: Props) {
  const [editing, setEditing] = useState<Service | null>(null);
  const [adding, setAdding] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <div className="p-4 md:p-5 max-w-[1280px] w-full">
      {/* Глобальная настройка комиссий */}
      <div className="bg-paper border border-line rounded-lg p-4 mb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h3 className="text-[13px] font-bold text-ink mb-1">Когда начислять комиссии менеджерам</h3>
            <p className="text-[11.5px] text-ink-3">
              Сейчас: с {commissionStartFromN === 1 ? '1-го' : '2-го'} платежа в лиде
            </p>
          </div>
          <div className="flex border border-line rounded-md p-0.5">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                disabled={pending || commissionStartFromN === n}
                onClick={() => startTransition(() => setCommissionStartPayment(n).then(() => location.reload()))}
                className={`px-3 py-1.5 text-[12px] font-medium rounded ${
                  commissionStartFromN === n ? 'bg-navy text-white' : 'text-ink-3 hover:text-ink'
                }`}
              >
                С {n === 1 ? '1-го' : '2-го'} платежа
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between">
          <h2 className="text-[14px] font-bold text-ink">Услуги ({services.filter((s) => s.isActive).length} активных)</h2>
          <Button onClick={() => setAdding(true)}>
            <Plus size={14} /> Добавить
          </Button>
        </div>

        <div className="overflow-x-auto thin-scroll">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-bg border-b border-line">
                <Th>Название</Th>
                <Th>Воронка</Th>
                <Th align="right">Цена</Th>
                <Th align="right">% продаж</Th>
                <Th align="right">% легал.</Th>
                <Th>Статус</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {adding && (
                <ServiceRow
                  service={null}
                  funnels={funnels}
                  onCancel={() => setAdding(false)}
                  onSave={() => setAdding(false)}
                />
              )}
              {services.map((s) =>
                editing?.id === s.id ? (
                  <ServiceRow
                    key={s.id}
                    service={s}
                    funnels={funnels}
                    onCancel={() => setEditing(null)}
                    onSave={() => setEditing(null)}
                  />
                ) : (
                  <tr key={s.id} className={`border-b border-line-2 last:border-0 hover:bg-bg ${!s.isActive ? 'opacity-50' : ''}`}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-ink">{s.name}</div>
                      {s.description && <div className="text-[11px] text-ink-3 mt-0.5">{s.description}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-ink-3">{s.funnelName ?? '—'}</td>
                    <td className="px-4 py-2.5 text-right font-mono">{formatMoney(s.basePrice)} zł</td>
                    <td className="px-4 py-2.5 text-right font-mono">{s.salesCommissionPercent}%</td>
                    <td className="px-4 py-2.5 text-right font-mono">{s.legalCommissionPercent}%</td>
                    <td className="px-4 py-2.5">
                      {s.isActive ? <Badge>активна</Badge> : <Badge>деактивирована</Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <button
                        onClick={() => setEditing(s)}
                        className="p-1.5 text-ink-3 hover:text-ink hover:bg-bg rounded mr-1"
                        aria-label="Редактировать"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        disabled={pending}
                        onClick={() => {
                          if (!confirm(`Удалить услугу "${s.name}"?\nЕсли есть лиды с этой услугой — она будет деактивирована.`)) return;
                          startTransition(() => deleteService(s.id).then(() => location.reload()));
                        }}
                        className="p-1.5 text-ink-3 hover:text-danger hover:bg-bg rounded"
                        aria-label="Удалить"
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  </tr>
                ),
              )}
              {services.length === 0 && !adding && (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-ink-4">
                    Услуг пока нет. Нажмите «Добавить»
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

function ServiceRow({
  service, funnels, onCancel, onSave,
}: {
  service: Service | null;
  funnels: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(service?.name ?? '');
  const [description, setDescription] = useState(service?.description ?? '');
  const [basePrice, setBasePrice] = useState(String(service?.basePrice ?? 0));
  const [salesPct, setSalesPct] = useState(String(service?.salesCommissionPercent ?? 5));
  const [legalPct, setLegalPct] = useState(String(service?.legalCommissionPercent ?? 5));
  const [funnelId, setFunnelId] = useState(service?.funnelId ?? '');
  const [isActive, setIsActive] = useState(service?.isActive ?? true);
  const [pending, startTransition] = useTransition();

  const handleSave = () => {
    if (!name.trim()) {
      alert('Укажите название');
      return;
    }
    startTransition(async () => {
      try {
        await upsertService({
          id: service?.id,
          name: name.trim(),
          description: description.trim(),
          basePrice: Number(basePrice) || 0,
          salesCommissionPercent: Number(salesPct) || 0,
          legalCommissionPercent: Number(legalPct) || 0,
          funnelId: funnelId || undefined,
          position: service?.position ?? 0,
          isActive,
        });
        onSave();
        location.reload();
      } catch (e) {
        alert(e instanceof Error ? e.message : 'Ошибка');
      }
    });
  };

  return (
    <tr className="border-b border-line-2 bg-bg/40">
      <td className="px-4 py-2.5">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Название услуги"
          className="w-full text-[12.5px] font-semibold border border-line rounded px-2 py-1 bg-paper"
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Описание (опционально)"
          className="w-full text-[11.5px] border border-line rounded px-2 py-1 mt-1 bg-paper"
        />
      </td>
      <td className="px-4 py-2.5">
        <select
          value={funnelId}
          onChange={(e) => setFunnelId(e.target.value)}
          className="text-[12px] border border-line rounded px-2 py-1 bg-paper"
        >
          <option value="">— любая —</option>
          {funnels.map((f) => (
            <option key={f.id} value={f.id}>{f.name}</option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2.5">
        <input
          type="number"
          min={0}
          step={50}
          value={basePrice}
          onChange={(e) => setBasePrice(e.target.value)}
          className="w-24 text-right text-[12.5px] border border-line rounded px-2 py-1 bg-paper font-mono"
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={salesPct}
          onChange={(e) => setSalesPct(e.target.value)}
          className="w-16 text-right text-[12.5px] border border-line rounded px-2 py-1 bg-paper font-mono"
        />
      </td>
      <td className="px-4 py-2.5">
        <input
          type="number"
          min={0}
          max={100}
          step={0.5}
          value={legalPct}
          onChange={(e) => setLegalPct(e.target.value)}
          className="w-16 text-right text-[12.5px] border border-line rounded px-2 py-1 bg-paper font-mono"
        />
      </td>
      <td className="px-4 py-2.5">
        <label className="flex items-center gap-1.5 text-[11.5px] cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={(e) => setIsActive(e.target.checked)}
          />
          {isActive ? 'активна' : 'выкл'}
        </label>
      </td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button
          onClick={handleSave}
          disabled={pending}
          className="p-1.5 text-success hover:bg-bg rounded mr-1 disabled:opacity-50"
          aria-label="Сохранить"
        >
          <Save size={14} />
        </button>
        <button
          onClick={onCancel}
          className="p-1.5 text-ink-3 hover:bg-bg rounded"
          aria-label="Отмена"
        >
          <X size={14} />
        </button>
      </td>
    </tr>
  );
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'right' }) {
  return (
    <th className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold ${align === 'right' ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
