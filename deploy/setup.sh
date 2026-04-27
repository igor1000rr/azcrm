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
DB_PASS=$(openssl rand -hex 16)
APP_DIR="/home/$DEPLOY_USER/azcrm"

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
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1; then
  echo "БД $DB_NAME уже существует — пропускаю"
  DB_PASS="(уже создан, используй существующий)"
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

echo ""
echo "=========================================================="
echo "  Установка завершена."
echo ""
echo "  1. DATABASE_URL для .env (на сервере, после первого деплоя):"
echo "     postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public"
echo ""
echo "  2. GitHub Secrets (Settings → Secrets and variables → Actions):"
echo "     SSH_HOST = $(curl -s https://api.ipify.org || echo 'IP сервера')"
echo "     SSH_USER = $DEPLOY_USER"
echo "     SSH_KEY  = (приватный ключ ниже, целиком вместе с заголовками)"
echo ""
echo "  ----- НАЧАЛО ПРИВАТНОГО КЛЮЧА -----"
cat "$KEY_PATH"
echo "  ----- КОНЕЦ ПРИВАТНОГО КЛЮЧА -----"
echo ""
echo "  3. После добавления Secrets — push в main запустит первый деплой."
echo "  4. Затем зайди на сервер и создай $APP_DIR/.env с переменными из .env.example"
echo "     Перезапусти: pm2 restart all"
echo "=========================================================="
