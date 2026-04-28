'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { changeMyPassword } from './actions';

export function ChangePasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword,     setNewPassword]     = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy,  setBusy]  = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await changeMyPassword({ currentPassword, newPassword, confirmPassword });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Сбрасываем поля и идём на главную (layout перечитает флаг из БД)
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      router.replace('/');
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink-2">Текущий пароль</span>
        <input
          type="password"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
          autoComplete="current-password"
          autoFocus
          className="px-3 py-2 text-[13px] bg-bg border border-line rounded-md focus:border-navy focus:outline-none"
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink-2">Новый пароль</span>
        <input
          type="password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className="px-3 py-2 text-[13px] bg-bg border border-line rounded-md focus:border-navy focus:outline-none"
        />
        <span className="text-[11px] text-ink-4">Минимум 8 символов</span>
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[12px] font-semibold text-ink-2">Подтвердите новый пароль</span>
        <input
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          required
          autoComplete="new-password"
          className="px-3 py-2 text-[13px] bg-bg border border-line rounded-md focus:border-navy focus:outline-none"
        />
      </label>

      {error && (
        <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !currentPassword || !newPassword || !confirmPassword}
        className="mt-2 px-4 py-2 bg-navy text-gold text-[13px] font-semibold rounded-md disabled:opacity-50 hover:bg-navy/90"
      >
        {busy ? 'Сохранение...' : 'Сменить пароль'}
      </button>
    </form>
  );
}
