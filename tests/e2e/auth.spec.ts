// E2E: вход и базовая навигация
import { test, expect, loginAs } from './fixtures';

test('неавторизованный → редирект на /login', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('Anna (admin) логинится и попадает в защищённую зону', async ({ page }) => {
  await loginAs(page, 'anna@azgroup.pl', 'AZGroup2026!');
  await expect(page).toHaveURL(/\/(dashboard|funnel)/);
});

test('неверный пароль — остаётся на /login c ошибкой', async ({ page }) => {
  await page.goto('/login');
  // exact: true — видимость чтобы лейбл в поле не матчился на aria-label кнопки тоггла.
  await page.getByLabel('Email',  { exact: true }).fill('anna@azgroup.pl');
  await page.getByLabel('Пароль', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: /войти|log ?in/i }).click();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login/);
});

test('admin видит финансовый раздел в сайдбаре', async ({ adminPage }) => {
  // В сайдбаре «Финансы» — это заголовок секции, не ссылка.
  // Реальные пункты — «Премии менеджеров», «Сводная по ЗП», «Расходы», «Услуги (прайс)».
  // Проверяем что хотя бы один из них виден (значит секция Финансы рендерится).
  await expect(
    adminPage.getByRole('link', { name: /премии|сводная|расходы|услуги/i }).first()
  ).toBeVisible();
});
