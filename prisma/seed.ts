// AZ Group CRM — наполнение начальными данными
// Запуск: npm run db:seed
// Идемпотентный: можно запускать повторно, не дублирует данные
//
// ENV-переключатели:
//   SEED_ADMIN_PASSWORD  — явный пароль для всех seed-юзеров (иначе у каждого
//                          случайный, печатается в конце вывода)
//   E2E_TEST_MODE=1      — НЕ форсировать смену пароля при первом входе
//                          (mustChangePassword=false). Нужно для Playwright,
//                          иначе fixture виснет на редиректе /change-password.

import { PrismaClient, UserRole } from '@prisma/client';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';

const prisma = new PrismaClient();

async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

/**
 * Генерирует случайный пароль для первого входа.
 * Каждый сотрудник получает СВОЙ пароль (печатается в конце вывода seed).
 * После первого входа все обязаны сменить через mustChangePassword=true.
 *
 * Переопределяется через ENV SEED_ADMIN_PASSWORD если нужен один общий
 * (для CI/локальной разработки).
 *
 * 06.05.2026 — пункт #91 аудита: до этого все 8 юзеров получали один
 * общий пароль из generateInitialPassword() — admin'у приходилось его
 * раздавать всем голосом/в Telegram. Если Anna случайно копировала пароль
 * в чат с подрядчиком — уязвимость для всех восьми. Сейчас у каждого свой.
 */
function generatePassword(): string {
  if (process.env.SEED_ADMIN_PASSWORD) return process.env.SEED_ADMIN_PASSWORD;
  // 12 символов без неоднозначных: легко продиктовать, но непредсказуемо
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  return Array.from({ length: 12 }, () =>
    alphabet[crypto.randomInt(0, alphabet.length)],
  ).join('');
}

async function main() {
  console.log('🌱 Засеваем БД...\n');

  // ==================== ПОЛЬЗОВАТЕЛИ ====================
  // По данным от Anna: 1 админ + 4 продаж + 3 легализации = 8 человек
  // Каждому генерируем СВОЙ пароль для первого входа.

  const isE2E = process.env.E2E_TEST_MODE === '1';

  const team = [
    { email: 'anna@azgroup.pl',     name: 'Anna',              role: UserRole.ADMIN },
    { email: 'yuliia.h@azgroup.pl', name: 'Yuliia Hura',       role: UserRole.SALES },
    { email: 'yuliia.k@azgroup.pl', name: 'Yullia Kravchenko', role: UserRole.SALES },
    { email: 'rasim@azgroup.pl',    name: 'Rizayev Rasim',     role: UserRole.SALES },
    { email: 'sales4@azgroup.pl',   name: 'Менеджер продаж 4', role: UserRole.SALES },
    { email: 'semen@azgroup.pl',    name: 'Semen Shevchenko',  role: UserRole.LEGAL },
    { email: 'pavel@azgroup.pl',    name: 'Patia Pavel',       role: UserRole.LEGAL },
    { email: 'legal3@azgroup.pl',   name: 'Менеджер легализации 3', role: UserRole.LEGAL },
  ];

  const users: Record<string, string> = {}; // email → id
  const initialPasswords: Array<{ email: string; password: string; created: boolean }> = [];

  for (const member of team) {
    // upsert делает update без полей если юзер уже есть — пароль не меняем,
    // только при первом создании
    const existing = await prisma.user.findUnique({ where: { email: member.email } });
    if (existing) {
      users[member.email] = existing.id;
      initialPasswords.push({ email: member.email, password: '(уже создан, пароль не менялся)', created: false });
      console.log(`  ↻ Пользователь существует: ${existing.name} (${existing.role})`);
      continue;
    }

    const password = generatePassword();
    const passwordHash = await hashPassword(password);

    const u = await prisma.user.create({
      data: {
        email: member.email,
        passwordHash,
        name: member.name,
        role: member.role,
        isActive: true,
        // Все созданные сидом юзеры обязаны сменить пароль при первом входе (кроме E2E)
        mustChangePassword: !isE2E,
      },
    });
    users[member.email] = u.id;
    initialPasswords.push({ email: member.email, password, created: true });
    console.log(`  ✓ Пользователь: ${u.name} (${u.role})`);
  }

  // ==================== КОНФИГ ЗАРПЛАТЫ ====================
  // 06.05.2026 — пункт #107 аудита: при создании юзера через seed нет
  // дефолтного PayrollConfig. Из-за этого при открытии /finance/payroll
  // сотрудник без записи попадает в раздел «без настройки», и Anna
  // вынуждена кликать «создать конфиг» для каждого вручную.
  //
  // Сейчас создаём PayrollConfig с нулями для каждого сотрудника
  // (если его ещё нет). Anna потом отредактирует ставки/ZUS/PIT
  // через UI на /finance/payroll-config.
  for (const userId of Object.values(users)) {
    const cfg = await prisma.payrollConfig.findUnique({ where: { userId } });
    if (!cfg) {
      await prisma.payrollConfig.create({
        data: {
          userId,
          hourlyRate: 0,
          zus:        0,
          pit:        0,
          notes:      'Создано автоматически через seed. Заполнить через /finance/payroll-config.',
        },
      });
    }
  }
  console.log(`\n  ✓ PayrollConfig: создан для всех ${Object.keys(users).length} сотрудников (нулевые значения по умолчанию)`);

  // ==================== ГОРОДА ====================
  const cities = [
    { name: 'Лодзь',    isDefault: true,  position: 1 },
    { name: 'Катовице', isDefault: false, position: 2 },
    { name: 'Познань',  isDefault: false, position: 3 },
    { name: 'Варшава',  isDefault: false, position: 4 },
    { name: 'Краков',   isDefault: false, position: 5 },
    { name: 'Другие',   isDefault: false, position: 99 },
  ];
  for (const city of cities) {
    await prisma.city.upsert({
      where: { name: city.name },
      update: {},
      create: city,
    });
  }
  console.log(`\n  ✓ Городов: ${cities.length}`);

  // ==================== ВОРОНКИ И ЭТАПЫ ====================
  const defaultStages = [
    { name: 'Новый',          color: '#2563EB', position: 1, isFinal: false, isLost: false },
    { name: 'Подан',          color: '#0A1A35', position: 2, isFinal: false, isLost: false },
    { name: 'Ждём отпечатки', color: '#CA8A04', position: 3, isFinal: false, isLost: false },
    { name: 'Доп. вызвание',  color: '#DC2626', position: 4, isFinal: false, isLost: false },
    { name: 'Децизия',        color: '#16A34A', position: 5, isFinal: true,  isLost: false },
    { name: 'Отказ',          color: '#71717A', position: 6, isFinal: true,  isLost: true  },
  ];

  const funnelDefs = [
    {
      name: 'Karta pobytu (praca)',
      description: 'Карта побыту на основании работы',
      color: '#0A1A35',
      position: 1,
      docs: [
        'Загранпаспорт',
        'Внутренний паспорт',
        'Трудовой договор (umowa o pracę)',
        'Справка о регистрации (zameldowanie)',
        'Фотографии 3.5×4.5 (4 шт.)',
        'Договор аренды жилья',
        'Справка о несудимости',
        'Заявление на карту (wniosek)',
        'Załącznik nr 1 (от работодателя)',
      ],
    },
    {
      name: 'Karta pobytu (inne)',
      description: 'Карта побыту по иным основаниям (резидент / сталый / семья)',
      color: '#7C3AED',
      position: 2,
      docs: [
        'Загранпаспорт',
        'Внутренний паспорт',
        'Документ-основание',
        'Справка о регистрации',
        'Фотографии 3.5×4.5 (4 шт.)',
        'Подтверждение проживания',
        'Справка о доходах',
        'Заявление на карту',
      ],
    },
    {
      name: 'Смена децизии',
      description: 'Обжалование негативной децизии',
      color: '#DC2626',
      position: 3,
      docs: [
        'Текст децизии',
        'Доверенность на представление',
        'Дополнительные документы',
        'Объяснительная клиента',
      ],
    },
    {
      name: 'Консультация',
      description: 'Платная консультация',
      color: '#16A34A',
      position: 4,
      docs: [],
    },
    {
      name: 'Открытие бизнеса',
      description: 'Регистрация JDG / Sp. z o.o.',
      color: '#CA8A04',
      position: 5,
      docs: [
        'Загранпаспорт',
        'Карта побыту / виза',
        'Адрес регистрации фирмы',
        'PESEL',
        'Заявление CEIDG / KRS',
      ],
    },
  ];

  const funnelByName: Record<string, string> = {};
  for (const fd of funnelDefs) {
    let f = await prisma.funnel.findFirst({ where: { name: fd.name } });
    if (!f) {
      f = await prisma.funnel.create({
        data: {
          name: fd.name,
          description: fd.description,
          color: fd.color,
          position: fd.position,
        },
      });
    }
    funnelByName[fd.name] = f.id;

    // Этапы
    for (const st of defaultStages) {
      await prisma.stage.upsert({
        where: { funnelId_position: { funnelId: f.id, position: st.position } },
        update: { name: st.name, color: st.color, isFinal: st.isFinal, isLost: st.isLost },
        create: { ...st, funnelId: f.id },
      });
    }

    // Шаблоны документов по воронке (legacy fallback)
    for (let i = 0; i < fd.docs.length; i++) {
      const docName = fd.docs[i];
      const exists = await prisma.documentTemplate.findFirst({
        where: { funnelId: f.id, name: docName, serviceId: null },
      });
      if (!exists) {
        await prisma.documentTemplate.create({
          data: { funnelId: f.id, name: docName, position: i + 1, isRequired: true },
        });
      }
    }

    console.log(`  ✓ Воронка: ${f.name} (${defaultStages.length} этапов, ${fd.docs.length} док.)`);
  }

  // ==================== WHATSAPP АККАУНТЫ ====================
  const waAccounts = [
    {
      phoneNumber: '+48731006935',
      label: 'Общий',
      ownerEmail: null,
    },
    {
      phoneNumber: '+48731006203',
      label: 'Yuliia Hura',
      ownerEmail: 'yuliia.h@azgroup.pl',
    },
  ];

  for (const wa of waAccounts) {
    const existing = await prisma.whatsappAccount.findUnique({
      where: { phoneNumber: wa.phoneNumber },
    });
    if (!existing) {
      await prisma.whatsappAccount.create({
        data: {
          phoneNumber: wa.phoneNumber,
          label: wa.label,
          ownerId: wa.ownerEmail ? users[wa.ownerEmail] : null,
          isConnected: false,
          isActive: true,
        },
      });
      console.log(`  ✓ WhatsApp: ${wa.label} (${wa.phoneNumber})`);
    }
  }

  // ==================== ШАБЛОНЫ СООБЩЕНИЙ ====================
  const chatTemplates = [
    {
      name: 'Приветствие',
      category: 'приветствия',
      body:
        'Здравствуйте, {client.fullName}! Меня зовут {user.name}, я представляю юридическую фирму AZ Group. ' +
        'Спасибо за обращение. Чем можем помочь?',
    },
    {
      name: 'Список документов на karta pracy',
      category: 'документы',
      body:
        'Для подачи на karta pobytu (praca) вам потребуется:\n' +
        '— Загранпаспорт\n— Внутренний паспорт\n— Трудовой договор (umowa o pracę)\n' +
        '— Справка о регистрации (zameldowanie)\n— 4 фотографии 3.5×4.5\n' +
        '— Договор аренды\n— Справка о несудимости',
    },
    {
      name: 'Напоминание об отпечатках (за 7 дней)',
      category: 'напоминания',
      body:
        'Здравствуйте, {client.fullName}! Напоминаем, что через неделю — {lead.fingerprintDate} в {lead.fingerprintTime} ' +
        'у вас назначены отпечатки в {lead.fingerprintLocation}. Возьмите оригинал паспорта и заявление.',
    },
    {
      name: 'Напоминание об отпечатках (за 1 день)',
      category: 'напоминания',
      body:
        '{client.fullName}, добрый день! Завтра в {lead.fingerprintTime} — отпечатки в {lead.fingerprintLocation}. ' +
        'Не забудьте оригинал паспорта и распечатанное заявление. Хорошего дня!',
    },
    {
      name: 'Благодарность за оплату',
      category: 'оплата',
      body:
        '{client.fullName}, спасибо за оплату! Платёж получен. Продолжаем работу по вашему делу.',
    },
    {
      name: 'Напоминание о долге',
      category: 'оплата',
      body:
        '{client.fullName}, добрый день! Напоминаем об остатке оплаты в размере {lead.debt} zł. ' +
        'Просим закрыть задолженность в течение 3 дней.',
    },
  ];

  for (const t of chatTemplates) {
    const exists = await prisma.chatTemplate.findFirst({ where: { name: t.name } });
    if (!exists) {
      await prisma.chatTemplate.create({ data: t });
      console.log(`  ✓ Шаблон: ${t.name}`);
    }
  }

  // ==================== УСЛУГИ (прайс-лист) ====================
  const services = [
    { name: 'Karta pobytu (praca)', basePrice: 1500, salesPct: 5,  legalPct: 5, pos: 1, funnelName: 'Karta pobytu (praca)' },
    { name: 'Karta pobytu (inne)',  basePrice: 1500, salesPct: 5,  legalPct: 5, pos: 2, funnelName: 'Karta pobytu (inne)' },
    { name: 'Смена децизии',        basePrice: 1200, salesPct: 5,  legalPct: 5, pos: 3, funnelName: 'Смена децизии' },
    { name: 'Консультация',         basePrice: 200,  salesPct: 10, legalPct: 0, pos: 4, funnelName: 'Консультация' },
    { name: 'Открытие бизнеса',     basePrice: 3000, salesPct: 5,  legalPct: 5, pos: 5, funnelName: 'Открытие бизнеса' },
  ];

  const serviceByName: Record<string, string> = {};
  for (const s of services) {
    const existing = await prisma.service.findUnique({ where: { name: s.name } });
    if (existing) {
      serviceByName[s.name] = existing.id;
      continue;
    }
    const created = await prisma.service.create({
      data: {
        name: s.name,
        basePrice: s.basePrice,
        salesCommissionPercent: s.salesPct,
        legalCommissionPercent: s.legalPct,
        position: s.pos,
        funnelId: funnelByName[s.funnelName] ?? null,
        isActive: true,
      },
    });
    serviceByName[s.name] = created.id;
    console.log(`  ✓ Услуга: ${s.name} — ${s.basePrice} zł (sales ${s.salesPct}%, legal ${s.legalPct}%)`);
  }

  // ==================== ШАБЛОНЫ ЧЕК-ЛИСТА ПО УСЛУГАМ ====================
  const docTemplatesByService: Record<string, string[]> = {
    'Karta pobytu (praca)': [
      'Загранпаспорт',
      'Внутренний паспорт',
      'Трудовой договор (umowa o pracę)',
      'Справка о регистрации (zameldowanie)',
      'Фотографии 3.5×4.5 (4 шт.)',
      'Договор аренды жилья',
      'Справка о несудимости',
      'Заявление на карту (wniosek)',
      'Załącznik nr 1 (от работодателя)',
    ],
    'Karta pobytu (inne)': [
      'Загранпаспорт',
      'Внутренний паспорт',
      'Документ-основание (резидент/сталый/брак)',
      'Справка о регистрации',
      'Фотографии 3.5×4.5 (4 шт.)',
      'Подтверждение проживания',
      'Справка о доходах',
      'Заявление на карту',
    ],
    'Смена децизии': [
      'Текст отказной децизии',
      'Доверенность на представление',
      'Дополнительные документы',
      'Объяснительная клиента',
      'Апелляция (odwołanie)',
    ],
    'Консультация': [],
    'Открытие бизнеса': [
      'Загранпаспорт',
      'Карта побыту / виза',
      'Адрес регистрации фирмы',
      'PESEL',
      'Заявление CEIDG / KRS',
      'Проект устава (для Sp. z o.o.)',
    ],
  };

  for (const [serviceName, docs] of Object.entries(docTemplatesByService)) {
    const serviceId = serviceByName[serviceName];
    if (!serviceId) continue;
    for (let i = 0; i < docs.length; i++) {
      const docName = docs[i];
      const exists = await prisma.documentTemplate.findFirst({
        where: { serviceId, name: docName },
      });
      if (!exists) {
        await prisma.documentTemplate.create({
          data: { serviceId, name: docName, position: i + 1, isRequired: true },
        });
      }
    }
  }
  console.log(`\n  ✓ Шаблоны чек-листа привязаны к услугам`);

  // ==================== АВТОМАТИЗАЦИИ ====================
  const automations = [
    {
      name: 'Новое сообщение в WhatsApp → создать лида',
      trigger: 'NEW_WA_MESSAGE_FROM_UNKNOWN',
      action: 'CREATE_LEAD',
      actionParams: { autoAssignByChannel: true },
      isActive: true,
    },
    {
      name: 'Новое сообщение в Telegram → создать лида',
      trigger: 'NEW_TG_MESSAGE_FROM_UNKNOWN',
      action: 'CREATE_LEAD',
      actionParams: {},
      isActive: true,
    },
    {
      name: 'Входящий звонок с неизвестного номера → создать лида',
      trigger: 'INCOMING_CALL_FROM_UNKNOWN',
      action: 'CREATE_LEAD',
      actionParams: {},
      isActive: true,
    },
    {
      name: 'Этап "Ждём отпечатки" → событие в Google Calendar',
      trigger: 'STAGE_CHANGED',
      triggerParams: { toStageName: 'Ждём отпечатки' },
      action: 'CREATE_GOOGLE_CALENDAR_EVENT',
      actionParams: {},
      isActive: true,
    },
    {
      name: 'Дата отпечатков назначена → шаблон в WhatsApp',
      trigger: 'FINGERPRINT_SET',
      action: 'SEND_WA_TEMPLATE',
      actionParams: { templateName: 'Напоминание об отпечатках (за 7 дней)' },
      isActive: true,
    },
    {
      name: 'За 7 дней до отпечатков → напоминание',
      trigger: 'FINGERPRINT_REMINDER_7D',
      action: 'SEND_WA_TEMPLATE',
      actionParams: { templateName: 'Напоминание об отпечатках (за 7 дней)' },
      isActive: true,
    },
    {
      name: 'За 1 день до отпечатков → напоминание',
      trigger: 'FINGERPRINT_REMINDER_1D',
      action: 'SEND_WA_TEMPLATE',
      actionParams: { templateName: 'Напоминание об отпечатках (за 1 день)' },
      isActive: true,
    },
    {
      name: 'Платёж получен → благодарность клиенту',
      trigger: 'PAYMENT_RECEIVED',
      action: 'SEND_WA_TEMPLATE',
      actionParams: { templateName: 'Благодарность за оплату' },
      isActive: false,
    },
    {
      name: 'Долг просрочен 3+ дней → задача менеджеру + напоминание',
      trigger: 'DEBT_OVERDUE',
      triggerParams: { days: 3 },
      action: 'CREATE_TASK_AND_SEND_TEMPLATE',
      actionParams: { templateName: 'Напоминание о долге' },
      isActive: true,
    },
  ];

  for (const a of automations) {
    const exists = await prisma.automation.findFirst({ where: { name: a.name } });
    if (!exists) {
      await prisma.automation.create({ data: a });
      console.log(`  ✓ Автоматизация: ${a.name}`);
    }
  }

  // ==================== НАСТРОЙКИ ====================
  const settings = [
    { key: 'company.name',     value: 'AZ Group' },
    { key: 'company.fullName', value: 'AZ Group — Migration Office' },
    { key: 'currency',         value: 'PLN' },
    { key: 'currency.symbol',  value: 'zł' },
    { key: 'reminders.fingerprint.days', value: [7, 1] },
    { key: 'leads.assignByWhatsappNumber', value: true },
    { key: 'leads.deduplicateByPhone', value: true },
    { key: 'commission.startFromPaymentNumber', value: 2 },
  ];

  for (const s of settings) {
    await prisma.setting.upsert({
      where: { key: s.key },
      update: { value: s.value as never },
      create: { key: s.key, value: s.value as never },
    });
  }
  console.log(`\n  ✓ Настроек: ${settings.length}`);

  console.log('\n✅ Готово!');
  console.log('\n=========================================================');
  console.log('  ПАРОЛИ ДЛЯ ПЕРВОГО ВХОДА (#91 аудита):');
  console.log('  Каждому сотруднику — свой случайный пароль.');
  console.log('  При первом входе — ОБЯЗАТЕЛЬНАЯ смена через mustChangePassword.');
  console.log('---------------------------------------------------------');
  for (const p of initialPasswords) {
    if (p.created) {
      console.log(`  ${p.email.padEnd(28)} ${p.password}`);
    } else {
      console.log(`  ${p.email.padEnd(28)} ${p.password}`);
    }
  }
  if (isE2E) {
    console.log('---------------------------------------------------------');
    console.log('  E2E_TEST_MODE=1 → mustChangePassword=false (для Playwright)');
  }
  console.log('=========================================================');
  console.log('  ВАЖНО: эти пароли больше нигде не сохраняются.');
  console.log('  Скопируйте их СЕЙЧАС и раздайте сотрудникам ЛИЧНО.');
  console.log('=========================================================\n');
}

main()
  .catch((e) => {
    console.error('❌ Ошибка засева:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
