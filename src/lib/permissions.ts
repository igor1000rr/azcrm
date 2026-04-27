// Права доступа для AZ Group CRM
// Ключевая логика:
//   ADMIN — видит и управляет всем
//   SALES — видит только лиды где он ответственный (salesManagerId == userId)
//           или общие WA-каналы (для чатов)
//   LEGAL — видит только лиды где он ответственный (legalManagerId == userId)
//
// Все операции "опасные" (удаление, передача, изменение прайса) — только ADMIN
// Передачу легализатора может делать менеджер продаж лида.

import type { UserRole } from '@prisma/client';

export type SessionUser = {
  id:    string;
  email: string;
  name:  string;
  role:  UserRole;
};

// ====================== ВИДИМОСТЬ ЛИДОВ ======================

/** Where-условие для Prisma — какие лиды видит пользователь */
export function leadVisibilityFilter(user: SessionUser) {
  if (user.role === 'ADMIN') return {}; // всё

  // Менеджер видит лида если он salesMgr ИЛИ legalMgr на этом лиде
  return {
    OR: [
      { salesManagerId: user.id },
      { legalManagerId: user.id },
    ],
  };
}

/** Where-условие для клиентов — клиент видим если есть видимый лид
 *  ИЛИ если ownerId == userId (он первый завёл клиента) */
export function clientVisibilityFilter(user: SessionUser) {
  if (user.role === 'ADMIN') return {};
  return {
    OR: [
      { ownerId: user.id },
      {
        leads: {
          some: {
            OR: [
              { salesManagerId: user.id },
              { legalManagerId: user.id },
            ],
          },
        },
      },
    ],
  };
}

// ====================== ДЕЙСТВИЯ ======================

/** Может ли пользователь видеть лида? */
export function canViewLead(
  user: SessionUser,
  lead: { salesManagerId: string | null; legalManagerId: string | null },
): boolean {
  if (user.role === 'ADMIN') return true;
  return lead.salesManagerId === user.id || lead.legalManagerId === user.id;
}

/** Может ли пользователь редактировать поля лида? */
export function canEditLead(
  user: SessionUser,
  lead: { salesManagerId: string | null; legalManagerId: string | null },
): boolean {
  return canViewLead(user, lead);
}

/** Может ли передать лида другому менеджеру?
 *  - ADMIN — всегда
 *  - SALES (текущий владелец) — может передать другому менеджеру продаж */
export function canTransferLead(
  user: SessionUser,
  lead: { salesManagerId: string | null },
): boolean {
  if (user.role === 'ADMIN') return true;
  return user.role === 'SALES' && lead.salesManagerId === user.id;
}

/** Может ли назначить/сменить менеджера легализации?
 *  - ADMIN — всегда
 *  - SALES (владелец) — может выбрать/сменить легализатора (кросс-продажи) */
export function canAssignLegalManager(
  user: SessionUser,
  lead: { salesManagerId: string | null },
): boolean {
  if (user.role === 'ADMIN') return true;
  return user.role === 'SALES' && lead.salesManagerId === user.id;
}

/** Архив / удаление — только ADMIN */
export function canArchiveLead(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canDeleteLead(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Управлять пользователями (создавать, деактивировать) — только ADMIN */
export function canManageUsers(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Управлять воронками, этапами, шаблонами — только ADMIN */
export function canManageSettings(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Видеть аналитику — только ADMIN */
export function canViewAnalytics(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Удалять платежи — только ADMIN (изменения денег ответственны) */
export function canDeletePayment(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Аудит-лог — только ADMIN */
export function canViewAuditLog(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

// ====================== ФИНАНСЫ ======================

/** Сводки по финансам, премии всех менеджеров, сводная по ЗП — только ADMIN */
export function canViewFinance(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Управлять услугами / прайсом — только ADMIN */
export function canManageServices(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Расходы (загрузка и просмотр) — только ADMIN */
export function canManageExpenses(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

/** Просматривать СВОИ комиссии может любой, чужие — только ADMIN */
export function canViewOwnCommissions(user: SessionUser): boolean {
  return true; // каждый видит свои
}

/** Помечать выплату комиссии — только ADMIN */
export function canMarkCommissionPaid(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

// ====================== РАБОЧЕЕ ВРЕМЯ ======================

/** Свой WorkLog: создавать / редактировать / удалять — может сам сотрудник или ADMIN */
export function canEditWorkLog(user: SessionUser, ownerId: string): boolean {
  return user.role === 'ADMIN' || user.id === ownerId;
}

/** Видеть чужие WorkLog — только ADMIN */
export function canViewAllWorkLogs(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

// ====================== ВИДИМОСТЬ ЧАТОВ ======================

/**
 * Видимость WhatsApp-каналов:
 *  - ADMIN видит все
 *  - Общий канал (ownerId === null) — видят все
 *  - Личный канал — видит только владелец
 */
export function whatsappAccountFilter(user: SessionUser) {
  if (user.role === 'ADMIN') return {};
  return {
    OR: [
      { ownerId: null },        // общие
      { ownerId: user.id },     // его личный
    ],
  };
}

// ====================== УТИЛИТЫ ======================

/** Бросает 403 если нет прав */
export function assert(condition: boolean, message = 'Недостаточно прав') {
  if (!condition) {
    const e = new Error(message);
    (e as Error & { statusCode?: number }).statusCode = 403;
    throw e;
  }
}
