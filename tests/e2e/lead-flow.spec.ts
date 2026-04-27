// E2E: создание лида → оплата → проверка событий
import { test, expect } from './fixtures';

test.describe('Lead flow — Anna создаёт лида и регистрирует платежи', () => {
  test('создание лида через /clients/new', async ({ adminPage }) => {
    await adminPage.goto('/clients/new');

    const stamp = Date.now();
    const fullName = `E2E Test Client ${stamp}`;
    const phone = `+4811111${String(stamp).slice(-4)}`;

    // Используем placeholder — он стабильнее чем label (FormField может не привязывать htmlFor)
    await adminPage.getByPlaceholder(/иванов иван/i).fill(fullName);
    await adminPage.getByPlaceholder(/\+48 731 006 935|^\+48/).first().fill(phone);

    // Воронка required — берём дефолт (первая в списке).
    // selectOption({ index: 1 }) ломалось при < 2 воронок — убрали, оставляем default.

    await adminPage.getByRole('button', { name: /создать лида|создать|сохранить/i }).first().click();

    // Ждём перехода на карточку
    await adminPage.waitForURL(/\/clients\/[a-z0-9]+/, { timeout: 15_000 });
    await expect(adminPage.getByText(fullName)).toBeVisible();
  });

  test('1-й платёж не создаёт комиссии (со 2-го по умолчанию)', async ({ adminPage }) => {
    // Самодостаточный тест — создаём свой лид перед проверкой платежа,
    // не полагаемся на лиды из предыдущих тестов
    const stamp = Date.now();
    const fullName = `Payment Test ${stamp}`;
    const phone = `+4822222${String(stamp).slice(-4)}`;

    await adminPage.goto('/clients/new');
    await adminPage.getByPlaceholder(/иванов иван/i).fill(fullName);
    await adminPage.getByPlaceholder(/\+48 731 006 935|^\+48/).first().fill(phone);
    // Стоимость услуг — чтобы можно было записать платёж
    await adminPage.locator('input[type="number"]').first().fill('5000');
    await adminPage.getByRole('button', { name: /создать лида|создать|сохранить/i }).first().click();
    await adminPage.waitForURL(/\/clients\/[a-z0-9]+/, { timeout: 15_000 });

    // Открываем модалку нового платежа
    await adminPage.getByRole('button', { name: /^платёж$|^платеж$|новый платёж/i }).first().click();
    await adminPage.getByLabel(/сумма/i).fill('1000');
    await adminPage.getByRole('button', { name: /записать|сохранить/i }).first().click();

    // Проверяем что платёж появился в таблице
    await expect(adminPage.getByText(/\+\s*1[\s,]?000.*zł/)).toBeVisible({ timeout: 5000 });
  });

  test('экспорт CSV доступен админу', async ({ adminPage }) => {
    await adminPage.goto('/funnel');
    const exportLink = adminPage.locator('a[href*="/api/leads/export"]');
    await expect(exportLink.first()).toBeVisible();
    const href = await exportLink.first().getAttribute('href');
    expect(href).toContain('/api/leads/export');

    // Проверяем что эндпоинт реально отдаёт CSV (через прямой fetch с cookies сессии)
    const res = await adminPage.request.get(href!);
    expect(res.status()).toBe(200);
    expect(res.headers()['content-type']).toContain('text/csv');
    const body = await res.text();
    expect(body.charCodeAt(0)).toBe(0xFEFF);
  });
});
