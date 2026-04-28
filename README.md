// AZ Group CRM — миграционная юридическая фирма в Польше

# AZ Group CRM

Система управления лидами для юридической фирмы. Стек: Next.js 15, React 19, PostgreSQL 16, Prisma, NextAuth v5, OnlyOffice, Google Calendar, WhatsApp Web, Telegram Bot API, OpenRouter (AI автоподсказки).

## Развёртывание (production VPS)

```bash
bash deploy/setup.sh
```

Скрипт установит Node.js, PostgreSQL, Docker, nginx, certbot. Переменные в `.env` берутся из `.env.example` — без жёстко зашитых значений.

## Локальная разработка

```bash
npm install
cp .env.example .env
# в .env прописать DATABASE_URL, AUTH_SECRET, ONLYOFFICE_JWT_SECRET, WHATSAPP_WORKER_TOKEN, CRON_SECRET

npx prisma migrate dev
npm run db:seed
npm run dev
```

Сид выведёт в stdout **случайный временный пароль** для `anna@azgroup.pl`. При первом входе система принудит сменить его (см. `User.mustChangePassword`). Пароль можно зафиксировать через ENV `SEED_ADMIN_PASSWORD` если нужно повторяемый результат (например в CI).

## Архитектура

- **`src/app/(app)`** — защищённые роуты (воронки, лиды, финансы, настройки)
- **`src/app/login`** — публичный вход
- **`src/app/change-password`** — обязательная смена пароля при первом входе
- **`src/app/api`** — REST endpoints (cron, push, OnlyOffice, WhatsApp webhook, Telegram webhook)
- **`whatsapp-worker/`** — отдельный Node-процесс с puppeteer + whatsapp-web.js
- **`telegram-worker/`** — отдельный Node-процесс на grammy (бот + webhook)
- **`prisma/`** — схема + seed

## Безопасность

- bcryptjs (10 round) + JWT сессии на 30 дней
- Rate-limit логина: 10 попыток за 15 минут на email
- OnlyOffice callback: обязательный JWT, whitelist URL для защиты от SSRF
- File buckets: только `avatars` публичный, прочее требует авторизации
- WhatsApp медиа-файлы: случайные 256-битные имена (нельзя угадать путь)
- Audit log (`AuditLog`) для всех критичных действий
- `User.mustChangePassword` флаг: при создании юзера сидом или ресете пароля админом — принудительный redirect на `/change-password`

## Области ответственности

| Роль     | Может                                              |
|----------|------------------------------------------------------|
| ADMIN    | всё                                                  |
| SALES    | свои лиды: создание/редактирование/оплаты/заметки |
| LEGAL    | лиды легализации: документы/отпечатки/карты   |

## Тесты

```bash
npm test               # unit (Vitest)
npm run test:integration # integration
npm run test:e2e       # Playwright
```

## Миграция после обновления schema

Prisma использует `db push` в dev и `migrate deploy` в prod. После пулла обновлённой схемы на prod-VPS:

```bash
cd /home/igorcrm/azcrm
git pull origin main
npx prisma migrate dev --name <описание_миграции>   # создаёт файл миграции + накатывает
npm run build
pm2 reload azcrm
```

Или быстрее (без миграционных файлов, с риском потери данных при destructive changes):
```bash
npx prisma db push --accept-data-loss
```
