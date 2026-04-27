'use client';

// Карточка лида: хедер + 7 секций со скроллом + правая колонка
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Edit3, Phone, MessageSquare, Mail, MoreHorizontal,
  Plus, Check, AlertCircle, Calendar as CalendarIcon,
  FileText, Paperclip, X, Upload, ExternalLink,
  CheckCircle, Trash2, Repeat, Activity, Clock,
  ChevronRight, FileType,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, FormField, Select } from '@/components/ui/input';
import { OnlyOfficeEditor } from '@/components/onlyoffice-editor';
import {
  cn, formatMoney, formatDate, formatDateTime, formatRelative,
  formatPhone, formatFileSize, plural, daysUntil,
} from '@/lib/utils';
import {
  toggleDocument, addPayment, deletePayment, addNote,
  setFingerprintDate, reassignSalesManager, reassignLegalManager,
  archiveLead,
} from '../../actions';
import { updateClient, removeClientFile } from './actions';
import type { UserRole, PaymentMethod, EventKind, CalendarKind, FileCategory, InternalDocFormat } from '@prisma/client';

// ============ ТИПЫ ============

interface CurrentUser {
  id: string; email: string; name: string; role: UserRole;
}

interface LeadCardViewProps {
  currentUser: CurrentUser;
  lead: {
    id: string; stageId: string; funnelId: string; funnelName: string;
    stageName: string; source: string | null; attorney: string | null;
    serviceName: string | null;
    totalAmount: number; firstContactAt: string | null;
    fingerprintDate: string | null; fingerprintLocation: string | null;
    isArchived: boolean; summary: string | null;
    paid: number; debt: number; createdAt: string;
  };
  client: {
    id: string; fullName: string; birthDate: string | null;
    nationality: string | null; phone: string; altPhone: string | null;
    email: string | null; addressPL: string | null; addressHome: string | null;
  };
  city: { id: string; name: string } | null;
  salesManager: { id: string; name: string; email: string } | null;
  legalManager: { id: string; name: string; email: string } | null;
  whatsappAccount: { id: string; label: string; phoneNumber: string } | null;
  stages: Array<{
    id: string; name: string; color: string | null; position: number;
    isFinal: boolean; isLost: boolean;
  }>;
  documents: Array<{
    id: string; name: string; isPresent: boolean;
    fileUrl: string | null; fileName: string | null; position: number;
  }>;
  payments: Array<{
    id: string; amount: number; method: PaymentMethod;
    paidAt: string; notes: string | null; author: string | null;
  }>;
  notes: Array<{
    id: string; body: string; createdAt: string;
    author: { id: string; name: string; email: string };
  }>;
  events: Array<{
    id: string; kind: EventKind; message: string | null;
    createdAt: string; author: { id: string; name: string } | null;
  }>;
  calendarEvents: Array<{
    id: string; kind: CalendarKind; title: string;
    location: string | null; startsAt: string; endsAt: string | null;
    owner: { id: string; name: string } | null; googleId: string | null;
  }>;
  internalDocs: Array<{
    id: string; name: string; format: InternalDocFormat;
    fileSize: number | null; fileUrl: string;
    createdAt: string; version: number; author: string | null;
  }>;
  clientFiles: Array<{
    id: string; name: string; fileUrl: string; fileSize: number;
    mimeType: string | null; category: FileCategory;
    createdAt: string; uploader: string | null;
  }>;
  otherLeads: Array<{
    id: string; funnelName: string; stageName: string;
    stageColor: string | null; isFinal: boolean; isLost: boolean;
    isArchived: boolean; createdAt: string;
  }>;
  team: Array<{ id: string; name: string; email: string; role: UserRole }>;
}

// ============ КОМПОНЕНТ ============

export function LeadCardView(props: LeadCardViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 p-4 md:p-5 max-w-[1380px] mx-auto w-full">

      {/* ===== ОСНОВНАЯ КОЛОНКА ===== */}
      <div className="min-w-0 flex flex-col gap-3.5">
        <ClientHeader {...props} />
        <ClientCard {...props} />
        <DealCard {...props} />
        <DocumentsCard {...props} />
        <CalendarCard {...props} />
        <PaymentsCard {...props} />
        <NotesCard {...props} />
        <InternalDocsCard {...props} />
        <ClientFilesCard {...props} />
      </div>

      {/* ===== ASIDE ===== */}
      <aside className="flex flex-col gap-3.5 min-w-0">
        <QuickActionsAside {...props} />
        <OtherLeadsAside {...props} />
        <ActivityAside {...props} />
      </aside>
    </div>
  );
}

// ============ ХЕДЕР ============

function ClientHeader({ client, lead, city, stages, currentUser }: LeadCardViewProps) {
  const router = useRouter();
  const stageIdx = stages.findIndex((s) => s.id === lead.stageId);

  async function onArchive() {
    if (!confirm('Архивировать лида? Действие можно отменить только администратору.')) return;
    try {
      await archiveLead(lead.id);
      router.refresh();
    } catch (e) { console.error(e); alert('Не удалось архивировать'); }
  }

  return (
    <div className="bg-paper border border-line rounded-lg p-5 md:p-6">
      <div className="flex items-start gap-4 flex-wrap">
        <Avatar name={client.fullName} size="xl" />

        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight text-ink">
            {client.fullName}
          </h1>

          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant="gold">{lead.funnelName}</Badge>
            {city && <Badge>{city.name}</Badge>}
            {lead.source && <Badge>{lead.source}</Badge>}
            {lead.debt > 0
              ? <Badge variant="danger">долг {formatMoney(lead.debt)} zł</Badge>
              : lead.totalAmount > 0
                ? <Badge variant="success">оплачено</Badge>
                : null}
            {lead.isArchived && <Badge variant="default">в архиве</Badge>}
          </div>

          <div className="mt-2.5 text-12 text-ink-3 flex flex-wrap gap-x-3.5 gap-y-1">
            <span>тел. <strong className="text-ink font-mono">{formatPhone(client.phone)}</strong></span>
            {client.birthDate && (
              <span>род. <strong className="text-ink">{formatDate(client.birthDate)}</strong></span>
            )}
            {lead.firstContactAt && (
              <span>первый контакт <strong className="text-ink">{formatDate(lead.firstContactAt)}</strong></span>
            )}
          </div>
        </div>

        {/* Действия */}
        <div className="flex flex-wrap gap-1.5 ml-auto">
          <Button>
            <Phone size={12} /> Звонок
          </Button>
          <Button>
            <MessageSquare size={12} /> WhatsApp
          </Button>
          {currentUser.role === 'ADMIN' && (
            <Button variant="ghost" onClick={onArchive} title="Архив">
              <Trash2 size={12} />
            </Button>
          )}
        </div>
      </div>

      {/* Stage progress */}
      <div className="mt-4 pt-3.5 border-t border-line">
        <div className="flex gap-1">
          {stages.map((s, i) => (
            <div
              key={s.id}
              className={cn(
                'flex-1 min-w-0 rounded-md px-2 py-1.5 text-[11px] font-semibold border text-center truncate',
                s.id === lead.stageId
                  ? 'bg-navy text-white border-navy'
                  : i < stageIdx
                    ? 'bg-success-bg text-success border-success/20'
                    : 'bg-bg text-ink-4 border-line',
              )}
            >
              {s.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ ЛИЧНЫЕ ДАННЫЕ ============

function ClientCard({ client, lead }: LeadCardViewProps) {
  const [editing, setEditing] = useState(false);

  return (
    <Section
      title="Карточка клиента"
      action={
        <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
          Изменить
        </Button>
      }
    >
      <Field2Cols
        rows={[
          [
            { label: 'ФИО', value: client.fullName },
            { label: 'Дата рождения', value: client.birthDate ? formatDate(client.birthDate) : null },
          ],
          [
            { label: 'Национальность', value: client.nationality },
            { label: 'Телефон', value: <span className="font-mono">{formatPhone(client.phone)}</span> },
          ],
          [
            { label: 'Email', value: client.email },
            { label: 'Источник лида', value: lead.source },
          ],
        ]}
      />
      <FieldFull label="Адрес проживания в Польше" value={client.addressPL} />
      <FieldFull label="Адрес проживания на родине" value={client.addressHome} />

      {editing && (
        <ClientEditModal
          client={client}
          onClose={() => setEditing(false)}
        />
      )}
    </Section>
  );
}

function ClientEditModal({
  client, onClose,
}: {
  client: LeadCardViewProps['client'];
  onClose: () => void;
}) {
  const router = useRouter();
  const [fullName, setFullName]       = useState(client.fullName);
  const [phone, setPhone]             = useState(client.phone);
  const [altPhone, setAltPhone]       = useState(client.altPhone ?? '');
  const [email, setEmail]             = useState(client.email ?? '');
  const [birthDate, setBirthDate]     = useState(
    client.birthDate ? client.birthDate.slice(0, 10) : '',
  );
  const [nationality, setNationality] = useState(client.nationality ?? '');
  const [addressPL, setAddressPL]     = useState(client.addressPL ?? '');
  const [addressHome, setAddressHome] = useState(client.addressHome ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setError(null);
    setBusy(true);
    try {
      await updateClient({
        id: client.id,
        fullName, phone,
        altPhone: altPhone || null,
        email,
        birthDate: birthDate || null,
        nationality: nationality || null,
        addressPL: addressPL || null,
        addressHome: addressHome || null,
      });
      router.refresh();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(false); }
  }

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Редактирование клиента"
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Отмена</Button>
          <Button variant="primary" onClick={save} disabled={busy || !fullName || !phone}>
            {busy ? 'Сохранение...' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="ФИО" required>
          <Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Дата рождения">
          <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
        </FormField>
        <FormField label="Телефон" required>
          <Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </FormField>
        <FormField label="Доп. телефон">
          <Input type="tel" value={altPhone} onChange={(e) => setAltPhone(e.target.value)} />
        </FormField>
        <FormField label="Email">
          <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </FormField>
        <FormField label="Национальность">
          <Input value={nationality} onChange={(e) => setNationality(e.target.value)} />
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Адрес проживания в Польше">
            <Input value={addressPL} onChange={(e) => setAddressPL(e.target.value)} />
          </FormField>
        </div>
        <div className="sm:col-span-2">
          <FormField label="Адрес проживания на родине">
            <Input value={addressHome} onChange={(e) => setAddressHome(e.target.value)} />
          </FormField>
        </div>
      </div>

      {error && (
        <div className="mt-3 bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">
          {error}
        </div>
      )}
    </Modal>
  );
}

// ============ СДЕЛКА ============

function DealCard({
  lead, salesManager, legalManager, city, team, currentUser,
}: LeadCardViewProps) {
  const router = useRouter();
  const [showSalesModal, setShowSalesModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);

  return (
    <Section title="Сделка" action={
      currentUser.role === 'ADMIN' || salesManager?.id === currentUser.id ? (
        <Button size="sm" variant="ghost" onClick={() => setShowSalesModal(true)}>
          Передать другому
        </Button>
      ) : null
    }>
      <Field2Cols rows={[
        [
          {
            label: 'Менеджер продаж',
            value: salesManager
              ? <ManagerPill name={salesManager.name} onClick={() => setShowSalesModal(true)} clickable={currentUser.role === 'ADMIN'} />
              : <span className="text-ink-4 text-[12px]">не назначен</span>,
          },
          {
            label: 'Менеджер легализации',
            value: legalManager
              ? <ManagerPill name={legalManager.name} onClick={() => setShowLegalModal(true)} clickable />
              : <button onClick={() => setShowLegalModal(true)} className="text-[12px] text-navy hover:underline font-medium">+ Назначить</button>,
          },
        ],
        [
          { label: 'Этап воронки', value: <Badge variant="warn" withDot>{lead.stageName}</Badge> },
          { label: 'Воронка', value: lead.funnelName },
        ],
        [
          { label: 'Город', value: city?.name },
          { label: 'Дата первого контакта', value: lead.firstContactAt ? formatDate(lead.firstContactAt) : null },
        ],
        [
          { label: 'Пелномоцник', value: lead.attorney },
          { label: 'Услуга', value: lead.serviceName ?? <span className="text-ink-4">не указана</span> },
          { label: 'Стоимость услуг', value: <span className="font-mono font-bold">{formatMoney(lead.totalAmount)} zł</span> },
        ],
      ]} />

      {/* Модалки переназначения */}
      <Modal
        open={showSalesModal} onClose={() => setShowSalesModal(false)}
        title="Передать менеджеру продаж"
      >
        <ManagerSelector
          team={team.filter((t) => t.role === 'SALES')}
          currentId={salesManager?.id}
          onPick={async (id) => {
            try {
              await reassignSalesManager(lead.id, id);
              setShowSalesModal(false);
              router.refresh();
            } catch (e) { console.error(e); alert('Ошибка'); }
          }}
        />
      </Modal>

      <Modal
        open={showLegalModal} onClose={() => setShowLegalModal(false)}
        title="Назначить менеджера легализации"
      >
        <ManagerSelector
          team={team.filter((t) => t.role === 'LEGAL')}
          currentId={legalManager?.id}
          onPick={async (id) => {
            try {
              await reassignLegalManager(lead.id, id);
              setShowLegalModal(false);
              router.refresh();
            } catch (e) { console.error(e); alert('Ошибка'); }
          }}
        />
      </Modal>
    </Section>
  );
}

function ManagerSelector({
  team, currentId, onPick,
}: {
  team: Array<{ id: string; name: string; email: string }>;
  currentId?: string;
  onPick: (id: string | null) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      {team.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onPick(m.id)}
          className={cn(
            'flex items-center gap-3 p-2.5 rounded-md border transition-colors text-left',
            m.id === currentId
              ? 'bg-bg border-navy/30'
              : 'border-line hover:border-ink-5 hover:bg-bg',
          )}
        >
          <Avatar name={m.name} size="md" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink">{m.name}</div>
            <div className="text-[11px] text-ink-4">{m.email}</div>
          </div>
          {m.id === currentId && (
            <CheckCircle size={16} className="text-navy shrink-0" />
          )}
        </button>
      ))}
      {currentId && (
        <button
          type="button"
          onClick={() => onPick(null)}
          className="mt-2 text-[12px] text-danger hover:underline"
        >
          Снять менеджера
        </button>
      )}
    </div>
  );
}

// ============ ДОКУМЕНТЫ (чек-лист) ============

function DocumentsCard({ lead, documents }: LeadCardViewProps) {
  const router = useRouter();
  const have = documents.filter((d) => d.isPresent).length;
  const total = documents.length;
  const pct = total ? Math.round((have / total) * 100) : 0;
  const missing = documents.filter((d) => !d.isPresent).length;

  async function onToggle(docId: string, isPresent: boolean) {
    try {
      await toggleDocument(docId, isPresent);
      router.refresh();
    } catch (e) { console.error(e); }
  }

  if (total === 0) {
    return (
      <Section title="Чек-лист документов" count={`0/0`}>
        <div className="text-center py-6 text-[12px] text-ink-4">
          Шаблон документов для воронки «{lead.funnelName}» не задан.
        </div>
      </Section>
    );
  }

  return (
    <Section title="Чек-лист документов" count={`${have}/${total}`}>
      <div className="bg-bg rounded-md p-3 mb-3">
        <div className="flex justify-between items-baseline mb-2">
          <div className="text-[12px] font-semibold text-ink-2">Готовность пакета</div>
          <div className="text-[14px] font-bold tracking-tight">{pct}%</div>
        </div>
        <div className="h-1 bg-line rounded-full overflow-hidden">
          <div
            className="h-full bg-navy rounded-full transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1">
        {documents.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => onToggle(d.id, !d.isPresent)}
            className={cn(
              'group flex items-center gap-3 p-2.5 rounded-md border text-left transition-colors',
              d.isPresent
                ? 'bg-success-bg border-success/20'
                : 'bg-paper border-danger/25 hover:border-danger/50',
            )}
          >
            <div className={cn(
              'w-[18px] h-[18px] rounded-full border-[1.5px] grid place-items-center shrink-0',
              d.isPresent
                ? 'bg-success border-success text-white'
                : 'border-danger bg-danger-bg',
            )}>
              {d.isPresent && <Check size={11} strokeWidth={3} />}
            </div>
            <span className={cn(
              'flex-1 text-[13px] font-medium',
              d.isPresent ? 'text-success' : 'text-danger',
            )}>
              {d.name}
            </span>
            <span className={cn(
              'text-[10.5px] font-bold uppercase tracking-[0.04em]',
              d.isPresent ? 'text-success' : 'text-danger',
            )}>
              {d.isPresent ? 'есть' : 'нет'}
            </span>
          </button>
        ))}
      </div>

      {missing > 0 && (
        <div className="mt-3 bg-danger/[0.04] border border-danger/20 rounded-md px-3 py-2.5 flex items-center gap-2.5 text-[12.5px] text-danger font-medium">
          <AlertCircle size={14} className="shrink-0" />
          Не хватает {missing} {plural(missing, 'документ', 'документа', 'документов')} —
          клиент не сможет подать заявление
        </div>
      )}
    </Section>
  );
}

// ============ КАЛЕНДАРЬ (отпечатки + доп. вызвания) ============

function CalendarCard({ lead, calendarEvents, legalManager }: LeadCardViewProps) {
  const router = useRouter();
  const [showSetModal, setShowSetModal] = useState(false);

  return (
    <>
      <Section title="Отпечатки и доп. вызвания" action={
        <Button size="sm" variant="primary" onClick={() => setShowSetModal(true)}>
          <Plus size={11} /> Назначить дату
        </Button>
      }>
        {calendarEvents.length === 0 ? (
          <div className="text-center py-6 text-[12.5px] text-ink-4">
            Дата отпечатков не назначена
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {calendarEvents.map((e) => {
              const dt = new Date(e.startsAt);
              const dayNum = dt.getDate();
              const monthShort = dt.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
              const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
              const days = daysUntil(e.startsAt);

              const accent = e.kind === 'FINGERPRINT'
                ? 'border-l-warn'
                : e.kind === 'EXTRA_CALL'
                  ? 'border-l-danger'
                  : 'border-l-navy';

              return (
                <div
                  key={e.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-md border bg-paper border-l-2',
                    accent,
                    'border-y-line border-r-line',
                  )}
                >
                  <div className="text-center min-w-[44px]">
                    <div className="text-[20px] font-bold tracking-tight text-ink leading-none">
                      {dayNum}
                    </div>
                    <div className="text-[10px] text-ink-4 uppercase tracking-[0.05em] font-semibold mt-0.5">
                      {monthShort}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{e.title}</div>
                    <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-2">
                      <span className="font-semibold text-ink-2 font-mono">{time}</span>
                      {e.location && <span>{e.location}</span>}
                      {e.googleId && <span className="text-gold">Google Calendar</span>}
                      {days !== null && days >= 0 && days <= 7 && (
                        <span className={cn('font-semibold',
                          days === 0 ? 'text-danger' : days <= 1 ? 'text-warn' : 'text-info')}>
                          {days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} ${plural(days, 'день', 'дня', 'дней')}`}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-3 text-[11.5px] text-ink-3">
          Все события синхронизируются с Google Calendar менеджера легализации
          {legalManager && ` (${legalManager.name})`}.
        </div>
      </Section>

      <FingerprintModal
        open={showSetModal} onClose={() => setShowSetModal(false)}
        leadId={lead.id}
        currentDate={lead.fingerprintDate}
        currentLocation={lead.fingerprintLocation}
        onSaved={() => { setShowSetModal(false); router.refresh(); }}
      />
    </>
  );
}

function FingerprintModal({
  open, onClose, leadId, currentDate, currentLocation, onSaved,
}: {
  open: boolean; onClose: () => void; leadId: string;
  currentDate: string | null; currentLocation: string | null;
  onSaved: () => void;
}) {
  const [date, setDate] = useState(currentDate ? currentDate.slice(0, 16) : '');
  const [loc, setLoc] = useState(currentLocation ?? '');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await setFingerprintDate(leadId, date || null, loc || null);
      onSaved();
    } catch (e) { console.error(e); alert('Не удалось сохранить'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Дата отпечатков"
           footer={
             <>
               <Button onClick={onClose}>Отмена</Button>
               <Button variant="primary" onClick={save} disabled={busy}>
                 {busy ? 'Сохранение...' : 'Сохранить'}
               </Button>
             </>
           }>
      <div className="flex flex-col gap-3">
        <FormField label="Дата и время">
          <Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
        </FormField>
        <FormField label="Место" hint="Например: Urząd Wojewódzki Łódzki, ауд. 12">
          <Input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="УВ Łódzki" />
        </FormField>
        <p className="text-[11.5px] text-ink-4">
          Событие будет добавлено в Google Calendar менеджера легализации.
          Клиенту автоматически придёт напоминание в WhatsApp за 7 и за 1 день.
        </p>
      </div>
    </Modal>
  );
}

// ============ ОПЛАТЫ ============

function PaymentsCard({ lead, payments, currentUser }: LeadCardViewProps) {
  const router = useRouter();
  const [showAddModal, setShowAddModal] = useState(false);

  async function onDelete(id: string) {
    if (!confirm('Удалить платёж?')) return;
    try { await deletePayment(id); router.refresh(); }
    catch (e) { console.error(e); alert('Не удалось удалить'); }
  }

  return (
    <>
      <Section title="Оплаты" action={
        <Button size="sm" variant="success" onClick={() => setShowAddModal(true)}>
          <Plus size={11} /> Платёж
        </Button>
      }>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line rounded-md overflow-hidden mb-3">
          <div className="bg-paper p-3.5">
            <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.06em] mb-1.5">Стоимость</div>
            <div className="text-[20px] font-bold tracking-tight font-mono">
              {formatMoney(lead.totalAmount)}<span className="text-[12px] text-ink-4 ml-1">zł</span>
            </div>
          </div>
          <div className="bg-paper p-3.5">
            <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.06em] mb-1.5">Получено</div>
            <div className="text-[20px] font-bold tracking-tight font-mono text-success">
              {formatMoney(lead.paid)}<span className="text-[12px] text-ink-4 ml-1">zł</span>
            </div>
          </div>
          <div className="bg-paper p-3.5">
            <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.06em] mb-1.5">Долг</div>
            <div className={cn(
              'text-[20px] font-bold tracking-tight font-mono',
              lead.debt > 0 ? 'text-danger' : 'text-ink-4',
            )}>
              {formatMoney(lead.debt)}<span className="text-[12px] text-ink-4 ml-1">zł</span>
            </div>
          </div>
        </div>

        {payments.length === 0 ? (
          <div className="text-center py-4 text-[12px] text-ink-4">Платежей пока нет</div>
        ) : (
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line-2">
                <th className="text-left py-2 px-3 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">Дата</th>
                <th className="text-left py-2 px-3 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">Способ</th>
                <th className="text-left py-2 px-3 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">Примечание</th>
                <th className="text-left py-2 px-3 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">Менеджер</th>
                <th className="text-right py-2 px-3 text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">Сумма</th>
                {currentUser.role === 'ADMIN' && <th />}
              </tr>
            </thead>
            <tbody>
              {payments.map((p) => (
                <tr key={p.id} className="border-b border-line-2 last:border-0 hover:bg-bg group">
                  <td className="py-2 px-3 text-ink-3 whitespace-nowrap font-mono">{formatDate(p.paidAt)}</td>
                  <td className="py-2 px-3"><Badge>{methodLabel(p.method)}</Badge></td>
                  <td className="py-2 px-3 text-ink-3">{p.notes || '—'}</td>
                  <td className="py-2 px-3 text-ink-3">{p.author || '—'}</td>
                  <td className="py-2 px-3 text-right font-mono font-bold text-success whitespace-nowrap">
                    +{formatMoney(p.amount)} zł
                  </td>
                  {currentUser.role === 'ADMIN' && (
                    <td className="py-2 px-3">
                      <button
                        type="button"
                        onClick={() => onDelete(p.id)}
                        className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger transition-opacity"
                        aria-label="Удалить платёж"
                      >
                        <Trash2 size={12} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <AddPaymentModal
        open={showAddModal} onClose={() => setShowAddModal(false)}
        leadId={lead.id}
        onSaved={() => { setShowAddModal(false); router.refresh(); }}
      />
    </>
  );
}

function AddPaymentModal({
  open, onClose, leadId, onSaved,
}: {
  open: boolean; onClose: () => void; leadId: string; onSaved: () => void;
}) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [notes, setNotes]   = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await addPayment({ leadId, amount: Number(amount), method, notes: notes || undefined });
      setAmount(''); setNotes('');
      onSaved();
    } catch (e) { console.error(e); alert((e as Error).message || 'Ошибка'); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый платёж"
           footer={
             <>
               <Button onClick={onClose}>Отмена</Button>
               <Button variant="success" onClick={save} disabled={busy || !amount}>
                 {busy ? 'Сохранение...' : 'Записать'}
               </Button>
             </>
           }>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Сумма (zł)" required>
            <Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </FormField>
          <FormField label="Способ">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="CASH">Наличные</option>
              <option value="CARD">Карта</option>
              <option value="TRANSFER">Перевод</option>
              <option value="OTHER">Другое</option>
            </Select>
          </FormField>
        </div>
        <FormField label="Примечание">
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Аванс, доплата..." />
        </FormField>
      </div>
    </Modal>
  );
}

function methodLabel(m: PaymentMethod): string {
  return ({ CARD: 'Карта', CASH: 'Наличные', TRANSFER: 'Перевод', OTHER: 'Другое' }[m]);
}

// ============ ЗАМЕТКИ ============

function NotesCard({ lead, notes, team }: LeadCardViewProps) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await addNote({ leadId: lead.id, body: body.trim() });
      setBody('');
      router.refresh();
    } catch (e) { console.error(e); alert('Ошибка'); }
    finally { setBusy(false); }
  }

  // Подсказка по @упоминаниям
  const mentionables = team.slice(0, 5).map((t) => t.email.split('@')[0]).join(' ');

  return (
    <Section title="Заметки команды" count={notes.length}>
      <div className="bg-paper border border-line rounded-md p-3 mb-3 focus-within:border-gold transition-colors">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Заметка для команды... используйте @login чтобы упомянуть коллегу"
          rows={3}
          className="border-0 p-0 focus:ring-0 focus:border-0 min-h-[60px] text-[13px]"
        />
        <div className="flex justify-between items-center pt-2 border-t border-line-2">
          <div className="text-[11px] text-ink-4">
            Упомянуть: <span className="text-gold font-semibold font-mono">{mentionables ? '@' + mentionables.split(' ').join(' @') : ''}</span>
          </div>
          <Button size="sm" variant="primary" onClick={save} disabled={busy || !body.trim()}>
            Добавить
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <div className="text-center py-4 text-[12px] text-ink-4">Заметок пока нет</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <div key={n.id} className="bg-paper border border-line rounded-md p-3">
              <div className="flex justify-between items-center mb-1.5 gap-3">
                <div className="flex items-center gap-2">
                  <Avatar name={n.author.name} size="sm" />
                  <span className="text-[12px] font-semibold text-ink">{n.author.name}</span>
                </div>
                <span className="text-[11px] text-ink-4 whitespace-nowrap" title={formatDateTime(n.createdAt)}>
                  {formatRelative(n.createdAt)}
                </span>
              </div>
              <div
                className="text-[12.5px] text-ink-2 leading-relaxed whitespace-pre-wrap"
                dangerouslySetInnerHTML={{
                  __html: n.body.replace(
                    /@([a-zA-Z0-9._-]+)/g,
                    '<span class="text-gold font-semibold bg-gold-pale px-1 rounded">@$1</span>'
                  ),
                }}
              />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ============ ВНУТРЕННИЕ ДОКУМЕНТЫ (OnlyOffice) ============

function InternalDocsCard({ lead, internalDocs }: LeadCardViewProps) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState<{ id: string; name: string; mode: 'edit' | 'view' } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [blueprintsOpen, setBlueprintsOpen] = useState(false);

  return (
    <Section title="Внутренние документы" count={internalDocs.length} action={
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => setBlueprintsOpen(true)}>Из шаблона</Button>
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}>
          <Plus size={11} /> Создать
        </Button>
      </div>
    }>
      {internalDocs.length === 0 ? (
        <div className="text-center py-6">
          <FileText size={28} className="mx-auto text-ink-5 mb-2" />
          <div className="text-[13px] font-semibold text-ink mb-1">Документов пока нет</div>
          <div className="text-[12px] text-ink-3 max-w-md mx-auto">
            Создавайте документы прямо в браузере (Word онлайн) или из готовых шаблонов с автоподстановкой данных клиента.
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {internalDocs.map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => setEditorOpen({ id: d.id, name: d.name, mode: 'edit' })}
              className="flex items-center gap-3 p-2.5 rounded-md border border-line bg-paper hover:border-ink-5 transition-colors text-left"
            >
              <div className={cn(
                'w-8 h-8 rounded grid place-items-center text-[10px] font-bold shrink-0',
                d.format === 'PDF' ? 'bg-danger-bg text-danger' :
                d.format === 'XLSX' ? 'bg-success-bg text-success' :
                d.format === 'PPTX' ? 'bg-warn-bg text-warn' :
                'bg-info-bg text-info',
              )}>
                {d.format}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-ink truncate">{d.name}</div>
                <div className="text-[10.5px] text-ink-4 mt-0.5">
                  {d.author || 'неизвестно'} · {formatRelative(d.createdAt)}
                  {d.version > 1 && ` · v${d.version}`}
                </div>
              </div>
              <Edit3 size={12} className="text-ink-4 shrink-0" />
            </button>
          ))}
        </div>
      )}

      {/* OnlyOffice editor modal */}
      {editorOpen && (
        <OnlyOfficeEditor
          open={true}
          documentId={editorOpen.id}
          documentName={editorOpen.name}
          mode={editorOpen.mode}
          onClose={() => {
            setEditorOpen(null);
            router.refresh();
          }}
        />
      )}

      {/* Создание нового пустого документа */}
      <CreateDocumentModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        leadId={lead.id}
        onCreated={(id, name) => {
          setCreateOpen(false);
          setEditorOpen({ id, name, mode: 'edit' });
        }}
      />

      {/* Создание из шаблона */}
      <BlueprintsModal
        open={blueprintsOpen}
        onClose={() => setBlueprintsOpen(false)}
        leadId={lead.id}
        onCreated={(id, name) => {
          setBlueprintsOpen(false);
          setEditorOpen({ id, name, mode: 'edit' });
        }}
      />
    </Section>
  );
}

function CreateDocumentModal({
  open, onClose, leadId, onCreated,
}: {
  open: boolean; onClose: () => void; leadId: string;
  onCreated: (id: string, name: string) => void;
}) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'DOCX' | 'XLSX' | 'PPTX'>('DOCX');
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { createBlankDocument } = await import('../../document-actions');
      const res = await createBlankDocument({ leadId, name: name.trim(), format });
      onCreated(res.id, name.trim());
      setName('');
    } catch (e) { console.error(e); alert((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Новый документ"
           footer={
             <>
               <Button onClick={onClose}>Отмена</Button>
               <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
                 {busy ? 'Создание...' : 'Создать и открыть'}
               </Button>
             </>
           }>
      <div className="flex flex-col gap-3">
        <FormField label="Название документа" required>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Договор с клиентом"
            autoFocus
          />
        </FormField>
        <FormField label="Формат">
          <Select value={format} onChange={(e) => setFormat(e.target.value as 'DOCX' | 'XLSX' | 'PPTX')}>
            <option value="DOCX">Word (.docx)</option>
            <option value="XLSX">Excel (.xlsx)</option>
            <option value="PPTX">PowerPoint (.pptx)</option>
          </Select>
        </FormField>
        <p className="text-[11.5px] text-ink-4">
          Документ откроется в редакторе OnlyOffice прямо в браузере.
          Изменения сохраняются автоматически.
        </p>
      </div>
    </Modal>
  );
}

function BlueprintsModal({
  open, onClose, leadId, onCreated,
}: {
  open: boolean; onClose: () => void; leadId: string;
  onCreated: (id: string, name: string) => void;
}) {
  const [blueprints, setBlueprints] = useState<Array<{
    id: string; name: string; description: string | null; placeholders: string[];
  }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/blueprints')
      .then((r) => r.json())
      .then((data) => setBlueprints(data.blueprints ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open]);

  async function pick(bp: { id: string; name: string }) {
    setBusy(bp.id);
    try {
      const { createDocumentFromBlueprint } = await import('../../document-actions');
      const res = await createDocumentFromBlueprint({ leadId, blueprintId: bp.id });
      onCreated(res.id, bp.name);
    } catch (e) { console.error(e); alert((e as Error).message); }
    finally { setBusy(null); }
  }

  return (
    <Modal open={open} onClose={onClose} title="Создать из шаблона" size="lg">
      {loading ? (
        <div className="text-center py-8 text-[13px] text-ink-4">Загрузка...</div>
      ) : blueprints.length === 0 ? (
        <div className="text-center py-8">
          <FileText size={32} className="mx-auto text-ink-5 mb-2" />
          <div className="text-[13px] text-ink-3 mb-1">Шаблонов пока нет</div>
          <div className="text-[12px] text-ink-4">
            Загрузите .docx-шаблоны в настройках администратора
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {blueprints.map((bp) => (
            <button
              key={bp.id}
              type="button"
              onClick={() => pick(bp)}
              disabled={busy !== null}
              className="flex items-start gap-3 p-3 rounded-md border border-line hover:border-ink-5 transition-colors text-left disabled:opacity-50"
            >
              <div className="w-8 h-8 rounded bg-info-bg text-info grid place-items-center text-[10px] font-bold shrink-0">
                DOCX
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink">{bp.name}</div>
                {bp.description && (
                  <div className="text-[11.5px] text-ink-3 mt-0.5">{bp.description}</div>
                )}
                {bp.placeholders.length > 0 && (
                  <div className="text-[10.5px] text-ink-4 mt-1 font-mono">
                    Поля: {bp.placeholders.slice(0, 5).join(', ')}
                    {bp.placeholders.length > 5 && ` +${bp.placeholders.length - 5}`}
                  </div>
                )}
              </div>
              {busy === bp.id && (
                <div className="text-[11px] text-info font-medium">создаётся...</div>
              )}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

// ============ ФАЙЛЫ КЛИЕНТА (общая папка) ============

function ClientFilesCard({ clientFiles, client, currentUser }: LeadCardViewProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useState<HTMLInputElement | null>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 50 * 1024 * 1024) {
      alert('Файл больше 50 МБ');
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('clientId', client.id);
      fd.append('category', 'GENERAL');

      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
      router.refresh();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setUploading(false);
      if (e.target) e.target.value = '';
    }
  }

  async function onDelete(fileId: string) {
    if (!confirm('Удалить файл?')) return;
    try {
      await removeClientFile(fileId);
      router.refresh();
    } catch (e) { alert((e as Error).message); }
  }

  return (
    <Section title="Файлы клиента" count={clientFiles.length} action={
      <label className={cn(
        'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border',
        'border-line bg-paper text-ink-2 hover:border-ink-5 cursor-pointer transition-colors',
        uploading && 'opacity-60 pointer-events-none',
      )}>
        <Upload size={11} />
        {uploading ? 'Загрузка...' : 'Загрузить'}
        <input
          type="file"
          className="hidden"
          onChange={handleFile}
          disabled={uploading}
        />
      </label>
    }>
      {clientFiles.length === 0 ? (
        <div className="text-center py-6 text-[12.5px] text-ink-4">
          Файлов клиента пока нет.<br />Перетащите или загрузите .pdf / .jpg / .png
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {clientFiles.map((f) => (
            <div
              key={f.id}
              className="group flex items-center gap-2.5 p-2 rounded-md border border-line bg-paper hover:border-ink-5 transition-colors min-w-0"
            >
              <a
                href={f.fileUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-2.5 flex-1 min-w-0"
              >
                <Paperclip size={14} className="text-ink-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-ink truncate">{f.name}</div>
                  <div className="text-[10.5px] text-ink-4">{formatFileSize(f.fileSize)}</div>
                </div>
              </a>
              <button
                type="button"
                onClick={() => onDelete(f.id)}
                className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger transition-opacity"
                aria-label="Удалить"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

// ============ ASIDE: QUICK ACTIONS ============

function QuickActionsAside({ client }: LeadCardViewProps) {
  return (
    <Section title="Быстрые действия" tight>
      <div className="grid grid-cols-2 gap-1.5">
        <QuickBtn icon={<MessageSquare size={11} />} label="WhatsApp" color="bg-wa text-white" />
        <QuickBtn icon={<Phone size={11} />} label="Позвонить" color="bg-navy text-gold" />
        <QuickBtn icon={<Mail size={11} />} label="Email" color="bg-info text-white" disabled={!client.email} />
        <QuickBtn icon={<CalendarIcon size={11} />} label="Встреча" color="bg-gold text-navy" />
      </div>
    </Section>
  );
}

function QuickBtn({
  icon, label, color, disabled,
}: { icon: React.ReactNode; label: string; color: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        'flex items-center gap-2 px-3 py-2.5 rounded-md border border-line bg-paper text-[12px] font-medium text-ink-2',
        'hover:bg-bg hover:border-ink-5 transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
      )}
    >
      <span className={cn('w-[22px] h-[22px] rounded grid place-items-center shrink-0', color)}>
        {icon}
      </span>
      {label}
    </button>
  );
}

// ============ ASIDE: ДРУГИЕ ЛИДЫ КЛИЕНТА ============

function OtherLeadsAside({ otherLeads }: LeadCardViewProps) {
  if (otherLeads.length === 0) return null;
  return (
    <Section title="Другие дела клиента" count={otherLeads.length} tight>
      <div className="flex flex-col gap-1">
        {otherLeads.map((l) => (
          <Link
            key={l.id}
            href={`/clients/${l.id}`}
            className="flex items-center gap-2 p-2 rounded-md hover:bg-bg transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-ink truncate">{l.funnelName}</div>
              <div className="text-[11px] text-ink-4 mt-0.5">{formatDate(l.createdAt)}</div>
            </div>
            <span
              className="text-[10.5px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap"
              style={{
                background: (l.stageColor || '#71717A') + '14',
                color:      l.stageColor || '#71717A',
                borderColor: (l.stageColor || '#71717A') + '33',
              }}
            >
              {l.stageName}
            </span>
            <ChevronRight size={12} className="text-ink-4" />
          </Link>
        ))}
      </div>
    </Section>
  );
}

// ============ ASIDE: ИСТОРИЯ ============

function ActivityAside({ events }: LeadCardViewProps) {
  return (
    <Section title="История" tight>
      {events.length === 0 ? (
        <div className="text-center py-3 text-[12px] text-ink-4">Событий нет</div>
      ) : (
        <div className="flex flex-col">
          {events.map((e) => (
            <div key={e.id} className="flex gap-2.5 py-2 border-b border-dashed border-line-2 last:border-0">
              <div className={cn(
                'w-6 h-6 rounded-full grid place-items-center shrink-0 border',
                eventColor(e.kind),
              )}>
                {eventIcon(e.kind)}
              </div>
              <div className="flex-1 min-w-0 text-[12px]">
                <div className="text-ink leading-snug">{e.message || eventLabel(e.kind)}</div>
                <div className="text-[10.5px] text-ink-4 mt-0.5">
                  {e.author?.name && `${e.author.name} · `}
                  <span title={formatDateTime(e.createdAt)}>{formatRelative(e.createdAt)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function eventColor(kind: EventKind): string {
  switch (kind) {
    case 'PAYMENT_ADDED':     return 'bg-success-bg text-success border-success/20';
    case 'PAYMENT_REMOVED':   return 'bg-danger-bg text-danger border-danger/20';
    case 'FINGERPRINT_SET':   return 'bg-warn-bg text-warn border-warn/20';
    case 'STAGE_CHANGED':     return 'bg-gold-pale text-gold border-gold/30';
    case 'MANAGER_CHANGED':   return 'bg-gold-pale text-gold border-gold/30';
    case 'DOCUMENT_TOGGLED':  return 'bg-info-bg text-info border-info/20';
    case 'NOTE_ADDED':        return 'bg-bg text-ink-3 border-line';
    case 'ARCHIVED':          return 'bg-danger-bg text-danger border-danger/20';
    default:                  return 'bg-bg text-ink-3 border-line';
  }
}

function eventIcon(kind: EventKind) {
  const cls = '';
  switch (kind) {
    case 'PAYMENT_ADDED':
    case 'PAYMENT_REMOVED':   return <span className={cls}>$</span>;
    case 'FINGERPRINT_SET':   return <CalendarIcon size={11} />;
    case 'STAGE_CHANGED':     return <Activity size={11} />;
    case 'MANAGER_CHANGED':   return <Repeat size={11} />;
    case 'DOCUMENT_TOGGLED':  return <Check size={11} />;
    case 'NOTE_ADDED':        return <Edit3 size={11} />;
    case 'ARCHIVED':          return <Trash2 size={11} />;
    default:                  return <Clock size={11} />;
  }
}

function eventLabel(kind: EventKind): string {
  return ({
    LEAD_CREATED:      'Лид создан',
    STAGE_CHANGED:     'Сменён этап',
    MANAGER_CHANGED:   'Сменён менеджер',
    PAYMENT_ADDED:     'Платёж добавлен',
    PAYMENT_REMOVED:   'Платёж удалён',
    DOCUMENT_TOGGLED:  'Документ обновлён',
    DOCUMENT_UPLOADED: 'Документ загружен',
    FINGERPRINT_SET:   'Назначены отпечатки',
    EXTRA_CALL_SET:    'Назначено доп. вызвание',
    CALL_LOGGED:       'Звонок',
    MESSAGE_RECEIVED:  'Входящее сообщение',
    MESSAGE_SENT:      'Сообщение отправлено',
    NOTE_ADDED:        'Добавлена заметка',
    TASK_CREATED:      'Создана задача',
    ARCHIVED:          'Лид архивирован',
    RESTORED:          'Лид восстановлен',
    CUSTOM:            'Событие',
  } as Record<EventKind, string>)[kind];
}

// ============ ВСПОМОГАТЕЛЬНЫЕ ============

function Section({
  title, count, action, children, tight,
}: {
  title: string;
  count?: number | string;
  action?: React.ReactNode;
  children: React.ReactNode;
  tight?: boolean;
}) {
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className={cn(
        'flex items-center justify-between gap-3 border-b border-line',
        tight ? 'px-4 py-2.5' : 'px-5 py-3.5',
      )}>
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-ink-2 uppercase tracking-[0.04em]">
            {title}
          </h3>
          {count !== undefined && (
            <span className="text-[11px] px-1.5 py-px rounded bg-bg text-ink-3 font-semibold">
              {count}
            </span>
          )}
        </div>
        {action}
      </div>
      <div className={cn(tight ? 'p-3.5' : 'p-4 md:p-5')}>{children}</div>
    </div>
  );
}

function Field2Cols({
  rows,
}: {
  rows: Array<Array<{ label: string; value: React.ReactNode }>>;
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-line-2 -mx-4 md:-mx-5 -my-1">
      {rows.flat().map((cell, i) => (
        <div key={i} className="bg-paper px-4 md:px-5 py-2.5">
          <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-0.5">
            {cell.label}
          </div>
          <div className="text-[13px] text-ink font-medium">
            {cell.value === null || cell.value === undefined || cell.value === ''
              ? <span className="text-ink-4 font-normal">—</span>
              : cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldFull({
  label, value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="-mx-4 md:-mx-5 -mb-1 mt-px bg-line-2">
      <div className="bg-paper px-4 md:px-5 py-2.5">
        <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-0.5">
          {label}
        </div>
        <div className="text-[13px] text-ink">
          {value || <span className="text-ink-4">не указано</span>}
        </div>
      </div>
    </div>
  );
}

function ManagerPill({
  name, onClick, clickable,
}: { name: string; onClick?: () => void; clickable?: boolean }) {
  const Wrapper: React.ElementType = clickable ? 'button' : 'span';
  return (
    <Wrapper
      type={clickable ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border bg-bg border-line',
        'text-[11.5px] text-ink-2',
        clickable && 'hover:bg-paper hover:border-ink-5 cursor-pointer',
      )}
    >
      <Avatar name={name} size="xs" variant="navy" />
      {name}
    </Wrapper>
  );
}
