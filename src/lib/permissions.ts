// Права доступа для AZ Group CRM
import type { UserRole } from '@prisma/client';

export type SessionUser = {
  id:    string;
  email: string;
  name:  string;
  role:  UserRole;
};

export function leadVisibilityFilter(user: SessionUser) {
  if (user.role === 'ADMIN') return {};
  return {
    OR: [
      { salesManagerId: user.id },
      { legalManagerId: user.id },
    ],
  };
}

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

export function canViewLead(
  user: SessionUser,
  lead: { salesManagerId: string | null; legalManagerId: string | null },
): boolean {
  if (user.role === 'ADMIN') return true;
  return lead.salesManagerId === user.id || lead.legalManagerId === user.id;
}

export function canEditLead(
  user: SessionUser,
  lead: { salesManagerId: string | null; legalManagerId: string | null },
): boolean {
  return canViewLead(user, lead);
}

export function canTransferLead(
  user: SessionUser,
  lead: { salesManagerId: string | null },
): boolean {
  if (user.role === 'ADMIN') return true;
  return user.role === 'SALES' && lead.salesManagerId === user.id;
}

export function canAssignLegalManager(
  user: SessionUser,
  lead: { salesManagerId: string | null },
): boolean {
  if (user.role === 'ADMIN') return true;
  return user.role === 'SALES' && lead.salesManagerId === user.id;
}

export function canArchiveLead(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canDeleteLead(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canManageUsers(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canManageSettings(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canViewAnalytics(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canDeletePayment(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function canViewAuditLog(user: SessionUser): boolean {
  return user.role === 'ADMIN';
}

export function whatsappAccountFilter(user: SessionUser) {
  if (user.role === 'ADMIN') return {};
  return {
    OR: [
      { ownerId: null },
      { ownerId: user.id },
    ],
  };
}

export function assert(condition: boolean, message = 'Недостаточно прав') {
  if (!condition) {
    const e = new Error(message);
    (e as Error & { statusCode?: number }).statusCode = 403;
    throw e;
  }
}
