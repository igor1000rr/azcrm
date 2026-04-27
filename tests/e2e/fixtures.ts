import { test as base, expect, type Page } from '@playwright/test';

/** Логин через UI с указанными credentials. */
export async function loginAs(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/email|почта/i).fill(email);
  await page.getByLabel(/пароль|password/i).fill(password);
  await page.getByRole('button', { name: /войти|log ?in/i }).click();
  await page.waitForURL(/\/(dashboard|funnel|inbox)/, { timeout: 10_000 });
}

/** Test fixture: автоматический логин под Anna (admin). */
export const test = base.extend<{ adminPage: Page }>({
  adminPage: async ({ page }, use) => {
    await loginAs(page, 'anna@azgroup.pl', 'AZGroup2026!');
    await use(page);
  },
});

export { expect };
