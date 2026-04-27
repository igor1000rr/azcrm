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
  await page.getByLabel(/email|почта/i).fill('anna@azgroup.pl');
  await page.getByLabel(/пароль|password/i).fill('wrong-password');
  await page.getByRole('button', { name: /войти|log ?in/i }).click();
  await page.waitForTimeout(1500);
  await expect(page).toHaveURL(/\/login/);
});

test('admin видит раздел Финансы в сайдбаре', async ({ adminPage }) => {
  // Проверяем что в навигации есть «Финансы»
  await expect(adminPage.getByRole('link', { name: /финанс/i })).toBeVisible();
});
