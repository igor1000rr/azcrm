'use client';

import { Suspense, useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/input';
import { AlertCircle, Eye, EyeOff, ShieldCheck, ArrowLeft } from 'lucide-react';
import { precheckLogin } from './actions';

// Обёртка-страница: внутренний компонент использует useSearchParams,
// поэтому оборачиваем в Suspense (требование Next.js 15 для prerender).
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/funnel';

  // Шаг 1 — email+password
  const [email, setEmail]               = useState('');
  const [password, setPassword]         = useState('');
  const [showPassword, setShowPassword] = useState(false);
  // Шаг 2 — TOTP код (показывается только если у юзера активна 2FA)
  const [step, setStep]                 = useState<'creds' | '2fa'>('creds');
  const [totp, setTotp]                 = useState('');
  // Общее
  const [error, setError]               = useState('');
  const [loading, setLoading]           = useState(false);

  async function onSubmitCreds(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    // Шаг 1: проверяем credentials и узнаём нужна ли 2FA
    const pre = await precheckLogin({ email: email.trim().toLowerCase(), password });
    if (!pre.ok) {
      setLoading(false);
      setError(pre.errorText || 'Неверный email или пароль');
      return;
    }

    if (pre.need2FA) {
      // 2FA включена — переходим ко второму шагу, signIn пока не делаем
      setLoading(false);
      setStep('2fa');
      return;
    }

    // 2FA выключена — сразу signIn без TOTP
    await doSignIn('');
  }

  async function onSubmitTotp(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    await doSignIn(totp.trim());
  }

  async function doSignIn(totpCode: string) {
    const res = await signIn('credentials', {
      email:    email.trim().toLowerCase(),
      password,
      totp:     totpCode,
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      // Если мы на шаге 2FA — скорее всего неверный код; иначе просто общая
      // ошибка credentials. Текст оставляем нейтральным.
      setError(step === '2fa'
        ? 'Неверный код. Проверьте приложение или используйте резервный код.'
        : 'Неверный email или пароль');
      return;
    }
    router.push(callbackUrl);
    router.refresh();
  }

  function backToCreds() {
    setStep('creds');
    setTotp('');
    setError('');
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-7">
          <Logo size="lg" />
        </div>

        <div className="bg-paper border border-line rounded-lg p-6 md:p-7 shadow-sm">
          {step === 'creds' ? (
            <>
              <h1 className="text-[18px] font-bold text-ink mb-1">Вход в CRM</h1>
              <p className="text-[12.5px] text-ink-3 mb-5">
                Введите ваш email и пароль для входа в систему.
              </p>

              <form onSubmit={onSubmitCreds} className="flex flex-col gap-3">
                <FormField label="Email" htmlFor="email">
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    autoComplete="email"
                    autoFocus
                    placeholder="anna@azgroup.pl"
                  />
                </FormField>

                <FormField label="Пароль" htmlFor="password">
                  <div className="relative">
                    <Input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                      autoComplete="current-password"
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      tabIndex={-1}
                      aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                      className="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7 grid place-items-center text-ink-4 hover:text-ink-2 rounded-md transition-colors"
                    >
                      {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  </div>
                </FormField>

                {error && (
                  <div className="flex items-start gap-2 text-[12.5px] py-2 px-3 rounded-md bg-danger-bg text-danger border border-danger/20">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="justify-center mt-1 py-2.5"
                  disabled={loading}
                >
                  {loading ? 'Вход...' : 'Войти'}
                </Button>
              </form>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={18} className="text-success" />
                <h1 className="text-[18px] font-bold text-ink">Двухфакторная защита</h1>
              </div>
              <p className="text-[12.5px] text-ink-3 mb-5">
                Откройте приложение-аутентификатор и введите 6-значный код
                для <strong>{email}</strong>.
              </p>

              <form onSubmit={onSubmitTotp} className="flex flex-col gap-3">
                <FormField label="Код подтверждения" htmlFor="totp" hint="6-значный код или резервный (XXXX-XXXX)">
                  <Input
                    id="totp"
                    type="text"
                    inputMode="text"
                    value={totp}
                    onChange={(e) => setTotp(e.target.value)}
                    required
                    autoComplete="one-time-code"
                    autoFocus
                    placeholder="123 456"
                    className="text-center text-[16px] tracking-[0.2em] font-mono"
                    maxLength={11}
                  />
                </FormField>

                {error && (
                  <div className="flex items-start gap-2 text-[12.5px] py-2 px-3 rounded-md bg-danger-bg text-danger border border-danger/20">
                    <AlertCircle size={14} className="shrink-0 mt-0.5" />
                    <span>{error}</span>
                  </div>
                )}

                <Button
                  type="submit"
                  variant="primary"
                  size="md"
                  className="justify-center mt-1 py-2.5"
                  disabled={loading || totp.trim().length < 6}
                >
                  {loading ? 'Проверка...' : 'Подтвердить'}
                </Button>

                <button
                  type="button"
                  onClick={backToCreds}
                  disabled={loading}
                  className="flex items-center justify-center gap-1 text-[12px] text-ink-3 hover:text-ink-2 transition-colors mt-1"
                >
                  <ArrowLeft size={12} /> назад к вводу пароля
                </button>
              </form>
            </>
          )}
        </div>

        <p className="text-center text-[11px] text-ink-4 mt-5">
          Возникли проблемы с входом? Свяжитесь с администратором.
        </p>
      </div>
    </div>
  );
}

function LoginSkeleton() {
  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        <div className="flex justify-center mb-7">
          <Logo size="lg" />
        </div>
        <div className="bg-paper border border-line rounded-lg p-6 md:p-7 shadow-sm h-[280px]" />
      </div>
    </div>
  );
}
