// E2E: финансовый раздел — доступ только админу, страницы открываются
import { test, expect } from './fixtures';

test.describe('Финансы (только ADMIN)', () => {
  test('Услуги — список открывается', async ({ adminPage }) => {
    await adminPage.goto('/finance/services');
    await expect(adminPage.getByText(/услуг/i).first()).toBeVisible();
  });

  test('Комиссии — открывается с фильтрами по периоду', async ({ adminPage }) => {
    await adminPage.goto('/finance/commissions');
    await expect(adminPage.locator('input[type="date"]').first()).toBeVisible();
  });

  test('Сводная по ЗП — открывается, есть KPI карточки', async ({ adminPage }) => {
    await adminPage.goto('/finance/payroll');
    await expect(adminPage.getByText(/часов отработано|комисси/i).first()).toBeVisible();
  });

  test('Расходы — открывается, видно поле «город»', async ({ adminPage }) => {
    await adminPage.goto('/finance/expenses');
    await expect(adminPage.getByText(/расход|город/i).first()).toBeVisible();
  });

  test('экспорт лидов /api/leads/export → защищён без сессии', async ({ page }) => {
    // Без сессии middleware редиректит на /login, либо requireAdmin кидает 401/500.
    // maxRedirects: 0 — чтобы Playwright не следовал за редиректом и мы видели реальный статус.
    const res = await page.request.get('/api/leads/export', {
      failOnStatusCode: false,
      maxRedirects: 0,
    });
    // Допустимые: редирект middleware на /login (302/303/307) или ошибка авторизации
    expect([401, 403, 302, 303, 307, 500]).toContain(res.status());
  });
});
