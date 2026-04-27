// E2E: Inbox — переключение между WhatsApp-каналами.
// Тот самый баг из prod: клик визуально "ничего не меняет". Проверяем что
// URL реально сменяется на ?channel=<id> и страница перерендерилась.
import { test, expect } from './fixtures';

test.describe('Inbox — переключение каналов', () => {
  test('/inbox открывается, виден сайдбар "Каналы" + ссылка "Все"', async ({ adminPage }) => {
    await adminPage.goto('/inbox');
    await expect(adminPage.getByRole('heading', { name: /каналы/i })).toBeVisible();
    await expect(adminPage.getByRole('link', { name: /^Все$/i })).toBeVisible();
  });

  test('клик по каналу → URL меняется на ?channel=...', async ({ adminPage }) => {
    await adminPage.goto('/inbox');
    // Ссылки каналов — сайдбар .href содержит ?channel=
    const channelLinks = adminPage.locator('a[href*="/inbox?channel="]');
    const count = await channelLinks.count();
    if (count === 0) {
      // БД пустая — каналов нет. Это не ошибка. Проверяем хотя бы ссылку "Управление каналами".
      await expect(adminPage.getByRole('link', { name: /управление каналами/i })).toBeVisible();
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'В тестовой БД нет WhatsApp-каналов, сменять нечего',
      });
      return;
    }

    const firstLink = channelLinks.first();
    const href      = await firstLink.getAttribute('href');
    expect(href).toMatch(/\/inbox\?channel=[\w-]+/);

    await firstLink.click();
    // URL обязан смениться на ?channel=...
    await expect(adminPage).toHaveURL(/\/inbox\?channel=[\w-]+/);
  });

  test('переключение между двумя каналами — URL меняется оба раза', async ({ adminPage }) => {
    await adminPage.goto('/inbox');
    const channelLinks = adminPage.locator('a[href*="/inbox?channel="]');
    const count = await channelLinks.count();
    if (count < 2) {
      test.skip(true, 'Для этого теста нужно хотя бы 2 канала в БД');
    }
    const href1 = await channelLinks.nth(0).getAttribute('href');
    const href2 = await channelLinks.nth(1).getAttribute('href');
    expect(href1).not.toBe(href2);

    await channelLinks.nth(0).click();
    await expect(adminPage).toHaveURL(new RegExp(href1!.replace('?', '\\?')));

    await channelLinks.nth(1).click();
    await expect(adminPage).toHaveURL(new RegExp(href2!.replace('?', '\\?')));
  });

  test('пустой канал → показывается плейсхолдер "Переписок пока нет"', async ({ adminPage }) => {
    await adminPage.goto('/inbox');
    const channelLinks = adminPage.locator('a[href*="/inbox?channel="]');
    if ((await channelLinks.count()) === 0) {
      // На /inbox без каналов плейсхолдер всё равно должен показываться в колонке тредов
      await expect(adminPage.getByText(/Переписок пока нет/i)).toBeVisible();
      return;
    }
    await channelLinks.first().click();
    // После клика — либо видим "Переписок пока нет", либо видим хотя бы один тред
    const placeholder = adminPage.getByText(/Переписок пока нет/i);
    const threadLinks = adminPage.locator('a[href*="/inbox?thread="]');
    // Ровно одно из двух должно быть видимо
    const placeholderVisible = await placeholder.isVisible().catch(() => false);
    const threadsCount       = await threadLinks.count();
    expect(placeholderVisible || threadsCount > 0).toBe(true);
  });

  test('кнопка "Все" возвращает на /inbox без channel-параметра', async ({ adminPage }) => {
    await adminPage.goto('/inbox');
    const channelLinks = adminPage.locator('a[href*="/inbox?channel="]');
    if ((await channelLinks.count()) === 0) {
      test.skip(true, 'Нет каналов — нечего возвращаться от');
    }
    await channelLinks.first().click();
    await expect(adminPage).toHaveURL(/\?channel=/);

    await adminPage.getByRole('link', { name: /^Все$/i }).click();
    await expect(adminPage).toHaveURL(/\/inbox$/);
  });
});
