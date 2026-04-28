import { redirect } from 'next/navigation';
import { auth } from '@/lib/auth';
import { ChangePasswordForm } from './change-password-form';

export const dynamic = 'force-dynamic';

export default async function ChangePasswordPage() {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const mustChange = Boolean(session.user.mustChangePassword);

  return (
    <div className="min-h-dvh grid place-items-center bg-bg p-6">
      <div className="w-full max-w-md bg-paper border border-line rounded-lg p-6">
        <h1 className="text-[18px] font-bold text-ink tracking-tight mb-1">
          {mustChange ? 'Смените пароль' : 'Смена пароля'}
        </h1>
        <p className="text-[13px] text-ink-3 mb-5">
          {mustChange
            ? 'При первом входе обязательно смените выданный временный пароль на свой собственный.'
            : 'Измените пароль своей учётной записи.'}
        </p>

        <ChangePasswordForm />
      </div>
    </div>
  );
}
