// E2E smoke: проверяет что все основные страницы открываются без КРАША.
// Не тестирует логику — ловит белые экраны, JS-крэши и 5xx.
//
// Что валит smoke:
//  - HTTP >= 500
//  - редирект на /login (auth/role отбросил, страница недоступна)
//  - body содержит <50 символов (вероятно белый экран)
//  - uncaught JS exception (page error) — реальный краш приложения
//  - console.error с критичными паттернами (TypeError, ReferenceError,
//    Cannot read properties) — обычно это баг рендера
//
// Что НЕ валит:
//  - обычные console.error (404 favicon, polling fail, web-push permission и т.д.)
//    — собираются и прикрепляются к отчёту как test info attachment.
//    Так мы видим что в консоли шумит, но не блокируем CI на инфраструктурном шуме.
import { test, expect } from './fixtures';

interface SmokeRoute {
  url:      string;
  name:     string;
  expect?:  string;
}

const ROUTES: SmokeRoute[] = [
  { url: '/dashboard',                  name: 'Дашборд' },
  { url: '/clients',                    name: 'Клиенты — список' },
  { url: '/funnel',                     name: 'Воронка' },
  { url: '/inbox',                      name: 'Inbox (чаты)' },
  { url: '/calendar',                   name: 'Календарь событий' },
  { url: '/work-calendar',              name: 'Рабочий календарь' },
  { url: '/payments',                   name: 'Платежи' },
  { url: '/finance',                    name: 'Финансы' },
  { url: '/tasks',                      name: 'Задачи' },
  { url: '/team-chat',                  name: 'Team-chat' },
  { url: '/stats',                      name: 'Статистика' },
  { url: '/calls',                      name: 'Звонки' },
  { url: '/birthdays',                  name: 'Дни рождения' },
  { url: '/automations',                name: 'Автоматизации' },
  { url: '/settings',                   name: 'Settings — индекс' },
  { url: '/settings/team',              name: 'Settings — команда' },
  { url: '/settings/channels',          name: 'Settings — каналы (WhatsApp)' },
  { url: '/settings/funnels',           name: 'Settings — воронки' },
  { url: '/settings/blueprints',        name: 'Settings — шаблоны документов' },
  { url: '/settings/chat-templates',    name: 'Settings — шаблоны сообщений' },
  { url: '/settings/profile',           name: 'Settings — профиль' },
  { url: '/settings/audit',             name: 'Settings — журнал аудита' },
];

// Паттерны которые в console.error означают РЕАЛЬНЫЙ баг рендера —
// тест на них падает.
const CRITICAL_PATTERNS = [
  /TypeError/i,
  /ReferenceError/i,
  /Cannot read propert(y|ies)/i,
  /is not a function/i,
  /is not defined/i,
  /Maximum update depth exceeded/i,    // infinite re-render
  /Objects are not valid as a React child/i,
  /Each child in a list should have a unique "key"/i,
];

function isCritical(text: string): boolean {
  return CRITICAL_PATTERNS.some((re) => re.test(text));
}

for (const route of ROUTES) {
  test(`smoke: ${route.name} (${route.url})`, async ({ adminPage }, testInfo) => {
    const consoleMessages: string[] = [];
    const pageErrors:      string[] = [];

    adminPage.on('console', (msg) => {
      if (msg.type() === 'error') {
        consoleMessages.push(msg.text());
      }
    });
    adminPage.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}\n${err.stack ?? ''}`);
    });

    // 1. HTTP — не 5xx
    const response = await adminPage.goto(route.url, { waitUntil: 'domcontentloaded' });
    expect(response, `${route.url} вернул null response`).not.toBeNull();
    expect(response!.status(), `${route.url} вернул ${response!.status()}`).toBeLessThan(500);

    // 2. Дать React смонтироваться
    await adminPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      // network idle может не наступить если есть polling — это ОК
    });

    // 3. Не уехали на /login
    expect(adminPage.url(), `${route.url} редиректнул на login`).not.toMatch(/\/login/);

    // 4. body содержит реальный контент
    const bodyText = await adminPage.locator('body').textContent();
    expect(
      (bodyText ?? '').trim().length,
      `${route.url} — body почти пустой (белый экран?)`,
    ).toBeGreaterThan(50);

    // 5. Опциональный селектор
    if (route.expect) {
      await expect(adminPage.locator(route.expect).first()).toBeVisible({ timeout: 5_000 });
    }

    // 6. Прикрепляем console errors как attachment — для диагностики, не fail
    if (consoleMessages.length > 0) {
      await testInfo.attach('console-errors', {
        body: consoleMessages.join('\n---\n'),
        contentType: 'text/plain',
      });
    }

    // 7. Fail на критичные паттерны (это реальные баги рендера)
    const critical = consoleMessages.filter(isCritical);
    expect(
      critical,
      `${route.url} — критичные ошибки в консоли:\n${critical.join('\n---\n')}`,
    ).toEqual([]);

    // 8. Fail на uncaught JS exceptions — самое важное!
    expect(
      pageErrors,
      `${route.url} — uncaught exceptions:\n${pageErrors.join('\n---\n')}`,
    ).toEqual([]);
  });
}

// Доп тест: навигация по сайдбару работает (Link не сломан).
test('smoke: навигация по сайдбару работает', async ({ adminPage }) => {
  await adminPage.goto('/dashboard');

  const navLinks = [
    { label: /воронка/i,         expectUrl: /\/funnel/      },
    { label: /клиенты/i,         expectUrl: /\/clients/     },
    { label: /задачи/i,          expectUrl: /\/tasks/       },
    { label: /платежи/i,         expectUrl: /\/payments/    },
    { label: /календар/i,        expectUrl: /\/calendar/    },
  ];

  for (const link of navLinks) {
    const linkEl = adminPage.getByRole('link', { name: link.label }).first();
    if (await linkEl.count() === 0) continue;

    await linkEl.click();
    await adminPage.waitForURL(link.expectUrl, { timeout: 10_000 });
    const len = ((await adminPage.locator('body').textContent()) ?? '').trim().length;
    expect(len, `после перехода по ${link.label} body пустой`).toBeGreaterThan(50);
  }
});
