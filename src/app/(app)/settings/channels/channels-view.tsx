'use client';

// UI: список каналов WhatsApp + подключение через QR
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, QrCode, Smartphone, Trash2, Edit3, Power,
  CheckCircle, XCircle, Loader2, RefreshCw,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Select, FormField } from '@/components/ui/input';
import { cn, formatRelative, formatPhone } from '@/lib/utils';
import {
  upsertWhatsappAccount, deleteWhatsappAccount, toggleWhatsappAccount,
} from './actions';
import type { UserRole } from '@prisma/client';

interface AccountLite {
  id: string;
  phoneNumber: string;
  label: string;
  ownerId: string | null;
  ownerName: string | null;
  isConnected: boolean;
  isActive: boolean;
  lastSeenAt: string | null;
  threadsCount: number;
  messagesCount: number;
}

interface Props {
  accounts: AccountLite[];
  users: Array<{ id: string; name: string; role: UserRole }>;
}

export function ChannelsView({ accounts, users }: Props) {
  const [editing, setEditing]   = useState<AccountLite | null>(null);
  const [creating, setCreating] = useState(false);
  const [qrFor, setQrFor]       = useState<AccountLite | null>(null);

  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full">
      <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
        <div>
          <h2 className="text-[15px] font-bold tracking-tight">WhatsApp каналы</h2>
          <p className="text-[12px] text-ink-3 mt-0.5">
            {accounts.length} {plural(accounts.length, 'канал', 'канала', 'каналов')} ·
            {' '}{accounts.filter((a) => a.isConnected).length} подключено
          </p>
        </div>
        <Button variant="primary" className="ml-auto" onClick={() => setCreating(true)}>
          <Plus size={12} /> Добавить канал
        </Button>
      </div>

      <div className="bg-paper border border-line rounded-lg overflow-hidden">
        {accounts.length === 0 ? (
          <div className="p-10 text-center">
            <Smartphone size={36} className="mx-auto text-ink-5 mb-3" />
            <h3 className="text-[14px] font-semibold mb-1">Каналов пока нет</h3>
            <p className="text-[12px] text-ink-3">
              Добавьте номер телефона и подключите его через QR-код
            </p>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {accounts.map((a) => (
              <ChannelRow
                key={a.id}
                account={a}
                onEdit={() => setEditing(a)}
                onConnect={() => setQrFor(a)}
              />
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-ink-4 mt-3">
        Канал без владельца — общий, видят все менеджеры.
        Канал с владельцем — личный, видит только указанный менеджер.
      </p>

      {/* Модалка создания/редактирования */}
      {(editing || creating) && (
        <AccountFormModal
          account={editing}
          users={users}
          onClose={() => { setEditing(null); setCreating(false); }}
        />
      )}

      {/* Модалка QR */}
      {qrFor && (
        <QrConnectModal
          account={qrFor}
          onClose={() => setQrFor(null)}
        />
      )}
    </div>
  );
}

function ChannelRow({
  account, onEdit, onConnect,
}: {
  account: AccountLite;
  onEdit: () => void;
  onConnect: () => void;
}) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm(`Удалить канал «${account.label}»? Переписки сохранятся.`)) return;
    try {
      await deleteWhatsappAccount(account.id);
      router.refresh();
    } catch (e) { console.error(e); alert('Ошибка удаления'); }
  }

  async function onToggle() {
    try {
      await toggleWhatsappAccount(account.id, !account.isActive);
      router.refresh();
    } catch (e) { console.error(e); }
  }

  return (
    <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-1 min-w-[260px]">
        <div className={cn(
          'w-10 h-10 rounded-md grid place-items-center shrink-0',
          account.isConnected ? 'bg-success-bg text-success' : 'bg-bg text-ink-4',
        )}>
          <Smartphone size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-[14px] text-ink">{account.label}</strong>
            {account.isConnected
              ? <Badge variant="success" withDot>подключён</Badge>
              : <Badge variant="default">не подключён</Badge>}
            {!account.isActive && <Badge variant="default">отключён</Badge>}
            {!account.ownerId && <Badge variant="gold">общий</Badge>}
          </div>
          <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-x-3 font-mono">
            <span>{formatPhone(account.phoneNumber)}</span>
            {account.ownerName && <span className="font-sans">· {account.ownerName}</span>}
            <span className="font-sans">· {account.threadsCount} переписок</span>
            {account.lastSeenAt && (
              <span className="font-sans">· был онлайн {formatRelative(account.lastSeenAt)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 ml-auto">
        {!account.isConnected && account.isActive && (
          <Button variant="primary" size="sm" onClick={onConnect}>
            <QrCode size={11} /> Подключить
          </Button>
        )}
        {account.isConnected && (
          <Button variant="warn" size="sm" onClick={onConnect}>
            <RefreshCw size={11} /> Переподключить
          </Button>
        )}
        <Button size="sm" onClick={onEdit} title="Редактировать">
          <Edit3 size={11} />
        </Button>
        <Button size="sm" onClick={onToggle} title={account.isActive ? 'Отключить' : 'Включить'}>
          <Power size={11} />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Удалить">
          <Trash2 size={11} />
        </Button>
      </div>
    </div>
  );
}

function AccountFormModal({
  account, users, onClose,
}: {
  account: AccountLite | null;
  users: Array<{ id: string; name: string; role: UserRole }>;
  onClose: () => void;
}) {
  const router = useRouter();
  const [phone, setPhone]     = useState(account?.phoneNumber ?? '+48');
  const [label, setLabel]     = useState(account?.label ?? '');
  const [ownerId, setOwnerId] = useState(account?.ownerId ?? '');
  const [busy, setBusy]       = useState(false);

  async function save() {
    if (!phone || !label) return;
    setBusy(true);
    try {
      await upsertWhatsappAccount({
        id:          account?.id,
        phoneNumber: phone,
        label,
        ownerId:     ownerId || null,
      });
      router.refresh();
      onClose();
    } catch (e) { console.error(e); alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title={account ? 'Редактирование канала' : 'Новый канал WhatsApp'}
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !phone || !label}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <FormField label="Номер телефона" required hint="В международном формате с +">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+48 731 006 935" />
        </FormField>
        <FormField label="Название" required hint="Как будет отображаться в списке">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Общий / Yuliia / ..." />
        </FormField>
        <FormField label="Владелец канала" hint="Если выбрать — видит только этот менеджер. Иначе общий">
          <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
            <option value="">— общий канал (видят все) —</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role === 'ADMIN' ? 'Админ' : u.role === 'SALES' ? 'Продажи' : 'Легализация'})
              </option>
            ))}
          </Select>
        </FormField>
      </div>
    </Modal>
  );
}

function QrConnectModal({
  account, onClose,
}: {
  account: AccountLite;
  onClose: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'qr' | 'connecting' | 'ready' | 'failed'>('loading');
  const [qrUrl, setQrUrl]   = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function start() {
      try {
        const res = await fetch('/api/whatsapp/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accountId: account.id }),
        });
        const data = await res.json();
        if (cancelled) return;

        if (data.status === 'ready') {
          setStatus('ready');
          setTimeout(() => { router.refresh(); onClose(); }, 1500);
          return;
        }
        if (data.status === 'qr' && data.qr) {
          setQrUrl(data.qr);
          setStatus('qr');
          startPolling();
          return;
        }
        if (data.status === 'failed') {
          setError(data.error || 'не удалось подключиться');
          setStatus('failed');
          return;
        }
        setStatus('connecting');
        startPolling();
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          setStatus('failed');
        }
      }
    }

    function startPolling() {
      pollRef.current = setInterval(async () => {
        try {
          const res = await fetch('/api/whatsapp/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: account.id }),
          });
          const data = await res.json();
          if (cancelled) return;

          if (data.status === 'ready') {
            setStatus('ready');
            stopPolling();
            setTimeout(() => { router.refresh(); onClose(); }, 1500);
          } else if (data.status === 'qr' && data.qr && data.qr !== qrUrl) {
            setQrUrl(data.qr);
          } else if (data.status === 'failed') {
            setStatus('failed');
            stopPolling();
          }
        } catch {}
      }, 2000);
    }

    function stopPolling() {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    }

    start();

    return () => {
      cancelled = true;
      stopPolling();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  return (
    <Modal open={true} onClose={onClose} title={`Подключение: ${account.label}`}>
      <div className="text-center">
        {status === 'loading' && (
          <div className="py-8">
            <Loader2 size={32} className="mx-auto text-ink-4 animate-spin mb-3" />
            <p className="text-[13px] text-ink-3">Подготовка...</p>
          </div>
        )}

        {status === 'qr' && qrUrl && (
          <>
            <div className="bg-white border border-line rounded-lg p-4 inline-block mb-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={qrUrl} alt="WhatsApp QR" className="w-[280px] h-[280px]" />
            </div>
            <h3 className="text-[14px] font-semibold mb-2">Отсканируйте QR-код</h3>
            <ol className="text-[12.5px] text-ink-3 text-left max-w-sm mx-auto leading-relaxed">
              <li>1. Откройте WhatsApp на телефоне</li>
              <li>2. Настройки → <strong>Связанные устройства</strong></li>
              <li>3. Нажмите <strong>Привязать устройство</strong></li>
              <li>4. Отсканируйте этот код</li>
            </ol>
          </>
        )}

        {status === 'connecting' && (
          <div className="py-8">
            <Loader2 size={32} className="mx-auto text-info animate-spin mb-3" />
            <p className="text-[13px] text-ink-3">Авторизация...</p>
          </div>
        )}

        {status === 'ready' && (
          <div className="py-8">
            <CheckCircle size={36} className="mx-auto text-success mb-3" />
            <h3 className="text-[15px] font-bold text-success">Подключено!</h3>
          </div>
        )}

        {status === 'failed' && (
          <div className="py-8">
            <XCircle size={36} className="mx-auto text-danger mb-3" />
            <h3 className="text-[14px] font-bold text-danger mb-1">Не удалось подключиться</h3>
            {error && <p className="text-[12px] text-ink-3">{error}</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
