'use client';

import { useState, useTransition } from 'react';
import { Check, RotateCcw, Calculator } from 'lucide-react';
import { markCommissionPaidOut, recalcCommissionsForUser } from './actions';

export function CommissionsActions({ id, paidOut }: { id: string; paidOut: boolean }) {
  const [pending, startTransition] = useTransition();

  if (paidOut) {
    return (
      <button
        disabled={pending}
        onClick={() =>
          startTransition(() =>
            markCommissionPaidOut(id, false).then(() => location.reload()),
          )
        }
        title="Отменить отметку о выплате"
        className="p-1.5 text-ink-3 hover:text-ink hover:bg-bg rounded disabled:opacity-50"
      >
        <RotateCcw size={14} />
      </button>
    );
  }
  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(() =>
          markCommissionPaidOut(id, true).then(() => location.reload()),
        )
      }
      title="Отметить как выплачено"
      className="px-2 py-1 text-[11px] font-semibold border border-success text-success rounded hover:bg-success hover:text-white transition-colors disabled:opacity-50"
    >
      <Check size={12} className="inline mr-1" />
      выплатить
    </button>
  );
}

/**
 * Кнопка «Пересчитать премии» в сводке по менеджеру.
 * Применяет актуальный User.commissionPercent ко всем НЕвыплаченным комиссиям
 * этого менеджера. Видна только админу (фильтрация на уровне action'а через requireAdmin).
 *
 * Сценарий: Igor выставил Юле %, но премии остались со старым/fallback процентом
 * потому что были созданы при платеже до изменения. Кнопка пересчитывает их.
 */
export function RecalcUserCommissions({ userId, userName }: { userId: string; userName: string }) {
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<string | null>(null);

  function onClick() {
    if (!confirm(`Пересчитать невыплаченные премии менеджера ${userName} по актуальному %?\n\nВыплаченные премии не изменятся.`)) {
      return;
    }
    startTransition(async () => {
      try {
        const res = await recalcCommissionsForUser(userId);
        if (res.updated === 0) {
          setResult(`Проверено ${res.totalChecked}, изменений нет`);
        } else {
          const sign = res.delta >= 0 ? '+' : '';
          setResult(`Обновлено ${res.updated} из ${res.totalChecked} · дельта ${sign}${res.delta} zł`);
        }
        setTimeout(() => location.reload(), 1500);
      } catch (e) {
        setResult('Ошибка: ' + (e as Error).message);
      }
    });
  }

  return (
    <div className="inline-flex flex-col items-end gap-0.5">
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        title={`Применить актуальный % к невыплаченным премиям ${userName}`}
        className="inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold border border-line text-ink-2 rounded hover:border-navy hover:text-navy transition-colors disabled:opacity-50"
      >
        <Calculator size={11} />
        {pending ? 'Пересчёт...' : 'Пересчитать'}
      </button>
      {result && (
        <span className="text-[10px] text-ink-3 whitespace-nowrap">{result}</span>
      )}
    </div>
  );
}
