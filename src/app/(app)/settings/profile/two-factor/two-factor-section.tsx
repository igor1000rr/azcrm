'use client';

// UI секция «Двухфакторная аутентификация» в /settings/profile.
// Состояния:
//   - off:       2FA выключена. Кнопка «Включить».
//   - setup:     показан QR + поле для подтверждения первого кода.
//   - codes:     показаны новые backup-коды (один раз).
//   - on:        2FA включена. Кнопки «Перегенерировать коды» и «Отключить».
//   - confirm-pwd: модалка ввода пароля (для disable / regen).

import { useState, useTransition, type FormEvent } from 'react';
import {
  ShieldCheck, ShieldOff, AlertCircle, Copy, Check, Download, RefreshCw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import {
  start2faSetup, confirm2faSetup, disable2fa, regenerateBackupCodes,
} from './actions';

interface Props {
  enabled: boolean;
}

type Mode = 'idle' | 'setup' | 'showCodes' | 'pwdDisable' | 'pwdRegen';

export function TwoFactorSection({ enabled }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [pending, startTransition] = useTransition();

  // Setup-состояние
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [secret, setSecret]       = useState<string | null>(null);
  const [setupCode, setSetupCode] = useState('');
  const [error, setError]         = useState<string | null>(null);

  // Backup-коды (после успешного confirm или regenerate)
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);

  // Пароль для disable/regen
  const [pwd, setPwd] = useState('');
  const [pwdError, setPwdError] = useState<string | null>(null);

  function reset() {
    setMode('idle');
    setQrDataUrl(null); setSecret(null); setSetupCode('');
    setBackupCodes(null);
    setPwd(''); setPwdError(null); setError(null);
  }

  async function onClickEnable() {
    setError(null);
    startTransition(async () => {
      try {
        const res = await start2faSetup();
        setQrDataUrl(res.qrDataUrl);
        setSecret(res.secret);
        setMode('setup');
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  async function onConfirmSetup(e: FormEvent) {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const res = await confirm2faSetup(setupCode);
      if (!res.ok) {
        setError(res.error || 'Не удалось подтвердить код');
        return;
      }
      setBackupCodes(res.backupCodes ?? []);
      setMode('showCodes');
    });
  }

  async function onConfirmDisable(e: FormEvent) {
    e.preventDefault();
    setPwdError(null);
    startTransition(async () => {
      const res = await disable2fa(pwd);
      if (!res.ok) {
        setPwdError(res.error || 'Не удалось отключить');
        return;
      }
      reset();
      // router.refresh не нужен — revalidatePath в server action перезагрузит данные
      window.location.reload();
    });
  }

  async function onConfirmRegen(e: FormEvent) {
    e.preventDefault();
    setPwdError(null);
    startTransition(async () => {
      const res = await regenerateBackupCodes(pwd);
      if (!res.ok) {
        setPwdError(res.error || 'Не удалось сгенерировать');
        return;
      }
      setBackupCodes(res.backupCodes ?? []);
      setPwd('');
      setMode('showCodes');
    });
  }

  return (
    <div className="mt-6 pt-5 border-t border-line">
      <h3 className="text-[12px] font-bold uppercase tracking-[0.05em] text-ink-2 mb-3">
        Двухфакторная аутентификация
      </h3>

      {!enabled ? (
        <>
          <p className="text-[12px] text-ink-3 mb-3 leading-relaxed">
            Защитите аккаунт кодом из приложения-аутентификатора. Даже если
            пароль украдут, без кода с вашего телефона войти не смогут.
            Совместимо с Google Authenticator, Authy, 1Password, Microsoft
            Authenticator.
          </p>
          <Button onClick={onClickEnable} disabled={pending} variant="primary">
            <ShieldCheck size={13} /> {pending ? 'Подготовка...' : 'Включить 2FA'}
          </Button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-2 text-[13px] mb-3">
            <ShieldCheck size={16} className="text-success" />
            <strong className="text-success">2FA активна</strong>
            <span className="text-ink-3">— при входе запрашивается код из приложения</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <Button onClick={() => { reset(); setMode('pwdRegen'); }} disabled={pending}>
              <RefreshCw size={11} /> Перегенерировать резервные коды
            </Button>
            <Button onClick={() => { reset(); setMode('pwdDisable'); }} disabled={pending} variant="ghost">
              <ShieldOff size={11} /> Отключить
            </Button>
          </div>
        </>
      )}

      {/* Модалка setup — показывает QR и просит ввести первый код */}
      {mode === 'setup' && qrDataUrl && secret && (
        <Modal open={true} onClose={reset} title="Настройка 2FA" size="md">
          <form onSubmit={onConfirmSetup} className="flex flex-col gap-4">
            <ol className="text-[12.5px] text-ink-3 leading-relaxed list-decimal pl-4">
              <li>Откройте приложение-аутентификатор на телефоне (Google Authenticator, Authy, 1Password)</li>
              <li>Нажмите «+» / «Добавить аккаунт» → «Сканировать QR»</li>
              <li>Отсканируйте код ниже и введите 6-значный код из приложения</li>
            </ol>
            <div className="flex justify-center bg-bg/40 border border-line rounded-md p-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrDataUrl} alt="QR для 2FA" className="w-[220px] h-[220px]" />
            </div>
            <div className="text-[11px] text-ink-3">
              Не сканируется? Введите вручную: <code className="font-mono bg-bg px-1.5 py-0.5 rounded select-all">{secret}</code>
            </div>
            <FormField label="Код из приложения" htmlFor="setupCode">
              <Input
                id="setupCode"
                value={setupCode}
                onChange={(e) => setSetupCode(e.target.value)}
                placeholder="123 456"
                autoFocus
                inputMode="numeric"
                maxLength={7}
                className="text-center text-[16px] tracking-[0.2em] font-mono"
              />
            </FormField>
            {error && (
              <div className="flex items-start gap-2 text-[12.5px] py-2 px-3 rounded-md bg-danger-bg text-danger border border-danger/20">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" onClick={reset} disabled={pending}>Отмена</Button>
              <Button type="submit" variant="primary" disabled={pending || setupCode.replace(/\D/g, '').length !== 6}>
                {pending ? 'Проверка...' : 'Подтвердить и включить'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Модалка с backup-кодами (после setup или regenerate) */}
      {mode === 'showCodes' && backupCodes && (
        <BackupCodesModal codes={backupCodes} onClose={reset} />
      )}

      {/* Модалка ввода пароля для disable */}
      {mode === 'pwdDisable' && (
        <Modal open={true} onClose={reset} title="Отключить 2FA">
          <form onSubmit={onConfirmDisable} className="flex flex-col gap-3">
            <p className="text-[12.5px] text-ink-3">
              Введите пароль чтобы подтвердить отключение двухфакторной защиты.
              После отключения резервные коды станут недействительны.
            </p>
            <FormField label="Пароль" htmlFor="pwd1">
              <Input id="pwd1" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus required />
            </FormField>
            {pwdError && (
              <div className="flex items-start gap-2 text-[12.5px] py-2 px-3 rounded-md bg-danger-bg text-danger border border-danger/20">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{pwdError}</span>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" onClick={reset} disabled={pending}>Отмена</Button>
              <Button type="submit" variant="warn" disabled={pending || !pwd}>
                {pending ? 'Отключение...' : 'Отключить'}
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* Модалка ввода пароля для регенерации backup-кодов */}
      {mode === 'pwdRegen' && (
        <Modal open={true} onClose={reset} title="Новые резервные коды">
          <form onSubmit={onConfirmRegen} className="flex flex-col gap-3">
            <p className="text-[12.5px] text-ink-3">
              Введите пароль. Текущие резервные коды станут недействительны
              и будут выданы 10 новых.
            </p>
            <FormField label="Пароль" htmlFor="pwd2">
              <Input id="pwd2" type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoFocus required />
            </FormField>
            {pwdError && (
              <div className="flex items-start gap-2 text-[12.5px] py-2 px-3 rounded-md bg-danger-bg text-danger border border-danger/20">
                <AlertCircle size={14} className="shrink-0 mt-0.5" />
                <span>{pwdError}</span>
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button type="button" onClick={reset} disabled={pending}>Отмена</Button>
              <Button type="submit" variant="primary" disabled={pending || !pwd}>
                {pending ? 'Генерация...' : 'Сгенерировать'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

function BackupCodesModal({ codes, onClose }: { codes: string[]; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  function copyAll() {
    navigator.clipboard.writeText(codes.join('\n')).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function downloadTxt() {
    const content =
      `AZ Group CRM — резервные коды 2FA\n` +
      `Сгенерированы: ${new Date().toLocaleString('ru-RU')}\n\n` +
      `Каждый код используется ОДИН раз для входа при потере телефона.\n` +
      `Храните в безопасном месте.\n\n` +
      codes.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'az-group-crm-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Modal open={true} onClose={onClose} title="Резервные коды" size="md">
      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-2 text-[12.5px] py-2.5 px-3 rounded-md bg-warn-bg text-warn-text border border-warn/30">
          <AlertCircle size={14} className="shrink-0 mt-0.5" />
          <span>
            Сохраните эти 10 кодов в безопасном месте. Каждый код одноразовый —
            используется при потере телефона. Закрыв это окно, вы больше
            не увидите коды (только сгенерируете новые).
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5 font-mono text-[13px] bg-bg/40 border border-line rounded-md p-3">
          {codes.map((c) => (
            <code key={c} className="select-all py-1 px-2 bg-paper border border-line rounded text-center">
              {c}
            </code>
          ))}
        </div>

        <div className="flex flex-wrap gap-1.5">
          <Button onClick={copyAll}>
            {copied ? <><Check size={11} /> Скопировано</> : <><Copy size={11} /> Копировать все</>}
          </Button>
          <Button onClick={downloadTxt}>
            <Download size={11} /> Скачать .txt
          </Button>
          <Button variant="primary" onClick={onClose} className="ml-auto">
            Я сохранил коды
          </Button>
        </div>
      </div>
    </Modal>
  );
}
