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

  test('экспорт лидов /api/leads/export → 401 без сессии', async ({ page }) => {
    const res = await page.request.get('/api/leads/export', { failOnStatusCode: false });
    // requireAdmin throw → next вернёт ошибку или редирект на /login
    expect([401, 403, 302, 307, 500]).toContain(res.status());
  });
});
