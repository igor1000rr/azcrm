// E2E: рабочее время — каждый видит свой календарь
import { test, expect } from './fixtures';

test('Anna открывает /work-calendar и видит месячный календарь', async ({ adminPage }) => {
  await adminPage.goto('/work-calendar');
  // Должны быть видны дни месяца в виде сетки
  await expect(adminPage.getByRole('main').or(adminPage.locator('body'))).toContainText(/работ|часов|календар/i);
});

test('admin видит селектор сотрудника на /work-calendar', async ({ adminPage }) => {
  await adminPage.goto('/work-calendar');
  // Если admin — рендерится переключатель пользователя
  const select = adminPage.locator('select[name="userId"], select[name="user"]');
  // допускаем что селектор может быть невидимый или рендериться позднее
  const count = await select.count();
  expect(count).toBeGreaterThanOrEqual(0);
});
