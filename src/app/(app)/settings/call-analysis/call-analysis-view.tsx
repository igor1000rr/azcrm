'use client';

// UI настроек анализа звонков (Anna идея №12).
// Две карточки — Whisper (транскрипция) и LLM (sentiment-анализ),
// с кнопкой «Тест подключения» в каждой и пресетами провайдеров.

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Save, CheckCircle, XCircle, Loader2, Mic, Brain, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FormField, Select } from '@/components/ui/input';
import { saveCallAnalysisSettings, testWhisperConnection, testLlmConnection } from './actions';
import type { CallAnalysisConfig } from '@/lib/call-analysis-config';

interface Props {
  config:   CallAnalysisConfig;
  envFlags: Record<keyof CallAnalysisConfig, boolean>;
}

interface Preset {
  label:    string;
  apiBase:  string;
  models:   string[];          // популярные модели
  hint?:    string;
}

// Пресеты Whisper — все OpenAI-совместимые
const WHISPER_PRESETS: Preset[] = [
  { label: 'OpenAI',     apiBase: 'https://api.openai.com/v1',         models: ['whisper-1'] },
  { label: 'Groq',       apiBase: 'https://api.groq.com/openai/v1',    models: ['whisper-large-v3', 'whisper-large-v3-turbo'], hint: 'Быстрее и дешевле OpenAI' },
];

// Пресеты LLM — для анализа транскрипта
const LLM_PRESETS: Preset[] = [
  { label: 'OpenAI',  apiBase: 'https://api.openai.com/v1',      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] },
  { label: 'Groq',    apiBase: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-70b-versatile', 'mixtral-8x7b-32768'], hint: 'Быстрее всего' },
  { label: 'xAI Grok', apiBase: 'https://api.x.ai/v1',           models: ['grok-2-latest', 'grok-2', 'grok-beta'], hint: 'API через console.x.ai' },
  { label: 'OpenRouter', apiBase: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct'], hint: 'Гейтвей ко всем моделям' },
];

export function CallAnalysisView({ config, envFlags }: Props) {
  const router = useRouter();
  const [form, setForm] = useState<CallAnalysisConfig>(config);
  const [showWhisperKey, setShowWhisperKey] = useState(false);
  const [showLlmKey, setShowLlmKey]         = useState(false);
  const [busy, setBusy]   = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [whisperTest, setWhisperTest] = useState<{ ok: boolean; message: string } | null>(null);
  const [llmTest, setLlmTest]         = useState<{ ok: boolean; message: string } | null>(null);
  const [whisperTesting, setWhisperTesting] = useState(false);
  const [llmTesting, setLlmTesting]         = useState(false);

  function update<K extends keyof CallAnalysisConfig>(key: K, value: CallAnalysisConfig[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSuccess(null);
  }

  async function save() {
    setError(null); setSuccess(null); setBusy(true);
    try {
      await saveCallAnalysisSettings(form);
      setSuccess('Настройки сохранены');
      router.refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function runWhisperTest() {
    setWhisperTest(null); setWhisperTesting(true);
    try {
      // Сохраняем перед тестом — тест читает из БД
      await saveCallAnalysisSettings(form);
      const res = await testWhisperConnection();
      setWhisperTest(res);
    } catch (e) {
      setWhisperTest({ ok: false, message: (e as Error).message });
    } finally { setWhisperTesting(false); }
  }

  async function runLlmTest() {
    setLlmTest(null); setLlmTesting(true);
    try {
      await saveCallAnalysisSettings(form);
      const res = await testLlmConnection();
      setLlmTest(res);
    } catch (e) {
      setLlmTest({ ok: false, message: (e as Error).message });
    } finally { setLlmTesting(false); }
  }

  function applyWhisperPreset(label: string) {
    const p = WHISPER_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setForm((f) => ({ ...f, whisperApiBase: p.apiBase, whisperModel: p.models[0] }));
  }

  function applyLlmPreset(label: string) {
    const p = LLM_PRESETS.find((x) => x.label === label);
    if (!p) return;
    setForm((f) => ({ ...f, llmApiBase: p.apiBase, llmModel: p.models[0] }));
  }

  const enabled = Boolean(form.whisperApiKey && form.llmApiKey);

  return (
    <div className="p-4 md:p-5 max-w-[920px] w-full flex flex-col gap-4">

      {/* Шапка */}
      <div className="bg-paper border border-line rounded-lg p-4 flex items-start gap-3 flex-wrap">
        <div className="w-9 h-9 rounded-md bg-info text-white grid place-items-center shrink-0">
          <Mic size={16} />
        </div>
        <div className="flex-1 min-w-[200px]">
          <h2 className="text-[15px] font-bold tracking-tight">Расшифровка и анализ звонков</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            Cron каждые 15 мин берёт звонки с записью, транскрибирует через Whisper и анализирует через LLM
            (sentiment + summary + tags). Проблемные звонки (NEGATIVE) уведомляют менеджера.
          </p>
        </div>
        <span className={`text-[11px] font-bold uppercase tracking-[0.05em] px-2 py-0.5 rounded-full ${enabled ? 'bg-success-bg text-success' : 'bg-bg text-ink-4'}`}>
          {enabled ? '● включено' : 'выключено'}
        </span>
      </div>

      {/* WHISPER */}
      <div className="bg-paper border border-line rounded-lg p-4 md:p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <Mic size={14} className="text-info" />
          <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-ink-2">Whisper API — транскрипция</h3>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-3">
          <span className="text-[11px] text-ink-4 self-center mr-1">Пресет:</span>
          {WHISPER_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyWhisperPreset(p.label)}
              className="text-[11.5px] px-2 py-0.5 rounded-md border border-line bg-paper hover:border-info hover:text-info transition-colors"
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="API ключ" required={!envFlags.whisperApiKey} hint={envFlags.whisperApiKey ? 'Сейчас взят из .env — введите тут чтобы перебить' : 'Из дашборда провайдера'}>
            <div className="relative">
              <Input
                type={showWhisperKey ? 'text' : 'password'}
                value={form.whisperApiKey}
                onChange={(e) => update('whisperApiKey', e.target.value)}
                placeholder={envFlags.whisperApiKey ? '••• из .env •••' : 'sk-...'}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowWhisperKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
                tabIndex={-1}
              >
                {showWhisperKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </FormField>
          <FormField label="API base URL" hint={envFlags.whisperApiBase ? 'Из .env' : 'OpenAI-совместимый endpoint'}>
            <Input
              value={form.whisperApiBase}
              onChange={(e) => update('whisperApiBase', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-[12px]"
            />
          </FormField>
          <FormField label="Модель" hint={envFlags.whisperModel ? 'Из .env' : 'whisper-1 (OpenAI) / whisper-large-v3 (Groq)'}>
            {WHISPER_PRESETS.find((p) => p.apiBase === form.whisperApiBase)?.models ? (
              <Select value={form.whisperModel} onChange={(e) => update('whisperModel', e.target.value)}>
                {WHISPER_PRESETS.find((p) => p.apiBase === form.whisperApiBase)?.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {!WHISPER_PRESETS.find((p) => p.apiBase === form.whisperApiBase)?.models.includes(form.whisperModel) && (
                  <option value={form.whisperModel}>{form.whisperModel}</option>
                )}
              </Select>
            ) : (
              <Input
                value={form.whisperModel}
                onChange={(e) => update('whisperModel', e.target.value)}
                className="font-mono text-[12px]"
              />
            )}
          </FormField>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button onClick={runWhisperTest} disabled={whisperTesting || !form.whisperApiKey}>
            {whisperTesting ? <Loader2 size={11} className="animate-spin" /> : null}
            Тест подключения
          </Button>
          {whisperTest && (
            <span className={`inline-flex items-center gap-1.5 text-[11.5px] px-2 py-0.5 rounded ${whisperTest.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
              {whisperTest.ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
              {whisperTest.message}
            </span>
          )}
        </div>
      </div>

      {/* LLM */}
      <div className="bg-paper border border-line rounded-lg p-4 md:p-5">
        <div className="flex items-center gap-2.5 mb-3">
          <Brain size={14} className="text-warn" />
          <h3 className="text-[13px] font-bold uppercase tracking-[0.05em] text-ink-2">LLM — sentiment и summary</h3>
        </div>

        <div className="flex gap-1.5 flex-wrap mb-3">
          <span className="text-[11px] text-ink-4 self-center mr-1">Пресет:</span>
          {LLM_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={() => applyLlmPreset(p.label)}
              className="text-[11.5px] px-2 py-0.5 rounded-md border border-line bg-paper hover:border-warn hover:text-warn transition-colors"
              title={p.hint}
            >
              {p.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="API ключ" required={!envFlags.llmApiKey} hint={envFlags.llmApiKey ? 'Сейчас взят из .env — введите тут чтобы перебить' : 'Из дашборда провайдера'}>
            <div className="relative">
              <Input
                type={showLlmKey ? 'text' : 'password'}
                value={form.llmApiKey}
                onChange={(e) => update('llmApiKey', e.target.value)}
                placeholder={envFlags.llmApiKey ? '••• из .env •••' : 'sk-... / xai-...'}
                className="pr-9"
              />
              <button
                type="button"
                onClick={() => setShowLlmKey((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-4 hover:text-ink-2"
                tabIndex={-1}
              >
                {showLlmKey ? <EyeOff size={13} /> : <Eye size={13} />}
              </button>
            </div>
          </FormField>
          <FormField label="API base URL" hint={envFlags.llmApiBase ? 'Из .env' : 'OpenAI-совместимый /chat/completions'}>
            <Input
              value={form.llmApiBase}
              onChange={(e) => update('llmApiBase', e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="font-mono text-[12px]"
            />
          </FormField>
          <FormField label="Модель" hint={envFlags.llmModel ? 'Из .env' : 'gpt-4o-mini / grok-2 / llama-3.3-70b-versatile'}>
            {LLM_PRESETS.find((p) => p.apiBase === form.llmApiBase)?.models ? (
              <Select value={form.llmModel} onChange={(e) => update('llmModel', e.target.value)}>
                {LLM_PRESETS.find((p) => p.apiBase === form.llmApiBase)?.models.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
                {!LLM_PRESETS.find((p) => p.apiBase === form.llmApiBase)?.models.includes(form.llmModel) && (
                  <option value={form.llmModel}>{form.llmModel}</option>
                )}
              </Select>
            ) : (
              <Input
                value={form.llmModel}
                onChange={(e) => update('llmModel', e.target.value)}
                className="font-mono text-[12px]"
              />
            )}
          </FormField>
        </div>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          <Button onClick={runLlmTest} disabled={llmTesting || !form.llmApiKey}>
            {llmTesting ? <Loader2 size={11} className="animate-spin" /> : null}
            Тест подключения
          </Button>
          {llmTest && (
            <span className={`inline-flex items-center gap-1.5 text-[11.5px] px-2 py-0.5 rounded ${llmTest.ok ? 'bg-success-bg text-success' : 'bg-danger-bg text-danger'}`}>
              {llmTest.ok ? <CheckCircle size={11} /> : <XCircle size={11} />}
              {llmTest.message}
            </span>
          )}
        </div>
      </div>

      {/* Сохранить */}
      <div className="bg-paper border border-line rounded-lg p-4 flex items-center gap-3 flex-wrap">
        <div className="flex-1 min-w-[200px]">
          {error   && <div className="text-[12.5px] text-danger">{error}</div>}
          {success && <div className="text-[12.5px] text-success flex items-center gap-1.5"><CheckCircle size={11} /> {success}</div>}
          {!error && !success && (
            <p className="text-[11.5px] text-ink-4">
              После сохранения cron подхватит новые ключи автоматически — перезапуск сервера не нужен.
              Если задано в .env — поля помечены пометкой и могут быть переопределены здесь.
            </p>
          )}
        </div>
        <Button variant="primary" onClick={save} disabled={busy}>
          {busy ? <Loader2 size={11} className="animate-spin" /> : <Save size={11} />}
          {busy ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </div>
    </div>
  );
}
