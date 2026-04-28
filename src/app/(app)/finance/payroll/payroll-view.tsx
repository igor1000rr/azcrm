'use client';

// Сводная таблица ЗП с редактируемыми полями: ставка/час, ZUS, PIT.
// Структура (Anna 28.04.2026):
//   Часы | Ставка/час | Ставка × часы | Премия | ZUS | PIT | Грязными свои | Зп чистая
//
// Зп чистая   = ставка × часы + премия       (получает на руки)
// Грязными св = зп чистая + ZUS + PIT        (полная стоимость для компании)
import { useState, useTransition } from 'react';
import { Avatar } from '@/components/ui/avatar';
import { Pencil, Save, X } from 'lucide-react';
import { formatMoney } from '@/lib/utils';
import { upsertPayrollConfig } from './actions';
import type { UserRole } from '@prisma/client';

interface Row {
  id: string;
  name: string;
  role: UserRole;
  hourlyRate: number;
  zus: number;
  pit: number;
  totalHours: number;
  ratePart: number;
  totalCommission: number;
  paidOut: number;
  pending: number;
  grossTotal: number;
  netTotal: number;
  hasConfig: boolean;
}

export function PayrollView({ rows }: { rows: Row[] }) {
  const [editing, setEditing] = useState<string | null>(null);

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-line">
        <h3 className="text-[12.5px] font-bold uppercase tracking-[0.05em] text-ink-2">
          Сводная по менеджерам
        </h3>
      </div>
      <div className="overflow-x-auto thin-scroll">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-bg border-b border-line">
              <Th>Менеджер</Th>
              <Th align="right" tooltip="Сумма часов из табеля рабочего времени за выбранный период.">Часы</Th>
              <Th align="right" tooltip="Ставка за час работы. Задаётся индивидуально по каждому менеджеру.">Ставка/час</Th>
              <Th align="right" tooltip="Ставка × часы — рассчитывается автоматически.">Ставка × часы</Th>
              <Th align="right" tooltip="Премия с приведённых клиентов: % от платежей по правилам роли (продажи — с предоплаты, легализация — со 2-го платежа).">
                Премия
              </Th>
              <Th align="right" tooltip="ZUS — польский соцстрах. Anna вводит сумму вручную.">ZUS</Th>
              <Th align="right" tooltip="PIT — польский подоходный налог. Anna вводит сумму вручную.">PIT</Th>
              <Th align="right" tooltip="Грязными свои = ставка × часы + премия + ZUS + PIT. Полная стоимость менеджера для компании.">
                Грязными свои
              </Th>
              <Th align="right" tooltip="Зп чистая = ставка × часы + премия. Что менеджер получает на руки.">
                Зп чистая
              </Th>
              <Th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) =>
              editing === r.id ? (
                <EditRow key={r.id} row={r} onCancel={() => setEditing(null)} onSave={() => setEditing(null)} />
              ) : (
                <tr key={r.id} className="border-b border-line-2 last:border-0 hover:bg-bg">
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2.5">
                      <Avatar name={r.name} size="sm" />
                      <div>
                        <div className="font-semibold text-ink">{r.name}</div>
                        <div className="text-[10.5px] text-ink-4">{r.role === 'SALES' ? 'Продажи' : 'Легализация'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono">{r.totalHours.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatMoney(r.hourlyRate)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatMoney(r.ratePart)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono text-success font-semibold">
                    {formatMoney(r.totalCommission)} zł
                    {r.pending > 0 && (
                      <span className="block text-[10px] text-warn">к выплате {formatMoney(r.pending)} zł</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(r.zus)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(r.pit)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatMoney(r.grossTotal)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-success">{formatMoney(r.netTotal)} zł</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(r.id)}
                      className="p-1.5 text-ink-3 hover:text-ink hover:bg-bg rounded"
                      aria-label="Изменить ставки"
                      title={r.hasConfig ? 'Изменить ставку, ZUS, PIT' : 'Настроить'}
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ),
            )}
            {rows.length === 0 && (
              <tr>
                <td colSpan={10} className="px-4 py-12 text-center text-ink-4">
                  Активных менеджеров нет
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function EditRow({ row, onCancel, onSave }: { row: Row; onCancel: () => void; onSave: () => void }) {
  const [hourly, setHourly] = useState(String(row.hourlyRate));
  const [zus, setZus] = useState(String(row.zus));
  const [pit, setPit] = useState(String(row.pit));
  const [pending, startTransition] = useTransition();

  // Live-расчёт прямо в строке редактирования
  const hRate = Number(hourly) || 0;
  const zusN  = Number(zus) || 0;
  const pitN  = Number(pit) || 0;
  const ratePart = hRate * row.totalHours;
  const netLive  = ratePart + row.totalCommission;
  const grossLive = netLive + zusN + pitN;

  const save = () => {
    startTransition(async () => {
      try {
        await upsertPayrollConfig({
          userId:     row.id,
          hourlyRate: hRate,
          zus:        zusN,
          pit:        pitN,
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
        <div className="flex items-center gap-2.5">
          <Avatar name={row.name} size="sm" />
          <span className="font-semibold text-ink">{row.name}</span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-3">{row.totalHours.toFixed(1)}</td>
      <td className="px-4 py-2.5">
        <input type="number" min={0} step={1} value={hourly} onChange={(e) => setHourly(e.target.value)}
          title="Ставка за час работы (zł)"
          className="w-24 text-right text-[12px] border border-line rounded px-2 py-1 bg-paper font-mono" />
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-3">
        {formatMoney(ratePart)} zł
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(row.totalCommission)} zł</td>
      <td className="px-4 py-2.5">
        <input type="number" min={0} step={50} value={zus} onChange={(e) => setZus(e.target.value)}
          title="ZUS — польский соцстрах. Введите сумму в злотых."
          className="w-24 text-right text-[12px] border border-line rounded px-2 py-1 bg-paper font-mono" />
      </td>
      <td className="px-4 py-2.5">
        <input type="number" min={0} step={50} value={pit} onChange={(e) => setPit(e.target.value)}
          title="PIT — польский подоходный налог. Введите сумму в злотых."
          className="w-24 text-right text-[12px] border border-line rounded px-2 py-1 bg-paper font-mono" />
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(grossLive)} zł</td>
      <td className="px-4 py-2.5 text-right font-mono font-bold text-success">{formatMoney(netLive)} zł</td>
      <td className="px-4 py-2.5 text-right whitespace-nowrap">
        <button onClick={save} disabled={pending}
          className="p-1.5 text-success hover:bg-bg rounded mr-1 disabled:opacity-50" aria-label="Сохранить">
          <Save size={14} />
        </button>
        <button onClick={onCancel} className="p-1.5 text-ink-3 hover:bg-bg rounded" aria-label="Отмена">
          <X size={14} />
        </button>
      </td>
    </tr>
  );
}

function Th({ children, align, tooltip }: { children?: React.ReactNode; align?: 'right'; tooltip?: string }) {
  return (
    <th
      className={`px-4 py-2.5 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold ${align === 'right' ? 'text-right' : 'text-left'} ${tooltip ? 'cursor-help' : ''}`}
      title={tooltip}
    >
      {children}
      {tooltip && <span className="ml-1 text-ink-5 normal-case lowercase">ⓘ</span>}
    </th>
  );
}
