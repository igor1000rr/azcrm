# AZ Group CRM

CRM миграционной юридической фирмы AZ Group (Польша).

**Разработчик**: Igor (igor1000rr) — https://t.me/igor1000rr

## Стек

- **Next.js 15** App Router + **TypeScript strict**
- **PostgreSQL 16** + **Prisma 5**
- **NextAuth v5** (credentials, JWT)
- **Tailwind CSS 3** + **lucide-react** + **recharts** для графиков
- **OnlyOffice Document Server** — Word/Excel/PowerPoint в браузере
- **whatsapp-web.js** — WhatsApp каналы через QR
- **Google Calendar API** — синхронизация дат отпечатков
- **web-push** — push-уведомления через Service Worker
- **Docker** + **docker-compose**

## Быстрый старт

```bash
# 1. Установить зависимости
npm install
npm run worker:install

# 2. БД в docker
docker compose up -d db

# 3. .env
cp .env.example .env
# Сгенерировать секреты:
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # ONLYOFFICE_JWT_SECRET, WHATSAPP_WORKER_TOKEN, CRON_SECRET
npm run vapid             # VAPID для push

# 4. Применить схему и засеять
npm run db:push
npm run db:seed

# 5. Запуск (3 терминала)
npm run dev               # CRM на :3000
npm run worker:dev        # whatsapp-worker на :3100
docker run --rm -p 8080:80 -e JWT_ENABLED=true -e JWT_SECRET=$(grep ONLYOFFICE_JWT_SECRET .env | cut -d'"' -f2) onlyoffice/documentserver
```

Логин: `anna@azgroup.pl` / `AZGroup2026!`

### Полный стек в Docker

```bash
cp .env.example .env  # заполнить секреты
docker compose up -d --build
docker compose exec app npx prisma db push
docker compose exec app npm run db:seed
```

Открыть: http://localhost:3000

## Возможности

### Лиды и воронки
- 5 предустановленных воронок: Karta praca / Karta inne / Смена децизии / Консультация / Открытие бизнеса
- Кастомизация воронок и этапов через UI (Anna)
- Drag-and-drop в Kanban
- Один клиент = N дел (Client отдельно от Lead)
- Дедупликация по телефону при создании
- Редактирование клиента прямо в карточке
- KPI: лиды, стоимость, получено, долг, конверсия
- Архив (только админ)

### Документы
- **Чек-лист** на лиде с галочками (шаблон по воронке)
- **Файлы клиента** — общая папка, drag-and-drop загрузка, удаление
- **Внутренние документы** через OnlyOffice — редактирование Word/Excel прямо в браузере
- **Шаблоны Word** с автозаполнением: `{client.fullName}`, `{lead.service}`, `{today}`
- Версионирование через `parentId`

### WhatsApp
- 4 канала (общий + личные за менеджерами)
- Подключение через QR-код (Настройки → Каналы)
- Inbox с реал-тайм перепиской
- Видимость: общие — всем, личные — только владельцу
- Авто-создание лида из входящего сообщения
- **Шаблоны сообщений** с подстановкой полей клиента (`{client.fullName}`, `{lead.fingerprintDate}`, `{lead.debt}`)
- Автонапоминания клиенту об отпечатках за 7 и 1 день

### Звонки (Play API)
- Cron импорт каждые 5 минут
- Дедупликация по `externalId`
- Авто-привязка к клиенту по номеру
- Прослушивание записей
- Push-уведомление о пропущенных
- Готов к подключению — нужен только `PLAY_API_KEY`

### Google Calendar (двусторонняя sync)
- OAuth подключение в профиле каждого менеджера
- При установке даты отпечатков — событие в календаре менеджера легализации
- **Sync обратно**: события созданные в Google (через мобилу) импортируются в CRM-календарь как `CUSTOM`
- CRM-управляемые события (FINGERPRINT/EXTRA_CALL) — single source of truth, обновления из Google игнорируются

### Аналитика (только админ)
- 4 KPI карточки за период (неделя/месяц/квартал/год)
- Линейный график платежей по дням
- **Источники заявок** — bar-chart с разбивкой WhatsApp / Телефон / Telegram / Email / Сайт / Рекомендация / Самообращение / Вручную / Импорт / Другое + процентами
- Столбчатая диаграмма новых лидов
- Pie-чарт способов оплаты
- Сводка по воронкам с конверсией
- Производительность менеджеров

### Финансы (раздел в сайдбаре)
- **Услуги (прайс-лист)** — Anna управляет ценами и % комиссии. У каждой услуги свой `salesCommissionPercent` и `legalCommissionPercent`. Можно привязать к конкретной воронке.
- **Премии менеджеров** — таблица всех начислений: дата, клиент, услуга, менеджер, роль, % и сумма. Сводка по менеджеру за период (приведённая сумма, начислено, выплачено, к выплате). Админ помечает как «выплачено».
- **Сводная по ЗП** — для каждого менеджера: часы × ставка + фикс + комиссии − налоги = чистая ЗП. Часовая ставка/налог/фикс редактируются прямо в таблице.
- **Расходы (только Anna)** — построчный учёт с прикреплением сканов (с принтера), фильтр по городу, сводки по городам и категориям.

#### Логика комиссий
При создании платежа:
1. Считается порядковый номер платежа в лиде (`Payment.sequence`).
2. Сравнивается с глобальной настройкой `commission.startFromPaymentNumber` (по дефолту **2 — со второго платежа**, как просила Anna).
3. Если условие выполнено и у лида есть `salesManagerId` / `legalManagerId` — для каждого создаётся запись `Commission` с `amount = payment.amount × percent / 100`. % берётся из `Service` (или дефолт 5%).
4. Anna может переключить порог через **Финансы → Услуги** (тумблер «С 1-го / Со 2-го платежа»).

### Календарь работы (Моё рабочее время)
Каждый менеджер сам отмечает рабочие часы кликом по дню в полноэкранном месячном календаре (с-по время + заметка). Часы автоматически суммируются и используются в сводной по ЗП. Админ может смотреть/редактировать любого сотрудника.

### Экспорт лидов
`GET /api/leads/export?funnel=…&city=…` — CSV в кодировке UTF-8 BOM с разделителем `;` (для русской локали Excel). Включает все поля лида с расчётом долга. Кнопка **«Экспорт»** в правом верхнем углу страницы воронок (только ADMIN).

### Задачи
- Kanban: К выполнению / Выполнено / Отменено
- Drag-and-drop между колонками
- Создание/редактирование с приоритетом, дедлайном, исполнителем
- Push при назначении
- Фильтр Мои/Все (для админа)

### Внутренние чаты команды
- DIRECT (1-на-1) и GROUP чаты
- Polling каждые 5 сек
- Push-уведомления участникам

### Уведомления
- **Push** через Service Worker (web-push)
- **Email** через SMTP (для критичных событий: передача лида, просроченная задача)
- Колокольчик в шапке с попапом — 30 последних, prochитать всё
- Polling счётчика непрочитанных

### Безопасность и аудит
- JWT-сессии 30 дней
- Деактивация пользователя без удаления
- **Аудит-лог** всех ADMIN-действий: создание/удаление лидов, передача, удаление платежей, управление командой, редактирование клиентов
- Защита от path-traversal в файлах
- JWT-подпись OnlyOffice callback'ов
- CSRF state в Google OAuth
- Защита от деактивации единственного админа

## Скрипты

| Команда | Что делает |
|---|---|
| `npm run dev` | Dev Next.js |
| `npm run build` | Prisma generate + build |
| `npm start` | Production |
| `npm run db:push` | Применить схему |
| `npm run db:migrate` | Создать миграцию |
| `npm run db:seed` | Засеять данные |
| `npm run db:studio` | Prisma Studio |
| `npm run vapid` | Сгенерировать VAPID для push |
| `npm run worker:install` | Установить deps для whatsapp-worker |
| `npm run worker:dev` | Старт worker |

## Структура

```
src/
├── app/
│   ├── (app)/                  # защищённая зона
│   │   ├── layout.tsx          # сайдбар + main
│   │   ├── actions.ts          # server actions для лидов
│   │   ├── document-actions.ts # для документов
│   │   ├── funnel/             # Kanban воронок
│   │   ├── clients/            # список + новый + карточка
│   │   ├── inbox/              # WhatsApp переписки
│   │   ├── team-chat/          # внутренние чаты
│   │   ├── calls/              # журнал звонков
│   │   ├── calendar/           # календарь событий
│   │   ├── payments/           # платежи
│   │   ├── tasks/              # задачи
│   │   ├── automations/        # автоматизации
│   │   ├── stats/              # аналитика с графиками
│   │   ├── dashboard/          # обзор админа
│   │   └── settings/
│   │       ├── profile/        # профиль + Google + push
│   │       ├── team/           # управление командой
│   │       ├── funnels/        # воронки и этапы
│   │       ├── channels/       # WhatsApp каналы
│   │       ├── blueprints/     # шаблоны Word
│   │       └── audit/          # аудит-лог
│   ├── api/
│   │   ├── auth/               # NextAuth
│   │   ├── files/              # отдача и загрузка
│   │   ├── onlyoffice/         # config + callback
│   │   ├── whatsapp/           # webhook + действия
│   │   ├── google/             # OAuth + callback
│   │   ├── push/               # vapid/subscribe/unsubscribe
│   │   ├── notifications/      # list + read-all
│   │   ├── blueprints/         # список шаблонов
│   │   └── cron/               # reminders + sync-calls
│   ├── login/
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── ui/                     # Button, Badge, Avatar, Input, Modal, Panel
│   ├── sidebar.tsx
│   ├── topbar.tsx
│   ├── notifications-popup.tsx # колокольчик с попапом
│   ├── push-subscription-button.tsx
│   ├── onlyoffice-editor.tsx
│   ├── logo.tsx
│   └── providers.tsx
├── lib/
│   ├── auth.ts
│   ├── db.ts
│   ├── permissions.ts
│   ├── utils.ts
│   ├── notify.ts               # унификация: БД + push
│   ├── audit.ts                # аудит-лог
│   ├── storage/                # файлы на VPS
│   ├── onlyoffice/             # JWT + конфиг
│   ├── whatsapp/               # клиент к worker
│   ├── google/                 # OAuth + Calendar API
│   ├── push/                   # web-push
│   ├── telephony/              # абстракция Play API
│   └── docx-templates/         # рендеринг .docx
└── middleware.ts

prisma/
├── schema.prisma               # 31 модель, 16 енумов
└── seed.ts

whatsapp-worker/                # отдельный Node-процесс
├── package.json
├── Dockerfile
└── index.js

scripts/
└── generate-vapid.js

public/
└── sw.js                       # service worker для push
```

## Деплой на VPS

```bash
# На сервере
git clone <repo> /opt/azgroup-crm
cd /opt/azgroup-crm
cp .env.example .env  # заполнить!

# Запуск
docker compose up -d --build

# Миграции и сид
docker compose exec app npx prisma db push
docker compose exec app npm run db:seed

# nginx для двух поддоменов
sudo nano /etc/nginx/sites-available/azgroup
```

```nginx
server {
    listen 443 ssl http2;
    server_name crm.azgroup.pl;
    ssl_certificate     /etc/letsencrypt/live/crm.azgroup.pl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/crm.azgroup.pl/privkey.pem;
    client_max_body_size 50M;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
    }
}

server {
    listen 443 ssl http2;
    server_name office.azgroup.pl;
    ssl_certificate     /etc/letsencrypt/live/office.azgroup.pl/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/office.azgroup.pl/privkey.pem;
    client_max_body_size 100M;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
# SSL
sudo certbot --nginx -d crm.azgroup.pl -d office.azgroup.pl

# Cron-задачи
sudo crontab -e
```

```cron
# Напоминания клиентам каждые 30 мин
*/30 * * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.azgroup.pl/api/cron/reminders

# Импорт звонков из Play каждые 5 минут
*/5 * * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.azgroup.pl/api/cron/sync-calls

# Sync Google Calendar (события из календаря менеджеров → CRM) каждый час
0 * * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.azgroup.pl/api/cron/sync-calendar

# Бэкапы БД ежедневно в 3:00
0 3 * * * docker compose -f /opt/azgroup-crm/docker-compose.yml exec -T db pg_dump -U crm azgroup_crm | gzip > /backup/azgroup-$(date +\%F).sql.gz
```

После деплоя в `.env`:
- `APP_PUBLIC_URL=https://crm.azgroup.pl`
- `ONLYOFFICE_PUBLIC_URL=https://office.azgroup.pl`
- `GOOGLE_REDIRECT_URI=https://crm.azgroup.pl/api/google/callback`

## Роли

- **ADMIN** (Anna): полный доступ
- **SALES** (4 менеджера продаж): свои лиды + общие WA
- **LEGAL** (3 менеджера легализации): свои лиды

## Что дальше

- [ ] Расширенный AI-helper для генерации шаблонов (через OpenRouter / OpenAI)
- [ ] Воркфлоу-автоматизации (триггер X → действие Y) с UI редактором правил
- [ ] PWA-манифест для установки CRM как приложение на iOS/Android
