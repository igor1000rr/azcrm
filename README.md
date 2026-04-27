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
npm install
npm run worker:install
docker compose up -d db
cp .env.example .env
# Сгенерировать секреты:
openssl rand -base64 32   # AUTH_SECRET
openssl rand -hex 32      # ONLYOFFICE_JWT_SECRET, WHATSAPP_WORKER_TOKEN, CRON_SECRET
npm run vapid             # VAPID для push
npm run db:push
npm run db:seed
npm run dev
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
- Кастомизация воронок и этапов через UI
- Drag-and-drop в Kanban
- Один клиент = N дел
- Дедупликация по телефону
- KPI: лиды, стоимость, получено, долг, конверсия

### Документы
- Чек-лист на лиде с галочками (шаблон по воронке)
- Файлы клиента — общая папка с загрузкой/удалением
- Внутренние документы через OnlyOffice — Word/Excel в браузере
- Шаблоны Word с автозаполнением: `{client.fullName}`, `{lead.service}`, `{today}`

### WhatsApp
- 4 канала (общий + личные за менеджерами)
- Подключение через QR-код
- Inbox с реал-тайм перепиской
- Авто-создание лида из входящего сообщения
- Шаблоны сообщений с подстановкой полей
- Автонапоминания клиенту об отпечатках за 7 и 1 день

### Звонки (Play API)
- Cron импорт каждые 5 минут
- Дедупликация и авто-привязка к клиенту
- Push при пропущенных
- Готов к подключению — нужен только `PLAY_API_KEY`

### Google Calendar (двусторонняя sync)
- OAuth подключение в профиле каждого менеджера
- Событие в календаре менеджера легализации при установке отпечатков
- Sync обратно: события из Google → CRM как CUSTOM
- CRM-управляемые типы (FINGERPRINT/EXTRA_CALL) — single source of truth

### Аналитика (только админ)
- KPI карточки за период (неделя/месяц/квартал/год)
- Линейный график платежей по дням
- Столбчатая диаграмма новых лидов
- Pie-чарт способов оплаты
- Сводка по воронкам с конверсией
- Производительность менеджеров

### Задачи
- Kanban: К выполнению / Выполнено / Отменено
- Drag-and-drop, приоритеты, дедлайны, исполнители

### Внутренние чаты команды
- DIRECT (1-на-1) и GROUP чаты
- Polling каждые 5 сек, push участникам

### Уведомления
- **Push** через Service Worker (web-push)
- **Email** через SMTP (для критичных событий)
- Колокольчик в шапке с попапом

### Безопасность и аудит
- JWT-сессии 30 дней, деактивация без удаления
- Аудит-лог всех ADMIN-действий
- Защита от path-traversal в файлах
- JWT-подпись OnlyOffice callback'ов
- CSRF state в Google OAuth

## Деплой на VPS

```bash
git clone https://github.com/igor1000rr/azcrm /opt/azgroup-crm
cd /opt/azgroup-crm
cp .env.example .env  # заполнить!

docker compose up -d --build
docker compose exec app npx prisma db push
docker compose exec app npm run db:seed
```

### nginx (два поддомена)

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
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
```

```bash
sudo certbot --nginx -d crm.azgroup.pl -d office.azgroup.pl
sudo crontab -e
```

```cron
*/30 * * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.azgroup.pl/api/cron/reminders
*/5 * * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.azgroup.pl/api/cron/sync-calls
0 * * * * curl -s -X POST -H "Authorization: Bearer YOUR_CRON_SECRET" https://crm.azgroup.pl/api/cron/sync-calendar
0 3 * * * docker compose -f /opt/azgroup-crm/docker-compose.yml exec -T db pg_dump -U crm azgroup_crm | gzip > /backup/azgroup-$(date +\%F).sql.gz
```

## Роли

- **ADMIN** (Anna): полный доступ
- **SALES** (4 менеджера продаж): свои лиды + общие WA
- **LEGAL** (3 менеджера легализации): свои лиды
