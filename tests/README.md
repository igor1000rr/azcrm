# Тесты

Три уровня:

- **unit** (`tests/unit/`) — чистые функции (permissions, расчёт комиссий, parseTime, CSV).
- **integration** (`tests/integration/`) — server actions с замоканным Prisma client.
- **e2e** (`tests/e2e/`) — Playwright против реального запущенного приложения.

## Запуск

```bash
# Юнит + интеграционные (быстро, без БД)
npm run test
npm run test:watch       # режим разработки
npm run test:coverage    # с покрытием в html

# Только e2e (нужно поднятое приложение и БД)
npm run test:e2e
npm run test:e2e:ui      # интерактивно через playwright UI
```

## E2E локально

```bash
# 1. Поднять БД и накатить схему + сид
docker compose up -d db
npm run db:push
npm run db:seed

# 2. Build + start приложения
npm run build
npm start &

# 3. Установить браузеры (один раз)
npx playwright install chromium

# 4. Прогнать e2e
npm run test:e2e
```

Если приложение уже крутится на другом адресе — `E2E_BASE_URL=https://crm.local npm run test:e2e`.

## CI

`.github/workflows/test.yml` гонит на каждый push/PR в main четыре джобы параллельно:

1. **unit** — vitest на unit + integration.
2. **typecheck** — `tsc --noEmit` после `prisma generate`.
3. **lint** — `next lint`.
4. **e2e** — поднимает postgres service, накатывает схему/сид, билдит и стартует приложение, гонит playwright. Артефакт `playwright-report/` сохраняется на 7 дней при упавшем тесте.

## Что покрыто

### Unit
- **permissions** (~25 кейсов): все флаги доступа, видимость лидов/клиентов/WA, `assert`.
- **commission-calc**: `calcCommissionAmount`, `shouldCalcCommission`, `buildCommissionRows` — округление до копеек, пропуск ролей с 0%, отсутствие менеджера.
- **work-hours**: `parseTimeToMinutes`, `calcHours`, `sumHours`.
- **csv**: `escapeCsvField`, `buildCsv` — BOM, точка с запятой, кавычки, переносы.
- **utils**: `formatMoney`, `formatPhone`, `plural`, `daysUntil`.

### Integration (server actions с mock prisma)
- **addPayment**: 1-й платёж без комиссий, 2-й с комиссиями, `startFrom=1` override, нет легализатора, дефолтные 5/5%, событие `PAYMENT_ADDED`, zod-валидация, `Лид не найден`.
- **upsertWorkLog/deleteWorkLog**: записать себе ОК; чужие — 403; admin может всем; конец до начала — ошибка.
- **markCommissionPaidOut/bulkMarkPaidOut**: статус выплаты + audit, не-admin → 403.
- **GET /api/leads/export**: права, формат CSV (BOM, escape `;`), фильтры `funnel`/`city`/`archived`.

### E2E (Playwright против запущенного приложения)
- **auth**: редирект неавторизованного, успешный логин Anna, неверный пароль, видимость пунктов меню по роли.
- **lead-flow**: создание лида через UI, добавление платежа, эндпоинт экспорта CSV возвращает 200 с BOM.
- **finance**: страницы `/finance/services|commissions|payroll|expenses` открываются админом, `/api/leads/export` без сессии → 401/403/redirect.
- **work-calendar**: `/work-calendar` рендерится, у админа есть селектор сотрудника.

## Расширение

Новые server actions покрываем по схеме `tests/integration/<action>.test.ts`:

```ts
const mockDb = { entityName: { method: vi.fn() } };
vi.mock('@/lib/db', () => ({ db: mockDb }));
vi.mock('@/lib/auth', () => ({ requireUser: vi.fn(async () => sessionUser) }));
const { yourAction } = await import('@/app/(app)/path/actions');
```

В unit-тестах не дёргаем БД — выносим логику в `src/lib/finance/*.ts` и тестируем чисто.
