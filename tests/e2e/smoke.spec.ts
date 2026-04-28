// E2E smoke: проверяет что все основные страницы открываются без падений.
// Не тестирует логику — только что нет белого экрана, JS-ошибок и 5xx.
//
// Стратегия: один adminPage fixture (логин один раз через Anna),
// последовательно ходим по списку URL. Для каждой страницы:
//  1. HTTP < 500
//  2. URL не уехал на /login (значит auth/role не отбросил)
//  3. body содержит хоть какой-то текст (не белый экран)
//  4. Нет uncaught JS exceptions (page error)
//  5. Нет console.error кроме известного шума (favicon 404, hydration на dev и т.д.)
//
// Если какая-то страница падает — тест точечно покажет где, по имени роута.
import { test, expect } from './fixtures';

interface SmokeRoute {
  url:      string;
  name:     string;
  /** Минимальный селектор который должен быть на странице (опционально). */
  expect?:  string;
}

// Все основные страницы приложения. Список синхронизирован с src/app/(app)/*.
const ROUTES: SmokeRoute[] = [
  { url: '/dashboard',                  name: 'Дашборд' },
  { url: '/clients',                    name: 'Клиенты — список' },
  { url: '/funnel',                     name: 'Воронка' },
  { url: '/inbox',                      name: 'Inbox (чаты)' },
  { url: '/calendar',                   name: 'Календарь событий' },
  { url: '/work-calendar',              name: 'Рабочий календарь' },
  { url: '/payments',                   name: 'Платежи' },
  { url: '/finance',                    name: 'Финансы (расходы/зарплаты)' },
  { url: '/tasks',                      name: 'Задачи' },
  { url: '/team-chat',                  name: 'Team-chat' },
  { url: '/stats',                      name: 'Статистика' },
  { url: '/calls',                      name: 'Звонки' },
  { url: '/birthdays',                  name: 'Дни рождения' },
  { url: '/automations',                name: 'Автоматизации' },
  // Settings sub-routes
  { url: '/settings',                   name: 'Settings — индекс' },
  { url: '/settings/team',              name: 'Settings — команда' },
  { url: '/settings/channels',          name: 'Settings — каналы (WhatsApp)' },
  { url: '/settings/funnels',           name: 'Settings — воронки' },
  { url: '/settings/blueprints',        name: 'Settings — шаблоны документов' },
  { url: '/settings/chat-templates',    name: 'Settings — шаблоны сообщений' },
  { url: '/settings/profile',           name: 'Settings — профиль' },
  { url: '/settings/audit',             name: 'Settings — журнал аудита' },
];

// Известный шум из консоли который НЕ говорит о реальной поломке.
// Расширяй список если появятся новые false positive.
const IGNORED_CONSOLE_PATTERNS = [
  /Failed to load resource.*favicon/i,        // отсутствующий favicon
  /Hydration/i,                                // dev-time hydration warnings (в prod не появляются)
  /DevTools/i,                                 // React DevTools подсказка
  /Download the React DevTools/i,
  /NEXT_REDIRECT/i,                            // нормальный механизм навигации Next.js
  /\/api\/notifications\/list/i,               // poll может фейлиться на чистом сиде — не критично для smoke
  /\/api\/cron\//i,                            // cron-эндпоинты не должны дёргаться из браузера, но фильтруем шум
];

function isIgnored(text: string): boolean {
  return IGNORED_CONSOLE_PATTERNS.some((re) => re.test(text));
}

for (const route of ROUTES) {
  test(`smoke: ${route.name} (${route.url})`, async ({ adminPage }) => {
    const consoleErrors: string[] = [];
    const pageErrors:    string[] = [];

    adminPage.on('console', (msg) => {
      if (msg.type() === 'error' && !isIgnored(msg.text())) {
        consoleErrors.push(msg.text());
      }
    });
    adminPage.on('pageerror', (err) => {
      pageErrors.push(`${err.name}: ${err.message}`);
    });

    // 1. HTTP — не 5xx
    const response = await adminPage.goto(route.url, { waitUntil: 'domcontentloaded' });
    expect(response, `${route.url} вернул null response`).not.toBeNull();
    expect(response!.status(), `${route.url} вернул ${response!.status()}`).toBeLessThan(500);

    // 2. Дожидаемся пока React смонтирует основной контент (или таймаут — это уже косяк)
    await adminPage.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {
      // network idle может не наступить если есть polling — это ОК для smoke
    });

    // 3. Не уехали на /login (значит сессия валидна и роль admin покрыла страницу)
    expect(adminPage.url(), `${route.url} редиректнул на login`).not.toMatch(/\/login/);

    // 4. body содержит реальный контент
    const bodyText = await adminPage.locator('body').textContent();
    expect(
      (bodyText ?? '').trim().length,
      `${route.url} — body почти пустой (белый экран?)`,
    ).toBeGreaterThan(50);

    // 5. Опциональный селектор — если задан, должен быть на странице
    if (route.expect) {
      await expect(adminPage.locator(route.expect).first()).toBeVisible({ timeout: 5_000 });
    }

    // 6. Нет uncaught JS exceptions — самое важное!
    expect(pageErrors, `Uncaught errors на ${route.url}`).toEqual([]);

    // 7. Нет console.error (после фильтра шума)
    expect(consoleErrors, `Console errors на ${route.url}`).toEqual([]);
  });
}

// Дополнительный тест: навигация по сайдбару работает.
// Кликаем по каждой основной ссылке в навигации и проверяем что URL поменялся
// и контент новый. Это ловит случаи когда ссылка ведёт на 404 или сломан Link.
test('smoke: навигация по сайдбару работает', async ({ adminPage }) => {
  await adminPage.goto('/dashboard');

  // Названия пунктов сайдбара — берём из реального layout-а
  const navLinks = [
    { label: /воронка/i,         expectUrl: /\/funnel/      },
    { label: /клиенты/i,         expectUrl: /\/clients/     },
    { label: /задачи/i,          expectUrl: /\/tasks/       },
    { label: /платежи/i,         expectUrl: /\/payments/    },
    { label: /календар/i,        expectUrl: /\/calendar/    },
  ];

  for (const link of navLinks) {
    // role=link с матчем по тексту — наиболее надёжно для Next Link
    const linkEl = adminPage.getByRole('link', { name: link.label }).first();
    if (await linkEl.count() === 0) continue; // пункт может отсутствовать в зависимости от роли — пропускаем

    await linkEl.click();
    await adminPage.waitForURL(link.expectUrl, { timeout: 10_000 });
    // body не пустой после перехода
    const len = ((await adminPage.locator('body').textContent()) ?? '').trim().length;
    expect(len, `после перехода по ${link.label} body пустой`).toBeGreaterThan(50);
  }
});
