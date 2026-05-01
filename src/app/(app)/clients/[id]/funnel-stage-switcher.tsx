'use client';

// Селекты «Воронка» и «Этап» для карточки лида (Anna 01.05.2026).
// Менеджер может перевести лид в другую воронку или сменить этап.
//
// Если меняется воронка — этап автоматом сбрасывается на первый этап
// новой воронки (и server-action то же делает дополнительной защитой).
// Если меняется только этап — он должен принадлежать текущей воронке.
//
// При смене воронки сервер удаляет leadServices и обнуляет serviceId
// (прайс-листы разные). Менеджер пересобирает услуги в карточке.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui/input';
import { changeLeadStage } from '../../actions';
import { changeLeadFunnel } from './funnel-actions';

interface FunnelLite {
  id: string;
  name: string;
  isActive: boolean;
  stages: Array<{ id: string; name: string; position: number }>;
}

interface Props {
  leadId:           string;
  currentFunnelId:  string;
  currentStageId:   string;
  funnels:          FunnelLite[];
}

export function FunnelStageSwitcher({
  leadId, currentFunnelId, currentStageId, funnels,
}: Props) {
  const router = useRouter();
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Активные воронки + текущая (даже если отключена — чтобы было видно)
  const visibleFunnels = funnels.filter(
    (f) => f.isActive || f.id === currentFunnelId,
  );

  const currentFunnel = funnels.find((f) => f.id === currentFunnelId);
  const stages = currentFunnel?.stages ?? [];

  async function handleFunnel(newFunnelId: string) {
    if (newFunnelId === currentFunnelId) return;
    const target = funnels.find((f) => f.id === newFunnelId);
    if (!target) return;
    const ok = confirm(
      `Перевести лид в воронку «${target.name}»?\n\n` +
      `Услуги по лиду и привязанная услуга будут сброшены — ` +
      `придётся выбрать заново после смены воронки.`,
    );
    if (!ok) return;

    setError(null); setBusy(true);
    try {
      await changeLeadFunnel(leadId, newFunnelId);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message || 'Не удалось сменить воронку');
    } finally {
      setBusy(false);
    }
  }

  async function handleStage(newStageId: string) {
    if (newStageId === currentStageId) return;
    setError(null); setBusy(true);
    try {
      await changeLeadStage(leadId, newStageId);
      startTransition(() => router.refresh());
    } catch (e) {
      setError((e as Error).message || 'Не удалось сменить этап');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <Select
          value={currentFunnelId}
          onChange={(e) => handleFunnel(e.target.value)}
          disabled={busy}
          className="text-[12.5px] py-0.5"
          aria-label="Воронка"
        >
          {visibleFunnels.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}{!f.isActive ? ' (отключена)' : ''}
            </option>
          ))}
        </Select>
        <Select
          value={currentStageId}
          onChange={(e) => handleStage(e.target.value)}
          disabled={busy || stages.length === 0}
          className="text-[12.5px] py-0.5"
          aria-label="Этап воронки"
        >
          {stages.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </Select>
      </div>
      {error && (
        <div className="text-[11.5px] text-danger">{error}</div>
      )}
    </div>
  );
}
