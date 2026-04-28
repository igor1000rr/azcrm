'use client';

// Сводная таблица ЗП с редактируемыми полями ставка/налог/фикс
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
  fixedSalary: number;
  taxAmount: number;
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
              <Th align="right">Часы</Th>
              <Th align="right">Ставка/час</Th>
              <Th align="right">Ставка × часы</Th>
              <Th align="right" tooltip="Фиксированная часть зарплаты в злотых за месяц — не зависит от часов и сделок. Можно оставить 0.">
                Фикс. часть
              </Th>
              <Th align="right" tooltip="Премия с приведённых клиентов: % от платежей по правилам роли (продажи — с предоплаты, легализация — со 2-го платежа).">
                Премия
              </Th>
              <Th align="right">Налог</Th>
              <Th align="right" tooltip="Грязный = ставка × часы + фикс. часть + премии">Грязный итог</Th>
              <Th align="right" tooltip="Чистый = грязный − налог">Чистый итог</Th>
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
                  <td className="px-4 py-2.5 text-right font-mono">{formatMoney(r.fixedSalary)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono text-success font-semibold">
                    {formatMoney(r.totalCommission)} zł
                    {r.pending > 0 && (
                      <span className="block text-[10px] text-warn">к выплате {formatMoney(r.pending)} zł</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right font-mono text-danger">−{formatMoney(r.taxAmount)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono">{formatMoney(r.grossTotal)} zł</td>
                  <td className="px-4 py-2.5 text-right font-mono font-bold text-success">{formatMoney(r.netTotal)} zł</td>
                  <td className="px-4 py-2.5 text-right">
                    <button
                      onClick={() => setEditing(r.id)}
                      className="p-1.5 text-ink-3 hover:text-ink hover:bg-bg rounded"
                      aria-label="Изменить ставки"
                      title={r.hasConfig ? 'Изменить' : 'Настроить'}
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
  const [fixed, setFixed] = useState(String(row.fixedSalary));
  const [tax, setTax] = useState(String(row.taxAmount));
  const [pending, startTransition] = useTransition();

  const save = () => {
    startTransition(async () => {
      try {
        await upsertPayrollConfig({
          userId: row.id,
          hourlyRate: Number(hourly) || 0,
          fixedSalary: Number(fixed) || 0,
          taxAmount: Number(tax) || 0,
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
          className="w-24 text-right text-[12px] border border-line rounded px-2 py-1 bg-paper font-mono" />
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-3">
        {formatMoney((Number(hourly) || 0) * row.totalHours)} zł
      </td>
      <td className="px-4 py-2.5">
        <input type="number" min={0} step={50} value={fixed} onChange={(e) => setFixed(e.target.value)}
          title="Фиксированная часть зарплаты за месяц — не зависит от часов и премий. Можно оставить 0."
          className="w-28 text-right text-[12px] border border-line rounded px-2 py-1 bg-paper font-mono" />
      </td>
      <td className="px-4 py-2.5 text-right font-mono text-ink-3">{formatMoney(row.totalCommission)} zł</td>
      <td className="px-4 py-2.5">
        <input type="number" min={0} step={50} value={tax} onChange={(e) => setTax(e.target.value)}
          className="w-24 text-right text-[12px] border border-line rounded px-2 py-1 bg-paper font-mono" />
      </td>
      <td className="px-4 py-2.5" colSpan={2}></td>
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
