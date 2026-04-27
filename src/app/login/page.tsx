'use client';

import { useState, type FormEvent } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import { Input, FormField } from '@/components/ui/input';
import { AlertCircle } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const callbackUrl = params.get('callbackUrl') || '/funnel';

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');

    const res = await signIn('credentials', {
      email:    email.trim().toLowerCase(),
      password,
      redirect: false,
    });

    setLoading(false);

    if (res?.error) {
      setError('Неверный email или пароль');
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-bg px-4 py-10">
      <div className="w-full max-w-[400px]">
        {/* Логотип */}
        <div className="flex justify-center mb-7">
          <Logo size="lg" />
        </div>

        {/* Карточка */}
        <div className="bg-paper border border-line rounded-lg p-6 md:p-7 shadow-sm">
          <h1 className="text-[18px] font-bold text-ink mb-1">Вход в CRM</h1>
          <p className="text-[12.5px] text-ink-3 mb-5">
            Введите ваш email и пароль для входа в систему.
          </p>

          <form onSubmit={onSubmit} className="flex flex-col gap-3">
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
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
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
              disabled={loading}
            >
              {loading ? 'Вход...' : 'Войти'}
            </Button>
          </form>
        </div>

        <p className="text-center text-[11px] text-ink-4 mt-5">
          Возникли проблемы с входом? Свяжитесь с администратором.
        </p>
      </div>
    </div>
  );
}
