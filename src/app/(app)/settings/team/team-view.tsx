'use client';

// UI: управление пользователями
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus, Edit3, Power, Key, CheckCircle, XCircle } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Select, FormField } from '@/components/ui/input';
import { formatRelative } from '@/lib/utils';
import {
  upsertUser, toggleUserActive, resetUserPassword,
} from './actions';
import type { UserRole } from '@prisma/client';

interface UserLite {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  phone: string | null;
  isActive: boolean;
  lastSeenAt: string | null;
  createdAt: string;
  googleConnected: boolean;
  activeLeadsCount: number;
}

export function TeamView({ users }: { users: UserLite[] }) {
  const [editing, setEditing] = useState<UserLite | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetting, setResetting] = useState<UserLite | null>(null);

  const grouped = {
    ADMIN: users.filter((u) => u.role === 'ADMIN'),
    SALES: users.filter((u) => u.role === 'SALES'),
    LEGAL: users.filter((u) => u.role === 'LEGAL'),
  };

  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full">
      <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">Команда</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            {users.filter((u) => u.isActive).length} активных из {users.length}
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus size={12} /> Добавить сотрудника
        </Button>
      </div>

      <div className="flex flex-col gap-3">
        {(['ADMIN', 'SALES', 'LEGAL'] as const).map((role) => grouped[role].length > 0 && (
          <RoleGroup
            key={role}
            role={role}
            users={grouped[role]}
            onEdit={setEditing}
            onResetPassword={setResetting}
          />
        ))}
      </div>

      {(editing || creating) && (
        <UserFormModal
          user={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}

      {resetting && (
        <ResetPasswordModal
          user={resetting}
          onClose={() => setResetting(null)}
        />
      )}
    </div>
  );
}

function RoleGroup({
  role, users, onEdit, onResetPassword,
}: {
  role: UserRole;
  users: UserLite[];
  onEdit: (u: UserLite) => void;
  onResetPassword: (u: UserLite) => void;
}) {
  const router = useRouter();

  async function onPower(u: UserLite) {
    try {
      await toggleUserActive(u.id, !u.isActive);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  const label = role === 'ADMIN' ? 'Администраторы' :
                role === 'SALES' ? 'Менеджеры продаж' : 'Менеджеры легализации';

  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-2.5 border-b border-line bg-bg">
        <h3 className="text-[12px] font-bold uppercase tracking-[0.05em] text-ink-2">
          {label} ({users.length})
        </h3>
      </div>

      <div className="divide-y divide-line">
        {users.map((u) => (
          <div key={u.id} className={`px-4 py-3 flex items-center gap-3 flex-wrap ${!u.isActive ? 'opacity-50' : ''}`}>
            <Avatar name={u.name} size="md" status={u.isActive ? 'online' : 'offline'} />
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center gap-2 flex-wrap">
                <strong className="text-[14px] text-ink">{u.name}</strong>
                {!u.isActive && <Badge>деактивирован</Badge>}
                {u.googleConnected && <Badge variant="info" withDot>Google</Badge>}
              </div>
              <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                <span className="font-mono">{u.email}</span>
                {u.phone && <span className="font-mono">· {u.phone}</span>}
                <span>· {u.activeLeadsCount} лидов</span>
                {u.lastSeenAt && <span>· был {formatRelative(u.lastSeenAt)}</span>}
              </div>
            </div>
            <div className="flex gap-1.5">
              <Button size="sm" onClick={() => onEdit(u)}>
                <Edit3 size={11} />
              </Button>
              <Button size="sm" onClick={() => onResetPassword(u)}>
                <Key size={11} />
              </Button>
              <Button size="sm" variant="ghost" onClick={() => onPower(u)}>
                <Power size={11} />
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function UserFormModal({
  user, onClose,
}: {
  user: UserLite | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [email, setEmail]       = useState(user?.email ?? '');
  const [name, setName]         = useState(user?.name ?? '');
  const [role, setRole]         = useState<UserRole>(user?.role ?? 'SALES');
  const [phone, setPhone]       = useState(user?.phone ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy]         = useState(false);
  const [err, setErr]           = useState<string | null>(null);

  async function save() {
    setErr(null);
    setBusy(true);
    try {
      await upsertUser({
        id:       user?.id,
        email,
        name,
        role,
        phone:    phone || null,
        password: password || undefined,
        isActive: user?.isActive ?? true,
      });
      router.refresh();
      onClose();
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={user ? 'Редактирование сотрудника' : 'Новый сотрудник'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !email || !name || (!user && !password)}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormField label="ФИО" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Email" required>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </FormField>
          <FormField label="Телефон">
            <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+48..." />
          </FormField>
          <FormField label="Роль" required>
            <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)}>
              <option value="SALES">Менеджер продаж</option>
              <option value="LEGAL">Менеджер легализации</option>
              <option value="ADMIN">Администратор</option>
            </Select>
          </FormField>
        </div>

        <FormField
          label={user ? 'Новый пароль (оставьте пустым чтобы не менять)' : 'Пароль'}
          required={!user}
          hint="Минимум 6 символов"
        >
          <Input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
          />
        </FormField>

        {err && (
          <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">
            {err}
          </div>
        )}
      </div>
    </Modal>
  );
}

function ResetPasswordModal({
  user, onClose,
}: { user: UserLite; onClose: () => void }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await resetUserPassword(user.id, password);
      setDone(true);
    } catch (e) { alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={`Сброс пароля: ${user.name}`}
      footer={done ? (
        <Button variant="primary" onClick={onClose}>Готово</Button>
      ) : (
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || password.length < 6}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      )}
    >
      {done ? (
        <div className="text-center py-4">
          <CheckCircle size={32} className="mx-auto text-success mb-2" />
          <p className="text-[13px] text-ink-2">Пароль изменён.</p>
          <p className="text-[12px] text-ink-3 mt-2">
            Передайте сотруднику новый пароль:{' '}
            <code className="bg-bg px-2 py-0.5 rounded font-mono text-ink">{password}</code>
          </p>
        </div>
      ) : (
        <FormField label="Новый пароль" required hint="Минимум 6 символов">
          <Input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus
          />
        </FormField>
      )}
    </Modal>
  );
}
