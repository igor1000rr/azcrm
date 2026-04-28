#!/bin/bash
# Первоначальная установка AZ CRM на чистый Ubuntu/Debian VPS.
# Запускать под root: sudo bash setup.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Запускай через sudo"
  exit 1
fi

DEPLOY_USER="igorcrm"
DB_NAME="azgroup_crm"
DB_USER="crm"
APP_DIR="/home/$DEPLOY_USER/azcrm"
ENV_FILE="$APP_DIR/.env"

# ============================================================
# Генерация всех секретов СРАЗУ. Если .env уже есть — НЕ перезаписываем.
# Секреты длиной 32 байта (64 hex символа) — сильнее чем минимум NextAuth (32).
# ============================================================
DB_PASS=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -hex 32)
ONLYOFFICE_JWT_SECRET=$(openssl rand -hex 32)
WHATSAPP_WORKER_TOKEN=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)

echo "==> apt update"
apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release openssl ufw git rsync

echo "==> Node.js 20"
if ! command -v node &> /dev/null; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

echo "==> PostgreSQL 16"
if ! command -v psql &> /dev/null; then
  install -d /usr/share/postgresql-common/pgdg
  curl -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc --fail https://www.postgresql.org/media/keys/ACCC4CF8.asc
  echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt $(lsb_release -cs)-pgdg main" > /etc/apt/sources.list.d/pgdg.list
  apt-get update
  apt-get install -y postgresql-16 postgresql-contrib
  systemctl enable --now postgresql
fi

echo "==> nginx"
apt-get install -y nginx

echo "==> Chromium и зависимости (для whatsapp-web.js)"
apt-get install -y \
  fonts-liberation libasound2 libatk-bridge2.0-0 libatk1.0-0 libc6 \
  libcairo2 libcups2 libdbus-1-3 libexpat1 libfontconfig1 libgbm1 \
  libgcc-s1 libglib2.0-0 libgtk-3-0 libnspr4 libnss3 libpango-1.0-0 \
  libpangocairo-1.0-0 libstdc++6 libx11-6 libx11-xcb1 libxcb1 \
  libxcomposite1 libxcursor1 libxdamage1 libxext6 libxfixes3 libxi6 \
  libxrandr2 libxrender1 libxss1 libxtst6 wget xdg-utils chromium || \
apt-get install -y chromium-browser || true

echo "==> PM2"
npm install -g pm2

echo "==> Создание БД"
DB_EXISTS=0
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "БД $DB_NAME уже существует — пропускаю создание"
  DB_EXISTS=1
else
  sudo -u postgres psql <<EOF
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF
fi

echo "==> Папки приложения и логов"
mkdir -p "$APP_DIR" /home/$DEPLOY_USER/logs
chown -R $DEPLOY_USER:$DEPLOY_USER "$APP_DIR" /home/$DEPLOY_USER/logs

# ============================================================
# Создаём .env с заполненными секретами (если ещё нет)
# ============================================================
if [ ! -f "$ENV_FILE" ]; then
  echo "==> Создаю $ENV_FILE с автогенерированными секретами"
  PUBLIC_IP=$(curl -s https://api.ipify.org || echo "127.0.0.1")
  cat > "$ENV_FILE" <<ENV
# Автогенерировано $(date -Iseconds) скриптом setup.sh.
# Секреты сгенерированы криптографически — не делись и не коммить.

# ----- БАЗА -----
DATABASE_URL=postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public

# ----- АУТЕНТИФИКАЦИЯ -----
# AUTH_SECRET (он же NEXTAUTH_SECRET) — для подписи JWT, минимум 32 символа
AUTH_SECRET=$AUTH_SECRET
NEXTAUTH_SECRET=$AUTH_SECRET
# Публичный URL приложения — ОБЯЗАТЕЛЬНО HTTPS для Telegram webhook
APP_PUBLIC_URL=http://$PUBLIC_IP
NEXTAUTH_URL=http://$PUBLIC_IP

# ----- WHATSAPP WORKER -----
# Токен между Next.js ↔ whatsapp-worker (Bearer auth)
WHATSAPP_WORKER_URL=http://127.0.0.1:3010
WHATSAPP_WORKER_TOKEN=$WHATSAPP_WORKER_TOKEN

# ----- ONLYOFFICE -----
# Должен совпадать с JWT_SECRET в docker-compose сервиса OnlyOffice
ONLYOFFICE_URL=http://127.0.0.1:8080
ONLYOFFICE_JWT_SECRET=$ONLYOFFICE_JWT_SECRET

# ----- CRON -----
# Bearer для /api/cron/* (используется в crontab или GitHub Actions)
CRON_SECRET=$CRON_SECRET

# ----- GOOGLE OAUTH (заполни вручную из Google Cloud Console) -----
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# ----- WEB-PUSH (сгенерируй: npm run vapid:generate) -----
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@azgroup.pl

# ----- TELEGRAM -----
# Токены ботов задаются через UI (Settings → Channels), не в .env
ENV
  chown $DEPLOY_USER:$DEPLOY_USER "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "==> $ENV_FILE уже существует — НЕ трогаю. Проверь сам что секреты заданы."
fi

echo "==> nginx-конфиг"
cat > /etc/nginx/sites-available/azcrm <<'NGINX'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_read_timeout 300s;
    }

    location /api/files/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 50M;
        proxy_request_buffering off;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/azcrm /etc/nginx/sites-enabled/azcrm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "==> firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo "==> SSH-ключ для GitHub Actions"
KEY_PATH="/home/$DEPLOY_USER/.ssh/github_deploy"
if [ ! -f "$KEY_PATH" ]; then
  sudo -u $DEPLOY_USER mkdir -p /home/$DEPLOY_USER/.ssh
  sudo -u $DEPLOY_USER ssh-keygen -t ed25519 -f "$KEY_PATH" -N "" -C "github-actions-azcrm"
  cat "$KEY_PATH.pub" >> /home/$DEPLOY_USER/.ssh/authorized_keys
  chown $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh/authorized_keys
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
fi

echo "==> PM2 systemd autostart"
env PATH=$PATH:/usr/bin pm2 startup systemd -u $DEPLOY_USER --hp /home/$DEPLOY_USER || true

PUBLIC_IP=$(curl -s https://api.ipify.org || echo "IP сервера")

echo ""
echo "=========================================================="
echo "  Установка завершена."
echo ""
if [ $DB_EXISTS -eq 0 ]; then
  echo "  ✓ БД создана:    $DB_NAME (user $DB_USER)"
fi
if [ -f "$ENV_FILE" ]; then
  echo "  ✓ .env создан:   $ENV_FILE"
  echo "    (DATABASE_URL, AUTH_SECRET, ONLYOFFICE_JWT_SECRET,"
  echo "     WHATSAPP_WORKER_TOKEN, CRON_SECRET — все заполнены)"
fi
echo ""
echo "  ВРУЧНУЮ дозаполнить в $ENV_FILE:"
echo "    • APP_PUBLIC_URL — твой реальный домен (https://crm.example.com)"
echo "    • GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET — из Google Cloud Console"
echo "    • VAPID-ключи — выполни 'npm run vapid:generate' и вставь"
echo ""
echo "  GitHub Secrets (Settings → Secrets and variables → Actions):"
echo "    SSH_HOST = $PUBLIC_IP"
echo "    SSH_USER = $DEPLOY_USER"
echo "    SSH_KEY  = (приватный ключ ниже, целиком)"
echo ""
echo "  ----- НАЧАЛО ПРИВАТНОГО КЛЮЧА -----"
cat "$KEY_PATH"
echo "  ----- КОНЕЦ ПРИВАТНОГО КЛЮЧА -----"
echo ""
echo "  Дальше: push в main → авто-деплой → 'pm2 status' для проверки."
echo "=========================================================="
