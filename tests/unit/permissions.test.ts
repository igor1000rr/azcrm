// Юнит-тесты прав доступа. Чистая функциональная логика, без БД.
import { describe, it, expect } from 'vitest';
import {
  canViewLead, canEditLead, canTransferLead, canAssignLegalManager,
  canArchiveLead, canDeleteLead, canDeletePayment,
  canManageUsers, canManageSettings, canViewAnalytics, canViewAuditLog,
  canViewFinance, canManageServices, canManageExpenses,
  canMarkCommissionPaid, canEditWorkLog, canViewAllWorkLogs,
  leadVisibilityFilter, clientVisibilityFilter, whatsappAccountFilter,
  assert,
  type SessionUser,
} from '@/lib/permissions';

const admin: SessionUser  = { id: 'u-admin',  email: 'a@a',  name: 'A',  role: 'ADMIN'  };
const sales: SessionUser  = { id: 'u-sales',  email: 's@s',  name: 'S',  role: 'SALES'  };
const sales2: SessionUser = { id: 'u-sales2', email: 's2@s', name: 'S2', role: 'SALES'  };
const legal: SessionUser  = { id: 'u-legal',  email: 'l@l',  name: 'L',  role: 'LEGAL'  };

describe('canViewLead / canEditLead', () => {
  it('admin видит всё', () => {
    expect(canViewLead(admin, { salesManagerId: null, legalManagerId: null })).toBe(true);
    expect(canEditLead(admin, { salesManagerId: 'x', legalManagerId: 'y' })).toBe(true);
  });
  it('sales видит свои лиды', () => {
    expect(canViewLead(sales, { salesManagerId: 'u-sales', legalManagerId: null })).toBe(true);
    expect(canViewLead(sales, { salesManagerId: 'other', legalManagerId: null })).toBe(false);
  });
  it('legal видит свои лиды', () => {
    expect(canViewLead(legal, { salesManagerId: null, legalManagerId: 'u-legal' })).toBe(true);
    expect(canViewLead(legal, { salesManagerId: null, legalManagerId: 'other' })).toBe(false);
  });
  it('sales не видит лида legal-а и наоборот', () => {
    expect(canViewLead(sales, { salesManagerId: 'other', legalManagerId: 'u-legal' })).toBe(false);
    expect(canViewLead(legal, { salesManagerId: 'u-sales', legalManagerId: 'other' })).toBe(false);
  });
});

describe('canTransferLead / canAssignLegalManager', () => {
  it('admin всегда может', () => {
    expect(canTransferLead(admin, { salesManagerId: null })).toBe(true);
    expect(canAssignLegalManager(admin, { salesManagerId: null })).toBe(true);
  });
  it('SALES-владелец может передать другому SALES', () => {
    expect(canTransferLead(sales, { salesManagerId: 'u-sales' })).toBe(true);
  });
  it('SALES не-владелец не может', () => {
    expect(canTransferLead(sales2, { salesManagerId: 'u-sales' })).toBe(false);
  });
  it('LEGAL не может передавать', () => {
    expect(canTransferLead(legal, { salesManagerId: 'u-legal' })).toBe(false);
  });
});

describe('Только ADMIN-операции', () => {
  it.each([
    ['canArchiveLead',         canArchiveLead],
    ['canDeleteLead',          canDeleteLead],
    ['canDeletePayment',       canDeletePayment],
    ['canManageUsers',         canManageUsers],
    ['canManageSettings',      canManageSettings],
    ['canViewAnalytics',       canViewAnalytics],
    ['canViewAuditLog',        canViewAuditLog],
    ['canViewFinance',         canViewFinance],
    ['canManageServices',      canManageServices],
    ['canManageExpenses',      canManageExpenses],
    ['canMarkCommissionPaid',  canMarkCommissionPaid],
    ['canViewAllWorkLogs',     canViewAllWorkLogs],
  ])('%s — только ADMIN', (_, fn) => {
    expect(fn(admin)).toBe(true);
    expect(fn(sales)).toBe(false);
    expect(fn(legal)).toBe(false);
  });
});

describe('canEditWorkLog', () => {
  it('admin может редактировать чьи угодно часы', () => {
    expect(canEditWorkLog(admin, 'u-sales')).toBe(true);
  });
  it('сотрудник может редактировать только свои', () => {
    expect(canEditWorkLog(sales, 'u-sales')).toBe(true);
    expect(canEditWorkLog(sales, 'u-other')).toBe(false);
  });
});

describe('leadVisibilityFilter', () => {
  it('admin: пустой where', () => {
    expect(leadVisibilityFilter(admin)).toEqual({});
  });
  it('менеджер: OR(sales, legal) на свой userId', () => {
    expect(leadVisibilityFilter(sales)).toEqual({
      OR: [{ salesManagerId: 'u-sales' }, { legalManagerId: 'u-sales' }],
    });
  });
});

describe('clientVisibilityFilter', () => {
  it('admin: пустой where', () => {
    expect(clientVisibilityFilter(admin)).toEqual({});
  });
  it('менеджер: видит свои клиенты + клиенты с лидами на нём', () => {
    const f = clientVisibilityFilter(sales);
    expect(f).toHaveProperty('OR');
    expect((f as { OR: unknown[] }).OR.length).toBe(2);
  });
});

describe('whatsappAccountFilter', () => {
  it('admin: всё', () => {
    expect(whatsappAccountFilter(admin)).toEqual({});
  });
  it('менеджер: общие + свои', () => {
    expect(whatsappAccountFilter(sales)).toEqual({
      OR: [{ ownerId: null }, { ownerId: 'u-sales' }],
    });
  });
});

describe('assert', () => {
  it('не бросает при true', () => {
    expect(() => assert(true)).not.toThrow();
  });
  it('бросает 403 при false', () => {
    try {
      assert(false, 'msg');
      expect.fail('должен бросить');
    } catch (e) {
      expect((e as Error).message).toBe('msg');
      expect((e as Error & { statusCode?: number }).statusCode).toBe(403);
    }
  });
});
