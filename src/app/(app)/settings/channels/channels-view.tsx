'use client';

// UI: два списка каналов (WhatsApp через QR + Telegram через BotFather token)
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus, QrCode, Smartphone, Trash2, Edit3, Power,
  CheckCircle, XCircle, Loader2, RefreshCw, Send,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Input, Select, FormField } from '@/components/ui/input';
import { cn, formatRelative, formatPhone } from '@/lib/utils';
import {
  upsertWhatsappAccount, deleteWhatsappAccount, toggleWhatsappAccount,
} from './actions';
import {
  connectTelegramBot, disconnectTelegramBot, toggleTelegramBot,
} from './telegram-actions';
import type { UserRole } from '@prisma/client';

interface WaAccount {
  id: string; phoneNumber: string; label: string;
  ownerId: string | null; ownerName: string | null;
  isConnected: boolean; isActive: boolean;
  lastSeenAt: string | null;
  threadsCount: number; messagesCount: number;
}

interface TgAccount {
  id: string; botUsername: string; label: string;
  ownerId: string | null; ownerName: string | null;
  isConnected: boolean; isActive: boolean;
  webhookUrl: string | null;
  lastSeenAt: string | null;
  threadsCount: number; messagesCount: number;
}

interface UserLite { id: string; name: string; role: UserRole }

interface Props {
  waAccounts: WaAccount[];
  tgAccounts: TgAccount[];
  users:      UserLite[];
}

export function ChannelsView({ waAccounts, tgAccounts, users }: Props) {
  // WhatsApp стейт
  const [editingWa, setEditingWa]   = useState<WaAccount | null>(null);
  const [creatingWa, setCreatingWa] = useState(false);
  const [qrFor, setQrFor]           = useState<WaAccount | null>(null);

  // Telegram стейт
  const [creatingTg, setCreatingTg] = useState(false);

  return (
    <div className="p-4 md:p-5 max-w-[1100px] w-full flex flex-col gap-4">

      {/* ============= WHATSAPP ============= */}
      <section>
        <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-md bg-wa text-white grid place-items-center shrink-0">
            <Smartphone size={16} />
          </div>
          <div>
            <h2 className="text-[15px] font-bold tracking-tight">WhatsApp каналы</h2>
            <p className="text-[12px] text-ink-3 mt-0.5">
              {waAccounts.length} {plural(waAccounts.length, 'канал', 'канала', 'каналов')} ·
              {' '}{waAccounts.filter((a) => a.isConnected).length} подключено
            </p>
          </div>
          <Button variant="primary" className="ml-auto" onClick={() => setCreatingWa(true)}>
            <Plus size={12} /> Добавить номер
          </Button>
        </div>

        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          {waAccounts.length === 0 ? (
            <div className="p-8 text-center">
              <Smartphone size={32} className="mx-auto text-ink-5 mb-2" />
              <p className="text-[12.5px] text-ink-3">Номеров пока нет. Нажмите «Добавить номер» и подключите через QR.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {waAccounts.map((a) => (
                <WaRow
                  key={a.id}
                  account={a}
                  onEdit={() => setEditingWa(a)}
                  onConnect={() => setQrFor(a)}
                />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ============= TELEGRAM ============= */}
      <section>
        <div className="bg-paper border border-line rounded-lg p-4 mb-3 flex items-center gap-3 flex-wrap">
          <div className="w-9 h-9 rounded-md bg-info text-white grid place-items-center shrink-0">
            <Send size={16} />
          </div>
          <div>
            <h2 className="text-[15px] font-bold tracking-tight">Telegram боты</h2>
            <p className="text-[12px] text-ink-3 mt-0.5">
              {tgAccounts.length} {plural(tgAccounts.length, 'бот', 'бота', 'ботов')} ·
              {' '}{tgAccounts.filter((a) => a.isConnected).length} подключено
            </p>
          </div>
          <Button variant="primary" className="ml-auto" onClick={() => setCreatingTg(true)}>
            <Plus size={12} /> Добавить бота
          </Button>
        </div>

        <div className="bg-paper border border-line rounded-lg overflow-hidden">
          {tgAccounts.length === 0 ? (
            <div className="p-8 text-center">
              <Send size={32} className="mx-auto text-ink-5 mb-2" />
              <p className="text-[12.5px] text-ink-3 mb-1">Ботов пока нет.</p>
              <p className="text-[11px] text-ink-4">Создайте бота у <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-navy hover:underline font-mono">@BotFather</a> и введите его токен.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {tgAccounts.map((a) => (
                <TgRow key={a.id} account={a} />
              ))}
            </div>
          )}
        </div>
      </section>

      <p className="text-[11px] text-ink-4">
        Канал без владельца — общий, видят все менеджеры. Канал с владельцем — личный, видит только указанный менеджер.
      </p>

      {/* Модалки WhatsApp */}
      {(editingWa || creatingWa) && (
        <WaFormModal
          account={editingWa}
          users={users}
          onClose={() => { setEditingWa(null); setCreatingWa(false); }}
        />
      )}
      {qrFor && <QrConnectModal account={qrFor} onClose={() => setQrFor(null)} />}

      {/* Модалка Telegram */}
      {creatingTg && (
        <TgConnectModal users={users} onClose={() => setCreatingTg(false)} />
      )}
    </div>
  );
}

// ============================================================
// WHATSAPP ряд и модалки
// ============================================================

function WaRow({
  account, onEdit, onConnect,
}: {
  account: WaAccount;
  onEdit: () => void;
  onConnect: () => void;
}) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm(`Удалить канал «${account.label}»? Переписки сохранятся.`)) return;
    try { await deleteWhatsappAccount(account.id); router.refresh(); }
    catch (e) { console.error(e); alert('Ошибка удаления'); }
  }
  async function onToggle() {
    try { await toggleWhatsappAccount(account.id, !account.isActive); router.refresh(); }
    catch (e) { console.error(e); }
  }

  return (
    <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-1 min-w-[260px]">
        <div className={cn('w-10 h-10 rounded-md grid place-items-center shrink-0',
          account.isConnected ? 'bg-success-bg text-success' : 'bg-bg text-ink-4')}>
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
          <Button variant="primary" size="sm" onClick={onConnect}><QrCode size={11} /> Подключить</Button>
        )}
        {account.isConnected && (
          <Button variant="warn" size="sm" onClick={onConnect}><RefreshCw size={11} /> Переподключить</Button>
        )}
        <Button size="sm" onClick={onEdit} title="Редактировать"><Edit3 size={11} /></Button>
        <Button size="sm" onClick={onToggle} title={account.isActive ? 'Отключить' : 'Включить'}><Power size={11} /></Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Удалить"><Trash2 size={11} /></Button>
      </div>
    </div>
  );
}

function WaFormModal({
  account, users, onClose,
}: {
  account: WaAccount | null;
  users: UserLite[];
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
        id: account?.id, phoneNumber: phone, label, ownerId: ownerId || null,
      });
      router.refresh(); onClose();
    } catch (e) { console.error(e); alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={true} onClose={onClose}
      title={account ? 'Редактирование канала' : 'Новый канал WhatsApp'}
      footer={<>
        <Button onClick={onClose}>Отмена</Button>
        <Button variant="primary" onClick={save} disabled={busy || !phone || !label}>
          {busy ? 'Сохранение...' : 'Сохранить'}
        </Button>
      </>}>
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

/**
 * Модалка подключения WhatsApp через QR.
 *
 * Алгоритм (после фикса 30.04.2026):
 *   1. Сразу триггерим connect (не ждём ответа дольше 5 сек — он только
 *      инициирует сессию в worker'е).
 *   2. Параллельно стартуем poll status каждую секунду — это надёжнее,
 *      чем ждать ответа от connect (который раньше висел до 30 сек ожидая
 *      QR на стороне worker'а и часто отваливался по timeout, оставляя
 *      модалку в состоянии «Подготовка...»).
 *   3. Как только status вернёт qr — показываем картинку.
 *   4. Как только ready — закрываем модалку.
 */
function QrConnectModal({
  account, onClose,
}: {
  account: WaAccount;
  onClose: () => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<'loading' | 'qr' | 'connecting' | 'ready' | 'failed'>('loading');
  const [qrUrl, setQrUrl]   = useState<string | null>(null);
  const [error, setError]   = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let pollCount = 0;
    const MAX_POLLS = 90;   // ~90 секунд на сканирование QR

    // 1. Сразу стартуем poll'инг status — он не ждёт ничего, отдаёт
    //    текущее состояние моментально. Так фронт увидит QR через 1 сек
    //    после его генерации, а не через 30 сек ответа от connect.
    function startPolling() {
      pollRef.current = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLLS) {
          stopPolling();
          if (!cancelled) {
            setError('Превышено время ожидания. Попробуйте ещё раз.');
            setStatus('failed');
          }
          return;
        }

        try {
          const res = await fetch('/api/whatsapp/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accountId: account.id }),
          });
          if (!res.ok) {
            // не валим всё на один таймаут — пробуем дальше
            return;
          }
          const data = await res.json();
          if (cancelled) return;

          if (data.status === 'ready') {
            setStatus('ready');
            stopPolling();
            setTimeout(() => { router.refresh(); onClose(); }, 1500);
          } else if (data.status === 'authenticating') {
            setStatus('connecting');
          } else if (data.status === 'qr' && data.qr) {
            // Обновляем QR картинку (она перегенерируется каждые 20 сек)
            setQrUrl((cur) => (cur === data.qr ? cur : data.qr));
            setStatus('qr');
          } else if (data.status === 'failed') {
            setStatus('failed');
            setError('Worker сообщил об ошибке инициализации');
            stopPolling();
          }
          // status === 'disconnected' или 'initializing' — продолжаем ждать
        } catch {
          // молчим — следующий poll попробует ещё раз
        }
      }, 1000);
    }

    function stopPolling() {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }

    // 2. Параллельно отправляем connect — он триггерит initialize() в worker'е
    //    если сессия ещё не запущена. Ответ нам не важен (мы ждём через poll).
    //    AbortSignal на 5 сек — если worker долго отвечает, не блокируем UI.
    async function triggerConnect() {
      try {
        const ac = new AbortController();
        const timeoutId = setTimeout(() => ac.abort(), 5000);
        const res = await fetch('/api/whatsapp/connect', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ accountId: account.id }),
          signal:  ac.signal,
        });
        clearTimeout(timeoutId);

        // Если connect успел вернуть QR быстрее чем первый poll — показываем сразу
        if (res.ok) {
          const data = await res.json().catch(() => null);
          if (cancelled || !data) return;
          if (data.status === 'ready') {
            setStatus('ready');
            stopPolling();
            setTimeout(() => { router.refresh(); onClose(); }, 1500);
          } else if (data.status === 'qr' && data.qr) {
            setQrUrl(data.qr);
            setStatus('qr');
          } else if (data.status === 'failed') {
            setStatus('failed');
            setError(data.error || 'не удалось подключиться');
            stopPolling();
          }
        }
      } catch {
        // Timeout / abort — это норма, дальше отработает poll'инг
      }
    }

    triggerConnect();
    startPolling();

    return () => { cancelled = true; stopPolling(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account.id]);

  return (
    <Modal open={true} onClose={onClose} title={`Подключение: ${account.label}`}>
      <div className="text-center">
        {status === 'loading' && (
          <div className="py-8">
            <Loader2 size={32} className="mx-auto text-ink-4 animate-spin mb-3" />
            <p className="text-[13px] text-ink-3">Подготовка...</p>
            <p className="text-[11px] text-ink-4 mt-2">QR обычно появляется через 5-15 секунд</p>
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

// ============================================================
// TELEGRAM ряд и модалка подключения
// ============================================================

function TgRow({ account }: { account: TgAccount }) {
  const router = useRouter();

  async function onDelete() {
    if (!confirm(`Отключить бота @${account.botUsername}? Переписки сохранятся, но новых сообщений не будет.`)) return;
    try { await disconnectTelegramBot(account.id); router.refresh(); }
    catch (e) { alert((e as Error).message); }
  }
  async function onToggle() {
    try { await toggleTelegramBot(account.id, !account.isActive); router.refresh(); }
    catch (e) { alert((e as Error).message); }
  }

  return (
    <div className="px-5 py-3.5 flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-3 flex-1 min-w-[260px]">
        <div className={cn('w-10 h-10 rounded-md grid place-items-center shrink-0',
          account.isConnected ? 'bg-info-bg text-info' : 'bg-bg text-ink-4')}>
          <Send size={16} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-[14px] text-ink">{account.label}</strong>
            {account.isConnected
              ? <Badge variant="success" withDot>webhook активен</Badge>
              : <Badge variant="default">не подключён</Badge>}
            {!account.isActive && <Badge variant="default">отключён</Badge>}
            {!account.ownerId && <Badge variant="gold">общий</Badge>}
          </div>
          <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-x-3">
            <a href={`https://t.me/${account.botUsername}`} target="_blank" rel="noopener" className="font-mono text-navy hover:underline">@{account.botUsername}</a>
            {account.ownerName && <span>· {account.ownerName}</span>}
            <span>· {account.threadsCount} переписок</span>
            {account.lastSeenAt && (
              <span>· webhook поднят {formatRelative(account.lastSeenAt)}</span>
            )}
          </div>
        </div>
      </div>

      <div className="flex gap-1.5 ml-auto">
        <Button size="sm" onClick={onToggle} title={account.isActive ? 'Отключить' : 'Включить'}><Power size={11} /></Button>
        <Button size="sm" variant="ghost" onClick={onDelete} title="Удалить"><Trash2 size={11} /></Button>
      </div>
    </div>
  );
}

function TgConnectModal({
  users, onClose,
}: {
  users: UserLite[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [token, setToken]     = useState('');
  const [label, setLabel]     = useState('');
  const [ownerId, setOwnerId] = useState('');
  const [busy, setBusy]       = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function save() {
    setError(null); setBusy(true);
    try {
      const res = await connectTelegramBot({
        token: token.trim(),
        label: label.trim() || `Бот ${token.slice(0, 6)}…`,
        ownerId: ownerId || null,
      });
      setSuccess(`Подключён @${res.botUsername}`);
      setTimeout(() => { router.refresh(); onClose(); }, 1500);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={true} onClose={onClose} title="Подключение Telegram-бота"
      footer={<>
        <Button onClick={onClose} disabled={busy}>Отмена</Button>
        <Button variant="primary" onClick={save} disabled={busy || !token || token.length < 40}>
          {busy ? 'Подключение...' : 'Подключить'}
        </Button>
      </>}>
      {success ? (
        <div className="py-6 text-center">
          <CheckCircle size={36} className="mx-auto text-success mb-3" />
          <h3 className="text-[15px] font-bold text-success">{success}</h3>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="bg-info-bg border border-info/20 rounded-md px-3 py-2.5 text-[12px] text-ink-2 leading-relaxed">
            <strong className="block text-info mb-1">Как получить токен:</strong>
            1. Откройте <a href="https://t.me/BotFather" target="_blank" rel="noopener" className="text-navy hover:underline font-mono">@BotFather</a> в Telegram<br />
            2. Команда <code className="font-mono bg-bg px-1">/newbot</code> → выберите имя и username (должен оканчиваться на <code>bot</code>)<br />
            3. BotFather пришлёт токен вида <code className="font-mono">123456789:AAH...</code> — вставьте его ниже
          </div>
          <FormField label="Токен бота" required hint="Из @BotFather, формат 12345:ABC...">
            <Input value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AAH..." autoFocus />
          </FormField>
          <FormField label="Название" hint="Как будет отображаться в списке">
            <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Общий / Anna / ..." />
          </FormField>
          <FormField label="Владелец" hint="Если выбрать — личный, иначе общий">
            <Select value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
              <option value="">— общий бот (видят все) —</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name} ({u.role === 'ADMIN' ? 'Админ' : u.role === 'SALES' ? 'Продажи' : 'Легализация'})
                </option>
              ))}
            </Select>
          </FormField>
          {error && (
            <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">
              {error}
            </div>
          )}
          <p className="text-[11px] text-ink-4">
            После подключения любое сообщение в бота автоматически создаёт лид в воронке «Консультация» и появляется в /inbox.
            Требует чтобы APP_PUBLIC_URL в .env был публичным HTTPS-адресом.
          </p>
        </div>
      )}
    </Modal>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
