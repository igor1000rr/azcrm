'use client';

// Карточка лида: хедер + 8 секций со скроллом + правая колонка
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Edit3, Phone, MessageSquare, Mail,
  Plus, Check, AlertCircle, Calendar as CalendarIcon,
  FileText, Paperclip, X, Upload,
  CheckCircle, Trash2, Repeat, Activity, Clock,
  ChevronRight, Briefcase,
} from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Modal } from '@/components/ui/modal';
import { Input, Textarea, FormField, Select } from '@/components/ui/input';
import { OnlyOfficeEditor } from '@/components/onlyoffice-editor';
import { LeadChatPanel, type LeadChatMessage, type LeadChatAccount } from './lead-chat-panel';
import { LeadCallsList, type LeadCallItem } from './lead-calls-list';
import {
  cn, formatMoney, formatDate, formatDateTime, formatRelative,
  formatPhone, formatFileSize, plural, daysUntil,
} from '@/lib/utils';
import {
  toggleDocument, addPayment, deletePayment, addNote,
  setFingerprintDate, addExtraCall, deleteCalendarEvent,
  reassignSalesManager, reassignLegalManager,
  archiveLead,
} from '../../actions';
import {
  updateClient, removeClientFile,
  setEmployer, setWorkCity, setLeadServices,
  setSubmittedAt, setCaseNumber,
} from './actions';
import { setAttorney } from './attorney-actions';
import { FunnelStageSection } from './funnel-stage-section';
import type { UserRole, PaymentMethod, EventKind, CalendarKind, FileCategory, InternalDocFormat } from '@prisma/client';

// ============ ТИПЫ ============

interface CurrentUser {
  id: string; email: string; name: string; role: UserRole;
}

// Тип легального пребывания клиента в Польше (Anna 29.04.2026).
// Хранится на Client (один на человека, общий для всех его дел).
type LegalStayType = 'KARTA' | 'VISA' | 'VISA_FREE';

interface CityLite { id: string; name: string }
interface ServiceLite { id: string; name: string; basePrice: number }
interface LeadServiceLite {
  id: string; serviceId: string; serviceName: string;
  amount: number; qty: number; notes: string | null; position: number;
}

interface LeadCardViewProps {
  currentUser: CurrentUser;
  lead: {
    id: string; stageId: string; funnelId: string; funnelName: string;
    stageName: string; source: string | null; attorney: string | null;
    // Номер дела (wniosek number) — Anna 30.04.2026, необязательное.
    caseNumber: string | null;
    serviceName: string | null;
    employerName: string | null; employerPhone: string | null;
    totalAmount: number; firstContactAt: string | null;
    fingerprintDate: string | null; fingerprintLocation: string | null;
    // Дата подачи внеска (wniosek) в УВ. null → красный маркер в календаре.
    submittedAt: string | null;
    isArchived: boolean; summary: string | null;
    paid: number; debt: number; createdAt: string;
  };
  client: {
    id: string; fullName: string; birthDate: string | null;
    nationality: string | null; phone: string;
    altPhone: string | null;
    altPhone2: string | null;
    altPhone3: string | null;
    email: string | null; addressPL: string | null; addressHome: string | null;
    // Легальный побыт — тип пребывания и срок окончания
    legalStayType:  LegalStayType | null;
    legalStayUntil: string | null;
    // Срок паспорта (Anna идея №7 «Календарь сроков виз и документов»).
    // Cron шлёт менеджеру push за 90/30/14 дней до этой даты.
    passportExpiresAt: string | null;
  };
  city:     CityLite | null;
  workCity: CityLite | null;
  cities:   CityLite[];
  allServices: ServiceLite[];
  leadServices: LeadServiceLite[];
  salesManager: { id: string; name: string; email: string } | null;
  legalManager: { id: string; name: string; email: string } | null;
  whatsappAccount: { id: string; label: string; phoneNumber: string } | null;
  // Готовая ссылка для кнопки WhatsApp — резолвится на сервере в page.tsx.
  // Открывает конкретный thread с этим клиентом или преферный канал
  // (lead.whatsappAccountId → канал sales-менеджера → канал legal-менеджера).
  // Раньше карточка слала /inbox?phone=...&account=... но /inbox эти параметры
  // игнорирует и открывал общий канал — Igor: «выбивает в общий WhatsApp».
  whatsappHref: string;
  stages: Array<{
    id: string; name: string; color: string | null; position: number;
    isFinal: boolean; isLost: boolean;
  }>;
  // Все воронки + их этапы для селекторов смены воронки/этапа в DealCard
  // (Anna 01.05.2026 — менеджеру нужно мочь перевести лид в другую воронку
  // если ошибся на этапе создания).
  funnels: Array<{
    id: string; name: string; isActive: boolean;
    stages: Array<{ id: string; name: string; position: number }>;
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
  attorneys: Array<{ id: string; name: string; role: UserRole }>;
  // Объединённая переписка по клиенту (со всех каналов в которые юзер имеет доступ)
  chatMessages: LeadChatMessage[];
  // Доступные каналы для отправки (ADMIN — все, остальные — свои + общие)
  availableChatAccounts: LeadChatAccount[];
  // Anna идея №12: последние звонки с клиентом + их транскрипция и sentiment.
  // Полный список со всеми фильтрами и поиском по тексту — на /calls.
  calls: LeadCallItem[];
}

const LEGAL_STAY_LABEL: Record<LegalStayType, string> = {
  KARTA:     'Карта побыта',
  VISA:      'Виза',
  VISA_FREE: 'Безвиз',
};

/** Отображение «Действует до» с подсветкой по близости срока:
 *  истёк — красный, < 30 дн — жёлтый, < 90 дн — info, иначе обычный.
 *  Используется и для legalStayUntil, и для passportExpiresAt. */
function StayUntilDisplay({ until }: { until: string | null }) {
  if (!until) return null;
  const days = daysUntil(until);
  const dateStr = formatDate(until);
  if (days === null) return <>{dateStr}</>;
  if (days < 0) {
    return (
      <span>
        <span className="line-through text-ink-4">{dateStr}</span>{' '}
        <span className="text-danger font-semibold">истёк {Math.abs(days)} {plural(Math.abs(days), 'день', 'дня', 'дней')} назад</span>
      </span>
    );
  }
  if (days === 0) return <span className="text-danger font-semibold">{dateStr} (сегодня)</span>;
  if (days <= 30) return <span>{dateStr} <span className="text-warn font-semibold">через {days} {plural(days, 'день', 'дня', 'дней')}</span></span>;
  if (days <= 90) return <span>{dateStr} <span className="text-info">через {days} {plural(days, 'день', 'дня', 'дней')}</span></span>;
  return <>{dateStr}</>;
}

/** Inline-редактор даты подачи в уженд (Anna 30.04.2026).
 *  null → красная плашка «не подан» + поле выбора даты.
 *  Дата → отображается + кнопка очистки. Сохранение по onChange. */
function SubmittedAtField({ leadId, initial }: { leadId: string; initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ? initial.slice(0, 10) : '');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  // Если данные обновились извне (router.refresh после действий) — синхронизируем
  useEffect(() => { setValue(initial ? initial.slice(0, 10) : ''); }, [initial]);

  async function commit(next: string | null) {
    setErr(null); setBusy(true);
    try { await setSubmittedAt(leadId, next); router.refresh(); }
    catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  }

  if (!value) {
    return (
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <Input
            type="date"
            value=""
            disabled={busy}
            onChange={(e) => { const v = e.target.value; setValue(v); if (v) commit(v); }}
            className="text-[12.5px] py-0.5 border-danger/40"
          />
          <span className="inline-flex items-center gap-1 text-[10.5px] font-bold text-danger uppercase tracking-[0.05em] whitespace-nowrap">
            <AlertCircle size={11} /> не подан
          </span>
        </div>
        {err && <div className="text-[11px] text-danger">{err}</div>}
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          type="date"
          value={value}
          disabled={busy}
          onChange={(e) => { setValue(e.target.value); if (e.target.value) commit(e.target.value); }}
          className="text-[12.5px] py-0.5"
        />
        <button
          type="button"
          onClick={() => { setValue(''); commit(null); }}
          disabled={busy}
          className="text-[11px] text-ink-4 hover:text-danger transition-colors"
          title="Сбросить дату подачи"
        >
          сбросить
        </button>
      </div>
      {err && <div className="text-[11px] text-danger">{err}</div>}
    </div>
  );
}

/** Inline-редактор «Номер дела» (Anna 30.04.2026).
 *  Необязательное текстовое поле. Сохраняется на blur и Enter — без модалок.
 *  Появляется в секции «Сделка» рядом со «Стоимость услуг». */
function CaseNumberField({ leadId, initial }: { leadId: string; initial: string | null }) {
  const router = useRouter();
  const [value, setValue] = useState(initial ?? '');
  const [busy, setBusy]   = useState(false);
  const [err, setErr]     = useState<string | null>(null);

  // Синк при внешнем обновлении (router.refresh)
  useEffect(() => { setValue(initial ?? ''); }, [initial]);

  async function commit() {
    const next = value.trim();
    // Не шлём запрос если ничего не изменилось — экономим круг к серверу
    if (next === (initial ?? '').trim()) return;
    setErr(null); setBusy(true);
    try {
      await setCaseNumber(leadId, next || null);
      router.refresh();
    } catch (e) {
      setErr((e as Error).message);
      setValue(initial ?? ''); // откатываем при ошибке
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <Input
        type="text"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setValue(initial ?? '');
            (e.target as HTMLInputElement).blur();
          }
        }}
        placeholder="необязательно"
        className="text-[12.5px] py-0.5 font-mono"
        maxLength={100}
      />
      {err && <div className="text-[11px] text-danger">{err}</div>}
    </div>
  );
}

export function LeadCardView(props: LeadCardViewProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-4 p-4 md:p-5 max-w-[1380px] mx-auto w-full">
      <div className="min-w-0 flex flex-col gap-3.5">
        <ClientHeader {...props} />
        <ClientCard {...props} />
        {/* Anna 01.05.2026: «можно менять воронку — если ошибся ?)))».
            Над «Сделкой» — отдельная секция со сменой воронки и этапа. */}
        <FunnelStageSection
          leadId={props.lead.id}
          currentFunnelId={props.lead.funnelId}
          currentStageId={props.lead.stageId}
          currentFunnelName={props.lead.funnelName}
          currentStageName={props.lead.stageName}
          funnels={props.funnels}
        />
        <DealCard {...props} />
        <LeadChatPanel
          leadId={props.lead.id}
          clientName={props.client.fullName}
          messages={props.chatMessages}
          availableAccounts={props.availableChatAccounts}
        />
        {/* Anna идея №12: звонки с этим клиентом — sentiment + транскрипт.
            Стоит после чата чтобы вся история контакта была рядом. */}
        <CallsCard {...props} />
        <ServicesCard {...props} />
        <EmployerCard {...props} />
        <DocumentsCard {...props} />
        <CalendarCard {...props} />
        <PaymentsCard {...props} />
        <NotesCard {...props} />
        <InternalDocsCard {...props} />
        <ClientFilesCard {...props} />
      </div>
      <aside className="flex flex-col gap-3.5 min-w-0">
        <QuickActionsAside {...props} />
        <OtherLeadsAside {...props} />
        <ActivityAside {...props} />
      </aside>
    </div>
  );
}

function CallsCard({ calls, client }: LeadCardViewProps) {
  // Считаем "проблемные" звонки — Anna просит видеть требующие внимания.
  const negativeCount = calls.filter((c) => c.sentiment === 'NEGATIVE').length;
  return (
    <Section
      title="Звонки"
      count={calls.length}
      action={
        <Link
          href={`/calls?q=${encodeURIComponent(client.fullName)}`}
          className="text-[11.5px] text-navy hover:underline font-medium"
        >
          Поиск по разговорам →
        </Link>
      }
    >
      {negativeCount > 0 && (
        <div className="mb-2.5 bg-danger/[0.04] border border-danger/20 rounded-md px-3 py-2 text-[12px] text-danger font-medium">
          {negativeCount} {plural(negativeCount, 'проблемный звонок', 'проблемных звонка', 'проблемных звонков')} —
          клиент был недоволен. Послушайте записи.
        </div>
      )}
      <LeadCallsList calls={calls} clientName={client.fullName} />
    </Section>
  );
}

function ClientHeader({ client, lead, city, stages, currentUser, whatsappHref }: LeadCardViewProps) {
  const router = useRouter();
  const stageIdx = stages.findIndex((s) => s.id === lead.stageId);
  async function onArchive() {
    if (!confirm('Архивировать лида? Действие можно отменить только администратору.')) return;
    try { await archiveLead(lead.id); router.refresh(); }
    catch (e) { console.error(e); alert('Не удалось архивировать'); }
  }
  const telHref = `tel:${client.phone.replace(/[^\d+]/g, '')}`;
  return (
    <div className="bg-paper border border-line rounded-lg p-5 md:p-6">
      <div className="flex items-start gap-4 flex-wrap">
        <Avatar name={client.fullName} size="xl" />
        <div className="flex-1 min-w-[200px]">
          <h1 className="text-[20px] font-bold leading-tight tracking-tight text-ink">{client.fullName}</h1>
          <div className="flex flex-wrap gap-1.5 mt-2">
            <Badge variant="gold">{lead.funnelName}</Badge>
            {city && <Badge>{city.name}</Badge>}
            {lead.source && <Badge>{lead.source}</Badge>}
            {lead.debt > 0 ? <Badge variant="danger">долг {formatMoney(lead.debt)} zł</Badge>
              : lead.totalAmount > 0 ? <Badge variant="success">оплачено</Badge> : null}
            {!lead.submittedAt && !lead.isArchived && (
              <Badge variant="danger" withDot>внесок не подан</Badge>
            )}
            {lead.isArchived && <Badge variant="default">в архиве</Badge>}
          </div>
          <div className="mt-2.5 text-12 text-ink-3 flex flex-wrap gap-x-3.5 gap-y-1">
            <span>тел. <strong className="text-ink font-mono">{formatPhone(client.phone)}</strong></span>
            {client.birthDate && <span>род. <strong className="text-ink">{formatDate(client.birthDate)}</strong></span>}
            {lead.firstContactAt && <span>первый контакт <strong className="text-ink">{formatDate(lead.firstContactAt)}</strong></span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5 ml-auto">
          <a href={telHref}><Button><Phone size={12} /> Звонок</Button></a>
          <Link href={whatsappHref}><Button><MessageSquare size={12} /> WhatsApp</Button></Link>
          {currentUser.role === 'ADMIN' && (
            <Button variant="ghost" onClick={onArchive} title="Архив"><Trash2 size={12} /></Button>
          )}
        </div>
      </div>
      <div className="mt-4 pt-3.5 border-t border-line">
        <div className="flex gap-1">
          {stages.map((s, i) => (
            <div key={s.id} className={cn('flex-1 min-w-0 rounded-md px-2 py-1.5 text-[11px] font-semibold border text-center truncate',
              s.id === lead.stageId ? 'bg-navy text-white border-navy'
                : i < stageIdx ? 'bg-success-bg text-success border-success/20'
                  : 'bg-bg text-ink-4 border-line')}>{s.name}</div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ClientCard({ client, lead }: LeadCardViewProps) {
  const [editing, setEditing] = useState(false);
  const altPhones = [client.altPhone, client.altPhone2, client.altPhone3].filter((p): p is string => Boolean(p && p.trim()));
  const stayLabel = client.legalStayType ? LEGAL_STAY_LABEL[client.legalStayType] : null;
  return (
    <Section title="Карточка клиента" action={<Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Изменить</Button>}>
      <Field2Cols rows={[
        [{ label: 'ФИО', value: client.fullName }, { label: 'Дата рождения', value: client.birthDate ? formatDate(client.birthDate) : null }],
        [{ label: 'Национальность', value: client.nationality }, { label: 'Телефон', value: <span className="font-mono">{formatPhone(client.phone)}</span> }],
        [{ label: 'Email', value: client.email }, { label: 'Источник лида', value: lead.source }],
        [
          { label: 'Легальный побыт', value: stayLabel ? <Badge variant={client.legalStayType === 'KARTA' ? 'success' : client.legalStayType === 'VISA' ? 'warn' : 'default'}>{stayLabel}</Badge> : null },
          { label: 'Действует до', value: client.legalStayUntil ? <StayUntilDisplay until={client.legalStayUntil} /> : null },
        ],
        // Anna идея №7: паспорт. Та же подсветка по близости срока что и у побыта —
        // но смысловой бейдж не нужен (паспорт у всех есть).
        [
          { label: 'Паспорт действует до', value: client.passportExpiresAt ? <StayUntilDisplay until={client.passportExpiresAt} /> : null },
          { label: '', value: null },
        ],
      ]} />
      {altPhones.length > 0 && <FieldFull label={`Доп. телефоны (${altPhones.length})`} value={altPhones.map(formatPhone).join('   ·   ')} />}
      <FieldFull label="Адрес проживания в Польше" value={client.addressPL} />
      <FieldFull label="Адрес проживания на родине" value={client.addressHome} />
      {editing && <ClientEditModal client={client} onClose={() => setEditing(false)} />}
    </Section>
  );
}

function ClientEditModal({ client, onClose }: { client: LeadCardViewProps['client']; onClose: () => void }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(client.fullName);
  const [phone, setPhone] = useState(client.phone);
  const [altPhone, setAltPhone] = useState(client.altPhone ?? '');
  const [altPhone2, setAltPhone2] = useState(client.altPhone2 ?? '');
  const [altPhone3, setAltPhone3] = useState(client.altPhone3 ?? '');
  const [email, setEmail] = useState(client.email ?? '');
  const [birthDate, setBirthDate] = useState(client.birthDate ? client.birthDate.slice(0, 10) : '');
  const [nationality, setNationality] = useState(client.nationality ?? '');
  const [addressPL, setAddressPL] = useState(client.addressPL ?? '');
  const [addressHome, setAddressHome] = useState(client.addressHome ?? '');
  const [legalStayType, setLegalStayType] = useState<string>(client.legalStayType ?? '');
  const [legalStayUntil, setLegalStayUntil] = useState(client.legalStayUntil ? client.legalStayUntil.slice(0, 10) : '');
  // Anna идея №7. При смене даты updateClient сбросит флаги напоминаний —
  // новая серия 90/30/14 запустится из cron автоматически.
  const [passportExpiresAt, setPassportExpiresAt] = useState(client.passportExpiresAt ? client.passportExpiresAt.slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null); setBusy(true);
    try {
      await updateClient({ id: client.id, fullName, phone,
        altPhone: altPhone || null, altPhone2: altPhone2 || null, altPhone3: altPhone3 || null,
        email, birthDate: birthDate || null, nationality: nationality || null,
        addressPL: addressPL || null, addressHome: addressHome || null,
        legalStayType:  (legalStayType || null) as 'KARTA' | 'VISA' | 'VISA_FREE' | null,
        legalStayUntil: legalStayUntil || null,
        passportExpiresAt: passportExpiresAt || null,
      });
      router.refresh(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={true} onClose={onClose} title="Редактирование клиента" size="lg"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save} disabled={busy || !fullName || !phone}>{busy ? 'Сохранение...' : 'Сохранить'}</Button></>}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <FormField label="ФИО" required><Input value={fullName} onChange={(e) => setFullName(e.target.value)} autoFocus /></FormField>
        <FormField label="Дата рождения"><Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} /></FormField>
        <FormField label="Телефон (основной)" required hint="Уникален в системе"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></FormField>
        <FormField label="Доп. телефон 1"><Input type="tel" value={altPhone} onChange={(e) => setAltPhone(e.target.value)} placeholder="+48..." /></FormField>
        <FormField label="Доп. телефон 2"><Input type="tel" value={altPhone2} onChange={(e) => setAltPhone2(e.target.value)} placeholder="+48..." /></FormField>
        <FormField label="Доп. телефон 3"><Input type="tel" value={altPhone3} onChange={(e) => setAltPhone3(e.target.value)} placeholder="+48..." /></FormField>
        <FormField label="Email"><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></FormField>
        <FormField label="Национальность"><Input value={nationality} onChange={(e) => setNationality(e.target.value)} /></FormField>
        {/* Легальный побыт: тип + срок окончания */}
        <FormField label="Легальный побыт" hint="Текущий статус пребывания в Польше">
          <Select value={legalStayType} onChange={(e) => setLegalStayType(e.target.value)}>
            <option value="">— не указан —</option>
            <option value="KARTA">Карта побыта</option>
            <option value="VISA">Виза</option>
            <option value="VISA_FREE">Безвиз</option>
          </Select>
        </FormField>
        <FormField label="Действует до" hint="Дата окончания текущего побыта">
          <Input type="date" value={legalStayUntil} onChange={(e) => setLegalStayUntil(e.target.value)} />
        </FormField>
        {/* Срок паспорта (Anna идея №7) — отдельная строка, занимает обе колонки
            чтобы выделить визуально. Cron шлёт менеджеру push за 90/30/14 дней. */}
        <div className="sm:col-span-2">
          <FormField label="Паспорт действует до" hint="Система напомнит менеджеру за 90, 30 и 14 дней до истечения">
            <Input type="date" value={passportExpiresAt} onChange={(e) => setPassportExpiresAt(e.target.value)} />
          </FormField>
        </div>
        <div className="sm:col-span-2"><FormField label="Адрес проживания в Польше"><Input value={addressPL} onChange={(e) => setAddressPL(e.target.value)} /></FormField></div>
        <div className="sm:col-span-2"><FormField label="Адрес проживания на родине"><Input value={addressHome} onChange={(e) => setAddressHome(e.target.value)} /></FormField></div>
      </div>
      {error && <div className="mt-3 bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">{error}</div>}
    </Modal>
  );
}

function DealCard({ lead, salesManager, legalManager, city, workCity, cities, team, attorneys, currentUser }: LeadCardViewProps) {
  const router = useRouter();
  const [showSalesModal, setShowSalesModal] = useState(false);
  const [showLegalModal, setShowLegalModal] = useState(false);
  const [savingWorkCity, setSavingWorkCity] = useState(false);
  async function onPickWorkCity(cityId: string) {
    setSavingWorkCity(true);
    try { await setWorkCity(lead.id, cityId || null); router.refresh(); }
    catch (e) { alert((e as Error).message); } finally { setSavingWorkCity(false); }
  }
  return (
    <Section title="Сделка" action={
      currentUser.role === 'ADMIN' || salesManager?.id === currentUser.id
        ? <Button size="sm" variant="ghost" onClick={() => setShowSalesModal(true)}>Передать другому</Button>
        : null
    }>
      <Field2Cols rows={[
        [
          { label: 'Менеджер продаж', value: salesManager
            ? <ManagerPill name={salesManager.name} onClick={() => setShowSalesModal(true)} clickable={currentUser.role === 'ADMIN'} />
            : <span className="text-ink-4 text-[12px]">не назначен</span> },
          { label: 'Менеджер легализации', value: legalManager
            ? <ManagerPill name={legalManager.name} onClick={() => setShowLegalModal(true)} clickable />
            : <button onClick={() => setShowLegalModal(true)} className="text-[12px] text-navy hover:underline font-medium">+ Назначить</button> },
        ],
        // Раньше тут была плоская строка [Этап воронки / Воронка] — теперь её
        // показывает отдельная секция «Воронка и этап» сверху над «Сделкой»
        // (с возможностью смены воронки/этапа через селекторы). Anna 01.05.2026.
        [
          { label: 'Город обращения', value: city?.name },
          { label: 'Город работы', value: (
            <Select value={workCity?.id ?? ''} onChange={(e) => onPickWorkCity(e.target.value)} disabled={savingWorkCity} className="text-[12.5px] py-0.5">
              <option value="">— не указан —</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )},
        ],
        [
          { label: 'Дата первого контакта', value: lead.firstContactAt ? formatDate(lead.firstContactAt) : null },
          // Anna 30.04.2026: дата подачи внеска в УВ — inline-редактирование.
          // Если null → отображается как «не подан» (красным) и в календаре
          // событие этого клиента подсвечивается красным маркером.
          { label: 'Дата подачи в уженд', value: <SubmittedAtField leadId={lead.id} initial={lead.submittedAt} /> },
        ],
        [
          { label: 'Стоимость услуг', value: <span className="font-mono font-bold">{formatMoney(lead.totalAmount)} zł</span> },
          // Anna 30.04.2026: «строчка номер дела рядом со стоимостью услуг,
          // необязательная». Inline-редактор, сохраняет на blur и Enter.
          { label: 'Номер дела', value: <CaseNumberField leadId={lead.id} initial={lead.caseNumber} /> },
        ],
      ]} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-line-2 -mx-4 md:-mx-5 -mb-1 mt-px">
        <div className="bg-paper px-4 md:px-5 py-2.5 hidden sm:block" />
        <div className="bg-paper px-4 md:px-5 py-2.5">
          <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-1">Pelnomocnik</div>
          <PelnomocnikSelector leadId={lead.id} currentName={lead.attorney} attorneys={attorneys} />
        </div>
      </div>
      <Modal open={showSalesModal} onClose={() => setShowSalesModal(false)} title="Передать менеджеру продаж">
        <ManagerSelector team={team.filter((t) => t.role === 'SALES')} currentId={salesManager?.id}
          onPick={async (id) => { try { await reassignSalesManager(lead.id, id); setShowSalesModal(false); router.refresh(); } catch (e) { console.error(e); alert('Ошибка'); }}} />
      </Modal>
      <Modal open={showLegalModal} onClose={() => setShowLegalModal(false)} title="Назначить менеджера легализации">
        <ManagerSelector team={team.filter((t) => t.role === 'LEGAL')} currentId={legalManager?.id}
          onPick={async (id) => { try { await reassignLegalManager(lead.id, id); setShowLegalModal(false); router.refresh(); } catch (e) { console.error(e); alert('Ошибка'); }}} />
      </Modal>
    </Section>
  );
}

function PelnomocnikSelector({ leadId, currentName, attorneys }: { leadId: string; currentName: string | null; attorneys: Array<{ id: string; name: string; role: UserRole }> }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const currentInList = currentName && attorneys.some((a) => a.name === currentName);
  async function onPick(name: string) {
    setBusy(true);
    try { await setAttorney(leadId, name || null); router.refresh(); }
    catch (e) { alert((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Select value={currentName ?? ''} onChange={(e) => onPick(e.target.value)} disabled={busy}>
      <option value="">— не назначен —</option>
      {attorneys.map((a) => <option key={a.id} value={a.name}>{a.name}</option>)}
      {currentName && !currentInList && <option value={currentName}>{currentName}</option>}
    </Select>
  );
}

function ManagerSelector({ team, currentId, onPick }: { team: Array<{ id: string; name: string; email: string }>; currentId?: string; onPick: (id: string | null) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {team.map((m) => (
        <button key={m.id} type="button" onClick={() => onPick(m.id)}
          className={cn('flex items-center gap-3 p-2.5 rounded-md border transition-colors text-left',
            m.id === currentId ? 'bg-bg border-navy/30' : 'border-line hover:border-ink-5 hover:bg-bg')}>
          <Avatar name={m.name} size="md" />
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold text-ink">{m.name}</div>
            <div className="text-[11px] text-ink-4">{m.email}</div>
          </div>
          {m.id === currentId && <CheckCircle size={16} className="text-navy shrink-0" />}
        </button>
      ))}
      {currentId && <button type="button" onClick={() => onPick(null)} className="mt-2 text-[12px] text-danger hover:underline">Снять менеджера</button>}
    </div>
  );
}

function ServicesCard({ lead, leadServices, allServices }: LeadCardViewProps) {
  const [editing, setEditing] = useState(false);
  const total = leadServices.reduce((s, it) => s + it.amount * it.qty, 0);
  return (
    <Section title="Услуги" count={leadServices.length}
      action={<Button size="sm" variant="primary" onClick={() => setEditing(true)}><Edit3 size={11} /> Изменить</Button>}>
      {leadServices.length === 0 ? (
        <div className="text-center py-4 text-[12.5px] text-ink-4">Услуги ещё не добавлены. Нажмите «Изменить» чтобы выбрать.</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {leadServices.map((s) => (
            <div key={s.id} className="flex items-center gap-3 p-2.5 rounded-md border border-line bg-paper">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink truncate">{s.serviceName}</div>
                {s.notes && <div className="text-[11.5px] text-ink-3 mt-0.5 truncate">{s.notes}</div>}
              </div>
              {s.qty > 1 && <span className="text-[11.5px] text-ink-3 font-mono whitespace-nowrap">×{s.qty}</span>}
              <span className="text-[12.5px] text-ink font-mono font-semibold whitespace-nowrap">{formatMoney(s.amount * s.qty)} zł</span>
            </div>
          ))}
          <div className="flex justify-between items-baseline pt-2 mt-1 border-t border-line">
            <span className="text-[10.5px] uppercase tracking-[0.05em] text-ink-4 font-semibold">Итого</span>
            <span className="text-[15px] text-ink font-mono font-bold">{formatMoney(total)} zł</span>
          </div>
        </div>
      )}
      {editing && <ServicesEditModal leadId={lead.id} allServices={allServices} current={leadServices} onClose={() => setEditing(false)} />}
    </Section>
  );
}

interface DraftItem { serviceId: string; amount: number; qty: number; notes: string; }

function ServicesEditModal({ leadId, allServices, current, onClose }: { leadId: string; allServices: ServiceLite[]; current: LeadServiceLite[]; onClose: () => void }) {
  const router = useRouter();
  const [items, setItems] = useState<DraftItem[]>(() =>
    current.map((c) => ({ serviceId: c.serviceId, amount: c.amount, qty: c.qty, notes: c.notes ?? '' })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function addItem() {
    const svc = allServices[0];
    if (!svc) return;
    setItems((prev) => [...prev, { serviceId: svc.id, amount: svc.basePrice, qty: 1, notes: '' }]);
  }
  function updateItem(idx: number, patch: Partial<DraftItem>) { setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it))); }
  function removeItem(idx: number) { setItems((prev) => prev.filter((_, i) => i !== idx)); }
  function onChangeService(idx: number, serviceId: string) {
    const svc = allServices.find((s) => s.id === serviceId);
    if (!svc) return;
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it;
      const oldSvc = allServices.find((s) => s.id === it.serviceId);
      const wasBasePrice = !oldSvc || it.amount === oldSvc.basePrice;
      return { ...it, serviceId: svc.id, amount: wasBasePrice ? svc.basePrice : it.amount };
    }));
  }
  async function save() {
    setError(null); setBusy(true);
    try {
      await setLeadServices({ leadId, items: items.map((it) => ({
        serviceId: it.serviceId, amount: Number(it.amount) || 0,
        qty: Number(it.qty) || 1, notes: it.notes.trim() || null,
      }))});
      router.refresh(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const total = items.reduce((s, it) => s + (Number(it.amount) || 0) * (Number(it.qty) || 1), 0);
  return (
    <Modal open={true} onClose={onClose} title="Услуги по лиду" size="lg"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Сохранение...' : `Сохранить (${formatMoney(total)} zł)`}</Button></>}>
      <div className="flex flex-col gap-2">
        {items.length === 0 && <div className="text-center py-4 text-[12.5px] text-ink-4">Список пуст. Добавьте хотя бы одну услугу.</div>}
        {items.map((it, idx) => (
          <div key={idx} className="border border-line rounded-md p-2.5 bg-bg/50 flex flex-col gap-2">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_120px_70px_28px] gap-2 items-end">
              <FormField label={`Услуга #${idx + 1}`}>
                <Select value={it.serviceId} onChange={(e) => onChangeService(idx, e.target.value)}>
                  {allServices.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </FormField>
              <FormField label="Сумма (zł)"><Input type="number" min="0" step="0.01" value={it.amount} onChange={(e) => updateItem(idx, { amount: Number(e.target.value) })} /></FormField>
              <FormField label="Кол-во"><Input type="number" min="1" step="1" value={it.qty} onChange={(e) => updateItem(idx, { qty: Number(e.target.value) })} /></FormField>
              <button type="button" onClick={() => removeItem(idx)} className="h-9 w-9 grid place-items-center rounded-md border border-line text-ink-4 hover:text-danger hover:border-danger/40" title="Удалить услугу из лида"><X size={13} /></button>
            </div>
            <Input value={it.notes} onChange={(e) => updateItem(idx, { notes: e.target.value })} placeholder="Примечание (необязательно)" />
          </div>
        ))}
        <div className="flex items-center justify-between pt-2">
          <Button onClick={addItem} disabled={allServices.length === 0}><Plus size={11} /> Добавить услугу</Button>
          <div className="text-[13px] text-ink">Итого: <span className="font-mono font-bold">{formatMoney(total)} zł</span></div>
        </div>
        {error && <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">{error}</div>}
        <div className="text-[11px] text-ink-4 mt-1">Итоговая стоимость лида и чек-лист документов будут пересчитаны автоматически.</div>
      </div>
    </Modal>
  );
}

function EmployerCard({ lead }: LeadCardViewProps) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName]   = useState(lead.employerName  ?? '');
  const [phone, setPhone] = useState(lead.employerPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!editing) {
      setName(lead.employerName ?? '');
      setPhone(lead.employerPhone ?? '');
      setError(null);
    }
  }, [editing, lead.employerName, lead.employerPhone]);
  async function save() {
    setError(null); setBusy(true);
    try {
      await setEmployer({ leadId: lead.id, name: name.trim() || null, phone: phone.trim() || null });
      router.refresh(); setEditing(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const hasData = lead.employerName || lead.employerPhone;
  const telHref = lead.employerPhone ? `tel:${lead.employerPhone.replace(/[^\d+]/g, '')}` : null;
  return (
    <Section title="Работодатель"
      action={<Button size="sm" variant="ghost" onClick={() => setEditing(true)}><Briefcase size={11} /> {hasData ? 'Изменить' : 'Указать'}</Button>}>
      {!hasData ? (
        <div className="text-center py-4 text-[12.5px] text-ink-4">Работодатель не указан. Нужно для karta pobytu / karta praca.</div>
      ) : (
        <Field2Cols rows={[[
          { label: 'Название', value: lead.employerName },
          { label: 'Телефон', value: telHref ? <a href={telHref} className="font-mono text-navy hover:underline">{formatPhone(lead.employerPhone!)}</a> : null },
        ]]} />
      )}
      {editing && (
        <Modal open={true} onClose={() => setEditing(false)} title="Работодатель"
          footer={<><Button onClick={() => setEditing(false)}>Отмена</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Сохранение...' : 'Сохранить'}</Button></>}>
          <div className="flex flex-col gap-3">
            <FormField label="Название организации"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder='Например: Sp. z o.o. "ABC"' autoFocus /></FormField>
            <FormField label="Контактный телефон работодателя"><Input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+48..." /></FormField>
            <p className="text-[11.5px] text-ink-4">Эти данные используются при подаче karta pobytu / karta praca. Очистите оба поля чтобы убрать работодателя.</p>
            {error && <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">{error}</div>}
          </div>
        </Modal>
      )}
    </Section>
  );
}

function DocumentsCard({ lead, documents }: LeadCardViewProps) {
  const router = useRouter();
  const have = documents.filter((d) => d.isPresent).length;
  const total = documents.length;
  const pct = total ? Math.round((have / total) * 100) : 0;
  const missing = documents.filter((d) => !d.isPresent).length;
  async function onToggle(docId: string, isPresent: boolean) {
    try { await toggleDocument(docId, isPresent); router.refresh(); }
    catch (e) { console.error(e); }
  }
  if (total === 0) {
    return <Section title="Чек-лист документов" count={`0/0`}><div className="text-center py-6 text-[12px] text-ink-4">Шаблон документов для воронки «{lead.funnelName}» не задан.</div></Section>;
  }
  return (
    <Section title="Чек-лист документов" count={`${have}/${total}`}>
      <div className="bg-bg rounded-md p-3 mb-3">
        <div className="flex justify-between items-baseline mb-2">
          <div className="text-[12px] font-semibold text-ink-2">Готовность пакета</div>
          <div className="text-[14px] font-bold tracking-tight">{pct}%</div>
        </div>
        <div className="h-1 bg-line rounded-full overflow-hidden"><div className="h-full bg-navy rounded-full transition-all" style={{ width: `${pct}%` }} /></div>
      </div>
      <div className="flex flex-col gap-1">
        {documents.map((d) => (
          <button key={d.id} type="button" onClick={() => onToggle(d.id, !d.isPresent)}
            className={cn('group flex items-center gap-3 p-2.5 rounded-md border text-left transition-colors',
              d.isPresent ? 'bg-success-bg border-success/20' : 'bg-paper border-danger/25 hover:border-danger/50')}>
            <div className={cn('w-[18px] h-[18px] rounded-full border-[1.5px] grid place-items-center shrink-0',
              d.isPresent ? 'bg-success border-success text-white' : 'border-danger bg-danger-bg')}>
              {d.isPresent && <Check size={11} strokeWidth={3} />}
            </div>
            <span className={cn('flex-1 text-[13px] font-medium', d.isPresent ? 'text-success' : 'text-danger')}>{d.name}</span>
            <span className={cn('text-[10.5px] font-bold uppercase tracking-[0.04em]', d.isPresent ? 'text-success' : 'text-danger')}>{d.isPresent ? 'есть' : 'нет'}</span>
          </button>
        ))}
      </div>
      {missing > 0 && (
        <div className="mt-3 bg-danger/[0.04] border border-danger/20 rounded-md px-3 py-2.5 flex items-center gap-2.5 text-[12.5px] text-danger font-medium">
          <AlertCircle size={14} className="shrink-0" />
          Не хватает {missing} {plural(missing, 'документ', 'документа', 'документов')} — клиент не сможет подать заявление
        </div>
      )}
    </Section>
  );
}

function CalendarCard({ lead, calendarEvents, legalManager, currentUser }: LeadCardViewProps) {
  const router = useRouter();
  const [showFingerprintModal, setShowFingerprintModal] = useState(false);
  const [showExtraCallModal, setShowExtraCallModal] = useState(false);
  async function onDeleteEvent(eventId: string) {
    if (!confirm('Удалить событие из календаря?')) return;
    try { await deleteCalendarEvent(eventId); router.refresh(); }
    catch (e) { alert((e as Error).message); }
  }
  return (
    <>
      <Section title="Отпечатки и доп. вызвания" action={
        <div className="flex gap-1.5">
          <Button size="sm" onClick={() => setShowExtraCallModal(true)}><Plus size={11} /> Доп. вызвание</Button>
          <Button size="sm" variant="primary" onClick={() => setShowFingerprintModal(true)}><Plus size={11} /> Отпечатки</Button>
        </div>
      }>
        {calendarEvents.length === 0 ? (
          <div className="text-center py-6 text-[12.5px] text-ink-4">Дат пока нет</div>
        ) : (
          <div className="flex flex-col gap-1.5">
            {calendarEvents.map((e) => {
              const dt = new Date(e.startsAt);
              const dayNum = dt.getDate();
              const monthShort = dt.toLocaleDateString('ru-RU', { month: 'short' }).replace('.', '');
              const time = dt.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
              const days = daysUntil(e.startsAt);
              const accent = e.kind === 'FINGERPRINT' ? 'border-l-warn' : e.kind === 'EXTRA_CALL' ? 'border-l-danger' : 'border-l-navy';
              return (
                <div key={e.id} className={cn('flex items-center gap-3 p-3 rounded-md border bg-paper border-l-2 group', accent, 'border-y-line border-r-line')}>
                  <div className="text-center min-w-[44px]">
                    <div className="text-[20px] font-bold tracking-tight text-ink leading-none">{dayNum}</div>
                    <div className="text-[10px] text-ink-4 uppercase tracking-[0.05em] font-semibold mt-0.5">{monthShort}</div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-semibold text-ink">{e.title}</div>
                    <div className="text-[11.5px] text-ink-3 mt-0.5 flex flex-wrap gap-2">
                      <span className="font-semibold text-ink-2 font-mono">{time}</span>
                      {e.location && <span>{e.location}</span>}
                      {e.googleId && <span className="text-gold">Google Calendar</span>}
                      {days !== null && days >= 0 && days <= 7 && (
                        <span className={cn('font-semibold', days === 0 ? 'text-danger' : days <= 1 ? 'text-warn' : 'text-info')}>
                          {days === 0 ? 'сегодня' : days === 1 ? 'завтра' : `через ${days} ${plural(days, 'день', 'дня', 'дней')}`}
                        </span>
                      )}
                    </div>
                  </div>
                  {(currentUser.role === 'ADMIN' || currentUser.id === legalManager?.id) && (
                    <button type="button" onClick={() => onDeleteEvent(e.id)} className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger transition-opacity p-1" title="Удалить из календаря"><Trash2 size={12} /></button>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="mt-3 text-[11.5px] text-ink-3">События синхронизируются с Google Calendar менеджера легализации{legalManager && ` (${legalManager.name})`}.</div>
      </Section>
      <FingerprintModal open={showFingerprintModal} onClose={() => setShowFingerprintModal(false)} leadId={lead.id} currentDate={lead.fingerprintDate} currentLocation={lead.fingerprintLocation} onSaved={() => { setShowFingerprintModal(false); router.refresh(); }} />
      <ExtraCallModal open={showExtraCallModal} onClose={() => setShowExtraCallModal(false)} leadId={lead.id} onSaved={() => { setShowExtraCallModal(false); router.refresh(); }} />
    </>
  );
}

function FingerprintModal({ open, onClose, leadId, currentDate, currentLocation, onSaved }: { open: boolean; onClose: () => void; leadId: string; currentDate: string | null; currentLocation: string | null; onSaved: () => void }) {
  const [date, setDate] = useState(currentDate ? currentDate.slice(0, 16) : '');
  const [loc, setLoc] = useState(currentLocation ?? '');
  const [busy, setBusy] = useState(false);
  // Anna 01.05.2026: при «Не удалось сохранить» алерт выводил только общий
  // текст, реальная ошибка сервера терялась в console.error. Теперь показываем
  // её прямо в alert чтобы менеджер мог сразу понять что не так
  // (нет прав / лид не найден / Google API недоступен / сессия истекла).
  async function save() {
    setBusy(true);
    try { await setFingerprintDate(leadId, date || null, loc || null); onSaved(); }
    catch (e) {
      console.error(e);
      const msg = (e as Error).message || 'неизвестная ошибка';
      alert('Не удалось сохранить: ' + msg);
    }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Дата отпечатков"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save} disabled={busy}>{busy ? 'Сохранение...' : 'Сохранить'}</Button></>}>
      <div className="flex flex-col gap-3">
        <FormField label="Дата и время"><Input type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} /></FormField>
        <FormField label="Место" hint="Например: Urząd Wojewódzki Łódzki, ауд. 12"><Input value={loc} onChange={(e) => setLoc(e.target.value)} placeholder="УВ Łódzki" /></FormField>
        <p className="text-[11.5px] text-ink-4">Событие будет добавлено в Google Calendar менеджера легализации. Клиенту автоматически придёт напоминание в WhatsApp за 7 и за 1 день.</p>
      </div>
    </Modal>
  );
}

/** Модалка доп. вызвания.
 *  Две даты:
 *    - notifiedAt — когда УВ прислал уведомление (дата вызвания)
 *    - dueDate    — дедлайн донести запрошенные документы
 *  Поле "Место" убрано (фактически не использовалось).
 *  Поле "Запрос" — что именно затребовали (вместо общей "темы").
 */
function ExtraCallModal({ open, onClose, leadId, onSaved }: { open: boolean; onClose: () => void; leadId: string; onSaved: () => void }) {
  const [notifiedAt, setNotifiedAt] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [request, setRequest] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setError(null);
    if (!notifiedAt) { setError('Укажите дату вызвания'); return; }
    if (!dueDate)    { setError('Укажите срок донести документы'); return; }
    setBusy(true);
    try {
      await addExtraCall({
        leadId,
        notifiedAt,
        dueDate,
        title: request || null,
      });
      setNotifiedAt(''); setDueDate(''); setRequest('');
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Доп. вызвание"
      footer={<><Button onClick={onClose}>Закрыть</Button><Button variant="primary" onClick={save} disabled={busy || !notifiedAt || !dueDate}>{busy ? 'Сохранение...' : 'Добавить'}</Button></>}>
      <div className="flex flex-col gap-3">
        <FormField label="Дата вызвания" required hint="Когда УВ прислал уведомление">
          <Input type="date" value={notifiedAt} onChange={(e) => setNotifiedAt(e.target.value)} autoFocus />
        </FormField>
        <FormField label="Срок" required hint="Дедлайн — до какой даты нужно донести документы">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} min={notifiedAt || undefined} />
        </FormField>
        <FormField label="Запрос документов" hint="Какие документы затребовал УВ">
          <Textarea value={request} onChange={(e) => setRequest(e.target.value)} rows={3} placeholder="Например: справка о доходах за последние 6 месяцев, копия договора аренды, выписка из банка" />
        </FormField>
        {error && <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] p-2.5 rounded-md">{error}</div>}
        <p className="text-[11.5px] text-ink-4">Срок попадёт в Google Calendar менеджера легализации с напоминаниями за сутки и за час. В истории сделки сохранятся обе даты.</p>
      </div>
    </Modal>
  );
}

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
      <Section title="Оплаты" action={<Button size="sm" variant="success" onClick={() => setShowAddModal(true)}><Plus size={11} /> Платёж</Button>}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-px bg-line rounded-md overflow-hidden mb-3">
          <div className="bg-paper p-3.5">
            <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.06em] mb-1.5">Стоимость</div>
            <div className="text-[20px] font-bold tracking-tight font-mono">{formatMoney(lead.totalAmount)}<span className="text-[12px] text-ink-4 ml-1">zł</span></div>
          </div>
          <div className="bg-paper p-3.5">
            <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.06em] mb-1.5">Получено</div>
            <div className="text-[20px] font-bold tracking-tight font-mono text-success">{formatMoney(lead.paid)}<span className="text-[12px] text-ink-4 ml-1">zł</span></div>
          </div>
          <div className="bg-paper p-3.5">
            <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.06em] mb-1.5">Долг</div>
            <div className={cn('text-[20px] font-bold tracking-tight font-mono', lead.debt > 0 ? 'text-danger' : 'text-ink-4')}>{formatMoney(lead.debt)}<span className="text-[12px] text-ink-4 ml-1">zł</span></div>
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
                  <td className="py-2 px-3 text-right font-mono font-bold text-success whitespace-nowrap">+{formatMoney(p.amount)} zł</td>
                  {currentUser.role === 'ADMIN' && (
                    <td className="py-2 px-3"><button type="button" onClick={() => onDelete(p.id)} className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger transition-opacity" aria-label="Удалить платёж"><Trash2 size={12} /></button></td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
      <AddPaymentModal open={showAddModal} onClose={() => setShowAddModal(false)} leadId={lead.id} onSaved={() => { setShowAddModal(false); router.refresh(); }} />
    </>
  );
}

function AddPaymentModal({ open, onClose, leadId, onSaved }: { open: boolean; onClose: () => void; leadId: string; onSaved: () => void }) {
  // Дата платежа по умолчанию — сегодня (yyyy-mm-dd для <input type="date">).
  // Anna просила: чтобы можно было разносить старые платежи задним числом.
  const today = new Date().toISOString().slice(0, 10);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [paidAt, setPaidAt] = useState(today);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await addPayment({
        leadId,
        amount: Number(amount),
        method,
        paidAt: paidAt || undefined, // пустое поле = сейчас
        notes: notes || undefined,
      });
      setAmount(''); setNotes(''); setPaidAt(today); onSaved();
    } catch (e) { console.error(e); alert((e as Error).message || 'Ошибка'); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Новый платёж"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="success" onClick={save} disabled={busy || !amount}>{busy ? 'Сохранение...' : 'Записать'}</Button></>}>
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Сумма (zł)" required><Input type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus /></FormField>
          <FormField label="Способ">
            <Select value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
              <option value="CASH">Наличные</option><option value="CARD">Карта</option><option value="TRANSFER">Перевод</option><option value="OTHER">Другое</option>
            </Select>
          </FormField>
        </div>
        <FormField label="Дата платежа" required>
          <Input type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} max={today} />
        </FormField>
        <FormField label="Примечание"><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Аванс, доплата..." /></FormField>
      </div>
    </Modal>
  );
}

function methodLabel(m: PaymentMethod): string {
  return ({ CARD: 'Карта', CASH: 'Наличные', TRANSFER: 'Перевод', OTHER: 'Другое' }[m]);
}

function NotesCard({ lead, notes, team }: LeadCardViewProps) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!body.trim()) return;
    setBusy(true);
    try { await addNote({ leadId: lead.id, body: body.trim() }); setBody(''); router.refresh(); }
    catch (e) { console.error(e); alert('Ошибка'); }
    finally { setBusy(false); }
  }
  const mentionables = team.slice(0, 5).map((t) => t.email.split('@')[0]).join(' ');
  return (
    <Section title="Заметки команды" count={notes.length}>
      <div className="bg-paper border border-line rounded-md p-3 mb-3 focus-within:border-gold transition-colors">
        <Textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="Заметка для команды... используйте @login чтобы упомянуть коллегу" rows={3} className="border-0 p-0 focus:ring-0 focus:border-0 min-h-[60px] text-[13px]" />
        <div className="flex justify-between items-center pt-2 border-t border-line-2">
          <div className="text-[11px] text-ink-4">Упомянуть: <span className="text-gold font-semibold font-mono">{mentionables ? '@' + mentionables.split(' ').join(' @') : ''}</span></div>
          <Button size="sm" variant="primary" onClick={save} disabled={busy || !body.trim()}>Добавить</Button>
        </div>
      </div>
      {notes.length === 0 ? (
        <div className="text-center py-4 text-[12px] text-ink-4">Заметок пока нет</div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {notes.map((n) => (
            <div key={n.id} className="bg-paper border border-line rounded-md p-3">
              <div className="flex justify-between items-center mb-1.5 gap-3">
                <div className="flex items-center gap-2"><Avatar name={n.author.name} size="sm" /><span className="text-[12px] font-semibold text-ink">{n.author.name}</span></div>
                <span className="text-[11px] text-ink-4 whitespace-nowrap" title={formatDateTime(n.createdAt)}>{formatRelative(n.createdAt)}</span>
              </div>
              <div className="text-[12.5px] text-ink-2 leading-relaxed whitespace-pre-wrap" dangerouslySetInnerHTML={{
                __html: n.body.replace(/@([a-zA-Z0-9._-]+)/g, '<span class="text-gold font-semibold bg-gold-pale px-1 rounded">@$1</span>'),
              }} />
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function InternalDocsCard({ lead, internalDocs }: LeadCardViewProps) {
  const router = useRouter();
  const [editorOpen, setEditorOpen] = useState<{ id: string; name: string; mode: 'edit' | 'view' } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [blueprintsOpen, setBlueprintsOpen] = useState(false);
  return (
    <Section title="Внутренние документы" count={internalDocs.length} action={
      <div className="flex gap-1.5">
        <Button size="sm" onClick={() => setBlueprintsOpen(true)}>Из шаблона</Button>
        <Button size="sm" variant="primary" onClick={() => setCreateOpen(true)}><Plus size={11} /> Создать</Button>
      </div>
    }>
      {internalDocs.length === 0 ? (
        <div className="text-center py-6">
          <FileText size={28} className="mx-auto text-ink-5 mb-2" />
          <div className="text-[13px] font-semibold text-ink mb-1">Документов пока нет</div>
          <div className="text-[12px] text-ink-3 max-w-md mx-auto">Создавайте документы прямо в браузере (Word онлайн) или из готовых шаблонов с автоподстановкой данных клиента.</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {internalDocs.map((d) => (
            <button key={d.id} type="button" onClick={() => setEditorOpen({ id: d.id, name: d.name, mode: 'edit' })}
              className="flex items-center gap-3 p-2.5 rounded-md border border-line bg-paper hover:border-ink-5 transition-colors text-left">
              <div className={cn('w-8 h-8 rounded grid place-items-center text-[10px] font-bold shrink-0',
                d.format === 'PDF' ? 'bg-danger-bg text-danger' :
                d.format === 'XLSX' ? 'bg-success-bg text-success' :
                d.format === 'PPTX' ? 'bg-warn-bg text-warn' : 'bg-info-bg text-info')}>{d.format}</div>
              <div className="flex-1 min-w-0">
                <div className="text-[12.5px] font-semibold text-ink truncate">{d.name}</div>
                <div className="text-[10.5px] text-ink-4 mt-0.5">{d.author || 'неизвестно'} · {formatRelative(d.createdAt)}{d.version > 1 && ` · v${d.version}`}</div>
              </div>
              <Edit3 size={12} className="text-ink-4 shrink-0" />
            </button>
          ))}
        </div>
      )}
      {editorOpen && <OnlyOfficeEditor open={true} documentId={editorOpen.id} documentName={editorOpen.name} mode={editorOpen.mode} onClose={() => { setEditorOpen(null); router.refresh(); }} />}
      <CreateDocumentModal open={createOpen} onClose={() => setCreateOpen(false)} leadId={lead.id} onCreated={(id, name) => { setCreateOpen(false); setEditorOpen({ id, name, mode: 'edit' }); }} />
      <BlueprintsModal open={blueprintsOpen} onClose={() => setBlueprintsOpen(false)} leadId={lead.id} onCreated={(id, name) => { setBlueprintsOpen(false); setEditorOpen({ id, name, mode: 'edit' }); }} />
    </Section>
  );
}

function CreateDocumentModal({ open, onClose, leadId, onCreated }: { open: boolean; onClose: () => void; leadId: string; onCreated: (id: string, name: string) => void }) {
  const [name, setName] = useState('');
  const [format, setFormat] = useState<'DOCX' | 'XLSX' | 'PPTX'>('DOCX');
  const [busy, setBusy] = useState(false);
  async function save() {
    if (!name.trim()) return;
    setBusy(true);
    try {
      const { createBlankDocument } = await import('../../document-actions');
      const res = await createBlankDocument({ leadId, name: name.trim(), format });
      onCreated(res.id, name.trim()); setName('');
    } catch (e) { console.error(e); alert((e as Error).message); }
    finally { setBusy(false); }
  }
  return (
    <Modal open={open} onClose={onClose} title="Новый документ"
      footer={<><Button onClick={onClose}>Отмена</Button><Button variant="primary" onClick={save} disabled={busy || !name.trim()}>{busy ? 'Создание...' : 'Создать и открыть'}</Button></>}>
      <div className="flex flex-col gap-3">
        <FormField label="Название документа" required><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Договор с клиентом" autoFocus /></FormField>
        <FormField label="Формат">
          <Select value={format} onChange={(e) => setFormat(e.target.value as 'DOCX' | 'XLSX' | 'PPTX')}>
            <option value="DOCX">Word (.docx)</option><option value="XLSX">Excel (.xlsx)</option><option value="PPTX">PowerPoint (.pptx)</option>
          </Select>
        </FormField>
        <p className="text-[11.5px] text-ink-4">Документ откроется в редакторе OnlyOffice прямо в браузере. Изменения сохраняются автоматически.</p>
      </div>
    </Modal>
  );
}

function BlueprintsModal({ open, onClose, leadId, onCreated }: { open: boolean; onClose: () => void; leadId: string; onCreated: (id: string, name: string) => void }) {
  const [blueprints, setBlueprints] = useState<Array<{ id: string; name: string; description: string | null; placeholders: string[] }>>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch('/api/blueprints').then((r) => r.json()).then((data) => setBlueprints(data.blueprints ?? [])).catch(() => {}).finally(() => setLoading(false));
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
          <div className="text-[12px] text-ink-4">Загрузите .docx-шаблоны в настройках администратора</div>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {blueprints.map((bp) => (
            <button key={bp.id} type="button" onClick={() => pick(bp)} disabled={busy !== null}
              className="flex items-start gap-3 p-3 rounded-md border border-line hover:border-ink-5 transition-colors text-left disabled:opacity-50">
              <div className="w-8 h-8 rounded bg-info-bg text-info grid place-items-center text-[10px] font-bold shrink-0">DOCX</div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-ink">{bp.name}</div>
                {bp.description && <div className="text-[11.5px] text-ink-3 mt-0.5">{bp.description}</div>}
                {bp.placeholders.length > 0 && (
                  <div className="text-[10.5px] text-ink-4 mt-1 font-mono">Поля: {bp.placeholders.slice(0, 5).join(', ')}{bp.placeholders.length > 5 && ` +${bp.placeholders.length - 5}`}</div>
                )}
              </div>
              {busy === bp.id && <div className="text-[11px] text-info font-medium">создаётся...</div>}
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}

function ClientFilesCard({ clientFiles, client }: LeadCardViewProps) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 50 * 1024 * 1024) { alert('Файл больше 50 МБ'); return; }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file); fd.append('clientId', client.id); fd.append('category', 'GENERAL');
      const res = await fetch('/api/files/upload', { method: 'POST', body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки');
      router.refresh();
    } catch (e) { alert((e as Error).message); }
    finally { setUploading(false); if (e.target) e.target.value = ''; }
  }
  async function onDelete(fileId: string) {
    if (!confirm('Удалить файл?')) return;
    try { await removeClientFile(fileId); router.refresh(); }
    catch (e) { alert((e as Error).message); }
  }
  return (
    <Section title="Файлы клиента" count={clientFiles.length} action={
      <label className={cn('inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] font-medium border',
        'border-line bg-paper text-ink-2 hover:border-ink-5 cursor-pointer transition-colors',
        uploading && 'opacity-60 pointer-events-none')}>
        <Upload size={11} />{uploading ? 'Загрузка...' : 'Загрузить'}
        <input type="file" className="hidden" onChange={handleFile} disabled={uploading} />
      </label>
    }>
      {clientFiles.length === 0 ? (
        <div className="text-center py-6 text-[12.5px] text-ink-4">Файлов клиента пока нет.<br />Перетащите или загрузите .pdf / .jpg / .png</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {clientFiles.map((f) => (
            <div key={f.id} className="group flex items-center gap-2.5 p-2 rounded-md border border-line bg-paper hover:border-ink-5 transition-colors min-w-0">
              <a href={f.fileUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2.5 flex-1 min-w-0">
                <Paperclip size={14} className="text-ink-4 shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] font-semibold text-ink truncate">{f.name}</div>
                  <div className="text-[10.5px] text-ink-4">{formatFileSize(f.fileSize)}</div>
                </div>
              </a>
              <button type="button" onClick={() => onDelete(f.id)} className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-danger transition-opacity" aria-label="Удалить"><X size={11} /></button>
            </div>
          ))}
        </div>
      )}
    </Section>
  );
}

function QuickActionsAside({ client, lead, whatsappHref }: LeadCardViewProps) {
  const phoneClean = client.phone.replace(/[^\d+]/g, '');
  const telHref  = `tel:${phoneClean}`;
  const mailHref = client.email ? `mailto:${client.email}` : null;
  const meetHref = `/clients/${lead.id}#calendar`;
  return (
    <Section title="Быстрые действия" tight>
      <div className="grid grid-cols-2 gap-1.5">
        <QuickLink icon={<MessageSquare size={11} />} label="WhatsApp" color="bg-wa text-white" href={whatsappHref} />
        <QuickLink icon={<Phone size={11} />} label="Позвонить" color="bg-navy text-gold" href={telHref} external />
        <QuickLink icon={<Mail size={11} />} label="Email" color="bg-info text-white" href={mailHref ?? undefined} external disabled={!mailHref} />
        <QuickLink icon={<CalendarIcon size={11} />} label="Встреча" color="bg-gold text-navy" href={meetHref} />
      </div>
    </Section>
  );
}

function QuickLink({ icon, label, color, href, external, disabled }: { icon: React.ReactNode; label: string; color: string; href?: string; external?: boolean; disabled?: boolean }) {
  const inner = (
    <>
      <span className={cn('w-[22px] h-[22px] rounded grid place-items-center shrink-0', color)}>{icon}</span>
      {label}
    </>
  );
  const cls = cn(
    'flex items-center gap-2 px-3 py-2.5 rounded-md border border-line bg-paper text-[12px] font-medium text-ink-2',
    'hover:bg-bg hover:border-ink-5 transition-colors',
    disabled && 'opacity-40 cursor-not-allowed pointer-events-none',
  );
  if (disabled || !href) return <span className={cls}>{inner}</span>;
  if (external) return <a href={href} className={cls}>{inner}</a>;
  return <Link href={href} className={cls}>{inner}</Link>;
}

function OtherLeadsAside({ otherLeads }: LeadCardViewProps) {
  if (otherLeads.length === 0) return null;
  return (
    <Section title="Другие дела клиента" count={otherLeads.length} tight>
      <div className="flex flex-col gap-1">
        {otherLeads.map((l) => (
          <Link key={l.id} href={`/clients/${l.id}`} className="flex items-center gap-2 p-2 rounded-md hover:bg-bg transition-colors">
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-semibold text-ink truncate">{l.funnelName}</div>
              <div className="text-[11px] text-ink-4 mt-0.5">{formatDate(l.createdAt)}</div>
            </div>
            <span className="text-[10.5px] font-medium px-1.5 py-0.5 rounded border whitespace-nowrap"
              style={{ background: (l.stageColor || '#71717A') + '14', color: l.stageColor || '#71717A', borderColor: (l.stageColor || '#71717A') + '33' }}>{l.stageName}</span>
            <ChevronRight size={12} className="text-ink-4" />
          </Link>
        ))}
      </div>
    </Section>
  );
}

function ActivityAside({ events }: LeadCardViewProps) {
  return (
    <Section title="История" tight>
      {events.length === 0 ? (
        <div className="text-center py-3 text-[12px] text-ink-4">Событий нет</div>
      ) : (
        <div className="flex flex-col">
          {events.map((e) => (
            <div key={e.id} className="flex gap-2.5 py-2 border-b border-dashed border-line-2 last:border-0">
              <div className={cn('w-6 h-6 rounded-full grid place-items-center shrink-0 border', eventColor(e.kind))}>{eventIcon(e.kind)}</div>
              <div className="flex-1 min-w-0 text-[12px]">
                <div className="text-ink leading-snug">{e.message || eventLabel(e.kind)}</div>
                <div className="text-[10.5px] text-ink-4 mt-0.5">{e.author?.name && `${e.author.name} · `}<span title={formatDateTime(e.createdAt)}>{formatRelative(e.createdAt)}</span></div>
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
    case 'EXTRA_CALL_SET':    return 'bg-danger-bg text-danger border-danger/20';
    case 'STAGE_CHANGED':     return 'bg-gold-pale text-gold border-gold/30';
    case 'MANAGER_CHANGED':   return 'bg-gold-pale text-gold border-gold/30';
    case 'DOCUMENT_TOGGLED':  return 'bg-info-bg text-info border-info/20';
    case 'NOTE_ADDED':        return 'bg-bg text-ink-3 border-line';
    case 'ARCHIVED':          return 'bg-danger-bg text-danger border-danger/20';
    default:                  return 'bg-bg text-ink-3 border-line';
  }
}

function eventIcon(kind: EventKind) {
  switch (kind) {
    case 'PAYMENT_ADDED':
    case 'PAYMENT_REMOVED':   return <span>$</span>;
    case 'FINGERPRINT_SET':   return <CalendarIcon size={11} />;
    case 'EXTRA_CALL_SET':    return <CalendarIcon size={11} />;
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

function Section({ title, count, action, children, tight }: { title: string; count?: number | string; action?: React.ReactNode; children: React.ReactNode; tight?: boolean }) {
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className={cn('flex items-center justify-between gap-3 border-b border-line', tight ? 'px-4 py-2.5' : 'px-5 py-3.5')}>
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold text-ink-2 uppercase tracking-[0.04em]">{title}</h3>
          {count !== undefined && <span className="text-[11px] px-1.5 py-px rounded bg-bg text-ink-3 font-semibold">{count}</span>}
        </div>
        {action}
      </div>
      <div className={cn(tight ? 'p-3.5' : 'p-4 md:p-5')}>{children}</div>
    </div>
  );
}

function Field2Cols({ rows }: { rows: Array<Array<{ label: string; value: React.ReactNode }>> }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-px bg-line-2 -mx-4 md:-mx-5 -my-1">
      {rows.flat().map((cell, i) => (
        <div key={i} className="bg-paper px-4 md:px-5 py-2.5">
          <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-0.5">{cell.label}</div>
          <div className="text-[13px] text-ink font-medium">
            {cell.value === null || cell.value === undefined || cell.value === '' ? <span className="text-ink-4 font-normal">—</span> : cell.value}
          </div>
        </div>
      ))}
    </div>
  );
}

function FieldFull({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="-mx-4 md:-mx-5 -mb-1 mt-px bg-line-2">
      <div className="bg-paper px-4 md:px-5 py-2.5">
        <div className="text-[10.5px] text-ink-4 font-semibold uppercase tracking-[0.05em] mb-0.5">{label}</div>
        <div className="text-[13px] text-ink">{value || <span className="text-ink-4">не указано</span>}</div>
      </div>
    </div>
  );
}

function ManagerPill({ name, onClick, clickable }: { name: string; onClick?: () => void; clickable?: boolean }) {
  const Wrapper: React.ElementType = clickable ? 'button' : 'span';
  return (
    <Wrapper type={clickable ? 'button' : undefined} onClick={onClick}
      className={cn('inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full border bg-bg border-line', 'text-[11.5px] text-ink-2',
        clickable && 'hover:bg-paper hover:border-ink-5 cursor-pointer')}>
      <Avatar name={name} size="xs" variant="navy" />{name}
    </Wrapper>
  );
}
