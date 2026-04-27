'use client';

import { useState, useTransition, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Save, X, User, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input, Textarea, Select, FormField } from '@/components/ui/input';
import { createLead } from '../../actions';
import type { UserRole } from '@prisma/client';

interface NewLeadFormProps {
  currentUser: { id: string; role: UserRole; name: string };
  funnels: Array<{
    id: string;
    name: string;
    stages: Array<{ id: string; name: string; position: number }>;
  }>;
  cities: Array<{ id: string; name: string }>;
  team: Array<{ id: string; name: string; email: string; role: UserRole }>;
  waAccounts: Array<{ id: string; label: string; phoneNumber: string }>;
  defaults: {
    funnelId: string;
    stageId?: string;
    phone?:   string;
  };
  existingClient: {
    id: string;
    fullName: string;
    birthDate: string | null;
    nationality: string | null;
    phone: string;
    email: string | null;
    addressPL: string | null;
    addressHome: string | null;
    cityId: string | null;
  } | null;
}

export function NewLeadForm({
  currentUser, funnels, cities, team, waAccounts, defaults, existingClient,
}: NewLeadFormProps) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Клиент
  const [fullName,    setFullName]    = useState(existingClient?.fullName ?? '');
  const [phone,       setPhone]       = useState(existingClient?.phone ?? defaults.phone ?? '');
  const [email,       setEmail]       = useState(existingClient?.email ?? '');
  const [birthDate,   setBirthDate]   = useState(existingClient?.birthDate ?? '');
  const [nationality, setNationality] = useState(existingClient?.nationality ?? '');
  const [addressPL,   setAddressPL]   = useState(existingClient?.addressPL ?? '');
  const [addressHome, setAddressHome] = useState(existingClient?.addressHome ?? '');

  // Сделка
  const [funnelId,       setFunnelId]       = useState(defaults.funnelId);
  const [stageId,        setStageId]        = useState(defaults.stageId ?? '');
  const [cityId,         setCityId]         = useState(existingClient?.cityId ?? '');
  const [waAccountId,    setWaAccountId]    = useState('');
  const [salesId,        setSalesId]        = useState(currentUser.role === 'SALES' ? currentUser.id : '');
  const [legalId,        setLegalId]        = useState('');
  const [totalAmount,    setTotalAmount]    = useState('');
  const [source,         setSource]         = useState('');
  const [summary,        setSummary]        = useState('');

  const currentFunnel = funnels.find((f) => f.id === funnelId);
  const stages = currentFunnel?.stages ?? [];

  // Если выбрали воронку — обновим этап на первый
  function onFunnelChange(id: string) {
    setFunnelId(id);
    const f = funnels.find((x) => x.id === id);
    setStageId(f?.stages[0]?.id ?? '');
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);

    try {
      const result = await createLead({
        clientId:      existingClient?.id,
        fullName:      existingClient ? undefined : fullName,
        phone:         existingClient ? undefined : phone,
        email:         email || undefined,
        birthDate:     birthDate || undefined,
        nationality:   nationality || undefined,
        addressPL:     addressPL || undefined,
        addressHome:   addressHome || undefined,
        funnelId,
        stageId:       stageId || undefined,
        cityId:        cityId || undefined,
        whatsappAccountId: waAccountId || undefined,
        salesManagerId: salesId || undefined,
        legalManagerId: legalId || undefined,
        totalAmount:   Number(totalAmount) || 0,
        source:        source || undefined,
        summary:       summary || undefined,
      });

      startTransition(() => {
        router.push(`/clients/${result.id}`);
      });
    } catch (e) {
      console.error(e);
      setError((e as Error).message || 'Не удалось создать лида');
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {/* Клиент */}
      <Card title={existingClient ? 'Существующий клиент' : 'Клиент'} icon={<User size={14} />}>
        {existingClient ? (
          <div className="bg-bg rounded-md p-3 text-[13px]">
            <div className="font-semibold text-ink">{existingClient.fullName}</div>
            <div className="text-ink-3 text-[12px] mt-0.5">
              {existingClient.phone} {existingClient.email ? `· ${existingClient.email}` : ''}
            </div>
            <div className="text-[11px] text-ink-4 mt-1">
              Новый лид будет добавлен к этому клиенту
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <FormField label="ФИО" required>
              <Input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Иванов Иван Иванович"
                required
                autoFocus
              />
            </FormField>
            <FormField label="Телефон" required hint="Если уже в базе — будет привязка к клиенту">
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+48 731 006 935"
                required
              />
            </FormField>
            <FormField label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </FormField>
            <FormField label="Дата рождения">
              <Input type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
            </FormField>
            <FormField label="Национальность">
              <Input value={nationality} onChange={(e) => setNationality(e.target.value)} placeholder="Украина" />
            </FormField>
            <FormField label="Город">
              <Select value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">— не выбрано —</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
            <div className="md:col-span-2">
              <FormField label="Адрес проживания в Польше">
                <Input value={addressPL} onChange={(e) => setAddressPL(e.target.value)} />
              </FormField>
            </div>
            <div className="md:col-span-2">
              <FormField label="Адрес проживания на родине">
                <Input value={addressHome} onChange={(e) => setAddressHome(e.target.value)} />
              </FormField>
            </div>
          </div>
        )}
      </Card>

      {/* Сделка */}
      <Card title="Сделка" icon={<Briefcase size={14} />}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <FormField label="Воронка" required>
            <Select value={funnelId} onChange={(e) => onFunnelChange(e.target.value)} required>
              {funnels.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </FormField>
          <FormField label="Этап">
            <Select value={stageId} onChange={(e) => setStageId(e.target.value)}>
              <option value="">— первый этап —</option>
              {stages.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </FormField>

          {existingClient && (
            <FormField label="Город дела">
              <Select value={cityId} onChange={(e) => setCityId(e.target.value)}>
                <option value="">— не выбрано —</option>
                {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </FormField>
          )}

          <FormField label="Стоимость услуг (zł)">
            <Input
              type="number"
              min="0" step="0.01"
              value={totalAmount}
              onChange={(e) => setTotalAmount(e.target.value)}
              placeholder="0"
            />
          </FormField>

          <FormField label="Менеджер продаж">
            <Select value={salesId} onChange={(e) => setSalesId(e.target.value)}>
              <option value="">— не назначен —</option>
              {team.filter((t) => t.role === 'SALES').map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </FormField>
          <FormField label="Менеджер легализации">
            <Select value={legalId} onChange={(e) => setLegalId(e.target.value)}>
              <option value="">— не назначен —</option>
              {team.filter((t) => t.role === 'LEGAL').map((t) => (
                <option key={t.id} value={t.id}>{t.name}</option>
              ))}
            </Select>
          </FormField>

          <FormField label="Источник">
            <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="WhatsApp, рекомендация..." />
          </FormField>
          <FormField label="Канал WhatsApp">
            <Select value={waAccountId} onChange={(e) => setWaAccountId(e.target.value)}>
              <option value="">— не привязан —</option>
              {waAccounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label} ({a.phoneNumber})</option>
              ))}
            </Select>
          </FormField>

          <div className="md:col-span-2">
            <FormField label="Краткое резюме / описание">
              <Textarea
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={3}
                placeholder="Что нужно клиенту, особенности дела..."
              />
            </FormField>
          </div>
        </div>
      </Card>

      {/* Ошибка */}
      {error && (
        <div className="bg-danger-bg border border-danger/20 text-danger text-[12.5px] px-3 py-2.5 rounded-md flex items-center gap-2">
          <X size={14} className="shrink-0" />
          {error}
        </div>
      )}

      {/* Действия */}
      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" onClick={() => router.back()}>
          Отмена
        </Button>
        <Button type="submit" variant="primary" disabled={busy}>
          <Save size={12} />
          {busy ? 'Создание...' : 'Создать лида'}
        </Button>
      </div>
    </form>
  );
}

function Card({
  title, icon, children,
}: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-paper border border-line rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-line flex items-center gap-2">
        <span className="text-ink-3">{icon}</span>
        <h3 className="text-[13px] font-bold text-ink-2 uppercase tracking-[0.04em]">
          {title}
        </h3>
      </div>
      <div className="p-4 md:p-5">{children}</div>
    </div>
  );
}
