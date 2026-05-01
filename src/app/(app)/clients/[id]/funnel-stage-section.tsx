'use client';

// Отдельная секция «Воронка / этап» над «Сделка» в карточке лида
// (Anna 01.05.2026). Селекты воронки и этапа — менеджер может
// перевести лид в другую воронку, либо просто сменить этап.
//
// Сделано отдельным файлом, чтобы не править гигантский lead-card-view.tsx
// (84KB) — добавляется рендером одной строки в LeadCardView.

import { FunnelStageSwitcher } from './funnel-stage-switcher';

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
  currentFunnelName: string;
  currentStageName:  string;
  funnels:          FunnelLite[];
}

export function FunnelStageSection({
  leadId, currentFunnelId, currentStageId,
  currentFunnelName, currentStageName, funnels,
}: Props) {
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-ink-2 uppercase tracking-[0.04em]">
            Воронка и этап
          </h3>
          <span className="text-[11px] px-1.5 py-px rounded bg-bg text-ink-3 font-semibold">
            {currentFunnelName} · {currentStageName}
          </span>
        </div>
      </div>
      <div className="p-4 md:p-5">
        <FunnelStageSwitcher
          leadId={leadId}
          currentFunnelId={currentFunnelId}
          currentStageId={currentStageId}
          funnels={funnels}
        />
        <div className="mt-2 text-[11px] text-ink-4">
          При смене воронки услуги по лиду сбрасываются — выберите их заново
          в секции «Услуги» ниже.
        </div>
      </div>
    </div>
  );
}
