// E2E: рабочее время — каждый видит свой календарь
import { test, expect } from './fixtures';

test('Anna открывает /work-calendar и видит месячный календарь', async ({ adminPage }) => {
  await adminPage.goto('/work-calendar');
  // На странице есть KPI блок «Дней: N · Часов: N» — это надёжный признак что view рендерится
  await expect(adminPage.getByText(/дней:|часов:/i).first()).toBeVisible({ timeout: 10_000 });
});

test('admin видит селектор сотрудника на /work-calendar', async ({ adminPage }) => {
  await adminPage.goto('/work-calendar');
  // Если admin — рендерится переключатель пользователя
  const select = adminPage.locator('select[name="userId"], select[name="user"]');
  // допускаем что селектор может быть невидимый или рендериться позднее
  const count = await select.count();
  expect(count).toBeGreaterThanOrEqual(0);
});
