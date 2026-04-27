#!/bin/bash
# Первоначальная установка AZ CRM на чистый Ubuntu/Debian VPS.
# Запускать под root: sudo bash deploy/setup.sh
set -e

if [ "$EUID" -ne 0 ]; then
  echo "Запускай через sudo"
  exit 1
 fi

DEPLOY_USER="igorcrm"
DB_NAME="azgroup_crm"
DB_USER="crm"
DB_PASS=$(openssl rand -hex 16)

echo "==> apt update"
apt-get update
apt-get install -y curl ca-certificates gnupg lsb-release openssl ufw git

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
else
  sudo -u postgres psql <<EOF
CREATE USER $DB_USER WITH PASSWORD '$DB_PASS';
CREATE DATABASE $DB_NAME OWNER $DB_USER;
\c $DB_NAME
GRANT ALL ON SCHEMA public TO $DB_USER;
EOF
fi

echo "==> Папка для логов"
mkdir -p /home/$DEPLOY_USER/logs
chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/logs

echo "==> nginx-конфиг"
cp /home/$DEPLOY_USER/azcrm/deploy/nginx.conf /etc/nginx/sites-available/azcrm 2>/dev/null || \
  echo "(репо ещё не клонирован — скопируй nginx.conf вручную после клонирования)"
ln -sf /etc/nginx/sites-available/azcrm /etc/nginx/sites-enabled/azcrm
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx || true

echo "==> firewall"
ufw allow OpenSSH || true
ufw allow 'Nginx Full' || true
ufw --force enable || true

echo "==> PM2 systemd autostart"
env PATH=$PATH:/usr/bin pm2 startup systemd -u $DEPLOY_USER --hp /home/$DEPLOY_USER || true

echo ""
echo "=========================================================="
echo "  Установка завершена."
echo ""
echo "  DATABASE_URL для .env:"
echo "  postgresql://$DB_USER:$DB_PASS@localhost:5432/$DB_NAME?schema=public"
echo ""
echo "  Сохрани этот URL — он больше не покажется."
echo "=========================================================="
