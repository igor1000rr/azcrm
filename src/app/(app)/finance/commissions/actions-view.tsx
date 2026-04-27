'use client';

import { useTransition } from 'react';
import { Check, RotateCcw } from 'lucide-react';
import { markCommissionPaidOut } from './actions';

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
