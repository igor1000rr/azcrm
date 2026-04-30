// Настройки → Анализ звонков (Anna идея №12)
// Только ADMIN. Конфиг Whisper + LLM хранится в Setting (БД).
import { Topbar } from '@/components/topbar';
import { requireAdmin } from '@/lib/auth';
import { getCallAnalysisConfig, getStoredCallAnalysisConfig } from '@/lib/call-analysis-config';
import { CallAnalysisView } from './call-analysis-view';

export const dynamic = 'force-dynamic';

export default async function CallAnalysisSettingsPage() {
  await requireAdmin();

  // Эффективный конфиг (с fallback на ENV) — для отображения и тестов
  const effective = await getCallAnalysisConfig();
  // Что лежит в БД — для подсказок "это поле задано в .env"
  const stored    = await getStoredCallAnalysisConfig();

  // Какие поля заданы только через ENV (т.е. в БД пусто, а в effective есть значение)
  const envFlags = {
    whisperApiKey:  Boolean(!stored.whisperApiKey  && effective.whisperApiKey),
    whisperApiBase: Boolean(!stored.whisperApiBase && effective.whisperApiBase),
    whisperModel:   Boolean(!stored.whisperModel   && effective.whisperModel),
    llmApiKey:      Boolean(!stored.llmApiKey      && effective.llmApiKey),
    llmApiBase:     Boolean(!stored.llmApiBase     && effective.llmApiBase),
    llmModel:       Boolean(!stored.llmModel       && effective.llmModel),
  };

  return (
    <>
      <Topbar
        breadcrumbs={[
          { label: 'CRM' },
          { label: 'Настройки' },
          { label: 'Анализ звонков' },
        ]}
      />
      <CallAnalysisView config={effective} envFlags={envFlags} />
    </>
  );
}
