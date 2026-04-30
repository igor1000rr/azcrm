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

# Дефолтные домены — переопредели через DOMAIN=... bash setup.sh
APP_DOMAIN="${DOMAIN:-crm.azgroupcompany.net}"
OO_DOMAIN="${OO_DOMAIN:-office.azgroupcompany.net}"
NOTIFY_EMAIL="${NOTIFY_EMAIL:-anna@azgroupcompany.net}"

# ============================================================
# Генерация всех секретов СРАЗУ. Если .env уже есть — НЕ перезаписываем.
# Имена переменных строго по .env.example — НИКАКИХ NEXT_PUBLIC_, NEXTAUTH_*.
# ============================================================
DB_PASS=$(openssl rand -hex 16)
AUTH_SECRET=$(openssl rand -hex 32)
ONLYOFFICE_JWT_SECRET=$(openssl rand -hex 32)
WHATSAPP_WORKER_TOKEN=$(openssl rand -hex 32)
CRON_SECRET=$(openssl rand -hex 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)

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

echo "==> Генерация VAPID-ключей через web-push"
VAPID_JSON=$(npx --yes -p web-push web-push generate-vapid-keys --json 2>/dev/null || echo '{}')
VAPID_PUBLIC_KEY=$(echo "$VAPID_JSON"  | grep -oE '"publicKey":"[^"]+"'  | cut -d'"' -f4)
VAPID_PRIVATE_KEY=$(echo "$VAPID_JSON" | grep -oE '"privateKey":"[^"]+"' | cut -d'"' -f4)

if [ ! -f "$ENV_FILE" ]; then
  echo "==> Создаю $ENV_FILE"
  cat > "$ENV_FILE" <<ENV
# Автогенерировано $(date -Iseconds) скриптом deploy/setup.sh
# Имена переменных строго по .env.example в репо.

# ----- БАЗА -----
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASS
DB_NAME=$DB_NAME
DATABASE_URL="postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public"

# ----- АВТОРИЗАЦИЯ (NextAuth v5) -----
AUTH_SECRET="$AUTH_SECRET"
AUTH_URL="https://$APP_DOMAIN"
APP_PUBLIC_URL="https://$APP_DOMAIN"

# ----- ШИФРОВАНИЕ (AES-256-GCM для OAuth-токенов в БД) -----
# КРИТИЧНО: после первой установки НЕ менять — иначе зашифрованные данные
# становятся нечитаемыми, юзеры теряют связку с Google Calendar.
ENCRYPTION_KEY="$ENCRYPTION_KEY"

# ----- ONLYOFFICE -----
ONLYOFFICE_PUBLIC_URL="https://$OO_DOMAIN"
ONLYOFFICE_JWT_SECRET="$ONLYOFFICE_JWT_SECRET"

# ----- WHATSAPP WORKER -----
WHATSAPP_WORKER_URL="http://127.0.0.1:3100"
WHATSAPP_WORKER_TOKEN="$WHATSAPP_WORKER_TOKEN"

# ----- GOOGLE OAUTH (заполнить вручную из console.cloud.google.com) -----
GOOGLE_CLIENT_ID=""
GOOGLE_CLIENT_SECRET=""
GOOGLE_REDIRECT_URI="https://$APP_DOMAIN/api/google/callback"

# ----- ТЕЛЕФОНИЯ Play -----
PLAY_API_BASE="https://api.play.pl/v1"
PLAY_API_KEY=""
SAVE_CALL_RECORDS="false"

# ----- PUSH-УВЕДОМЛЕНИЯ -----
VAPID_PUBLIC_KEY="$VAPID_PUBLIC_KEY"
VAPID_PRIVATE_KEY="$VAPID_PRIVATE_KEY"
VAPID_SUBJECT="mailto:$NOTIFY_EMAIL"

# ----- EMAIL SMTP (опционально) -----
SMTP_HOST=""
SMTP_PORT="587"
SMTP_USER=""
SMTP_PASS=""
SMTP_FROM="AZ Group CRM <noreply@azgroupcompany.net>"
SMTP_SECURE="false"

# ----- CRON -----
CRON_SECRET="$CRON_SECRET"

# ----- ХРАНИЛИЩЕ -----
STORAGE_ROOT="$APP_DIR/storage"

# ----- TELEGRAM -----
# Токены ботов задаются через UI (Settings → Каналы связи), не в .env
ENV
  chown $DEPLOY_USER:$DEPLOY_USER "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  echo "==> $ENV_FILE уже существует — НЕ трогаю."
  # ВАЖНО: для уже-установленных VPS нужно вручную добавить ENCRYPTION_KEY
  # (если его там ещё нет) — иначе после деплоя crypto.ts упадёт.
  if ! grep -q "^ENCRYPTION_KEY=" "$ENV_FILE"; then
    echo "==> ВНИМАНИЕ: ENCRYPTION_KEY не найден в $ENV_FILE — добавляю свежесгенерированный"
    echo "" >> "$ENV_FILE"
    echo "# ----- ШИФРОВАНИЕ (AES-256-GCM для OAuth-токенов в БД) -----" >> "$ENV_FILE"
    echo "# КРИТИЧНО: после установки НЕ менять — иначе зашифрованные данные нечитаемы" >> "$ENV_FILE"
    echo "ENCRYPTION_KEY=\"$ENCRYPTION_KEY\"" >> "$ENV_FILE"
  fi
fi

echo "==> nginx-конфиг для CRM (HTTPS через certbot после)"
cat > /etc/nginx/sites-available/azcrm <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $APP_DOMAIN;

    client_max_body_size 50M;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }

    location /api/files/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        client_max_body_size 50M;
        proxy_request_buffering off;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/azcrm /etc/nginx/sites-enabled/azcrm

echo "==> nginx-конфиг для OnlyOffice"
cat > /etc/nginx/sites-available/office <<NGINX
server {
    listen 80;
    listen [::]:80;
    server_name $OO_DOMAIN;
    client_max_body_size 100M;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/office /etc/nginx/sites-enabled/office

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

echo ""
echo "=========================================================="
echo "  Установка завершена."
[ $DB_EXISTS -eq 0 ] && echo "  ✓ БД создана:    $DB_NAME"
[ -f "$ENV_FILE" ]    && echo "  ✓ .env создан:   $ENV_FILE (домен $APP_DOMAIN)"
echo ""
echo "  Дозаполнить вручную в .env:"
echo "    GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET (console.cloud.google.com)"
echo ""
echo "  HTTPS:  certbot --nginx -d $APP_DOMAIN -d $OO_DOMAIN"
echo ""
echo "  GitHub Secrets для деплоя:"
echo "    SSH_HOST = $(curl -s https://api.ipify.org || echo 'IP')"
echo "    SSH_USER = $DEPLOY_USER"
echo "    SSH_KEY  = (приватный ключ ниже)"
echo "  ----- BEGIN -----"
cat "$KEY_PATH"
echo "  -----  END  -----"
echo "=========================================================="
