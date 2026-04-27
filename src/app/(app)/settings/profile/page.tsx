// Профиль — личные настройки + выход
import { Topbar } from '@/components/topbar';
import { Avatar } from '@/components/ui/avatar';
import { db } from '@/lib/db';
import { requireUser } from '@/lib/auth';
import { LogoutButton } from './logout-button';
import { PushSubscriptionButton } from '@/components/push-subscription-button';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const user = await requireUser();

  const fullUser = await db.user.findUnique({
    where: { id: user.id },
    select: {
      id: true, email: true, name: true, role: true, phone: true,
      lastSeenAt: true, createdAt: true, googleConnectedAt: true,
    },
  });

  if (!fullUser) return null;

  return (
    <>
      <Topbar
        breadcrumbs={[{ label: 'CRM' }, { label: 'Настройки' }, { label: 'Профиль' }]}
      />

      <div className="p-4 md:p-5 max-w-[640px] w-full">
        <div className="bg-paper border border-line rounded-lg p-5 md:p-6">
          <div className="flex items-center gap-4 mb-5 pb-5 border-b border-line">
            <Avatar name={fullUser.name} size="xl" />
            <div>
              <h1 className="text-[18px] font-bold tracking-tight">{fullUser.name}</h1>
              <div className="text-[12px] text-ink-3 mt-0.5">{fullUser.email}</div>
              <div className="text-[11px] text-ink-4 mt-1">
                {({ADMIN: 'Администратор', SALES: 'Менеджер продаж', LEGAL: 'Менеджер легализации'} as Record<string,string>)[fullUser.role]}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-[13px]">
            <Field label="Email">{fullUser.email}</Field>
            <Field label="Телефон">{fullUser.phone || '—'}</Field>
            <Field label="В системе с">
              {fullUser.createdAt.toLocaleDateString('ru-RU')}
            </Field>
            <Field label="Google Calendar">
              {fullUser.googleConnectedAt
                ? <span className="text-success font-semibold">подключен · {fullUser.googleConnectedAt.toLocaleDateString('ru-RU')}</span>
                : <a href="/api/google/auth" className="text-info hover:underline font-medium">Подключить</a>}
            </Field>
          </div>

          <div className="mt-6 pt-5 border-t border-line">
            <h3 className="text-[12px] font-bold uppercase tracking-[0.05em] text-ink-2 mb-3">
              Push-уведомления
            </h3>
            <p className="text-[12px] text-ink-3 mb-3">
              Получайте уведомления в браузере о новых сообщениях, передаче лидов и упоминаниях.
            </p>
            <PushSubscriptionButton />
          </div>

          <div className="mt-6 pt-5 border-t border-line">
            <LogoutButton />
          </div>
        </div>
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-1">
        {label}
      </div>
      <div className="text-ink">{children}</div>
    </div>
  );
}
