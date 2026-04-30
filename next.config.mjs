/** @type {import('next').NextConfig} */

// CSP читает домен OnlyOffice из ENV — сборка/прод деплой может быть на разных
// доменах. На билде доступен ONLYOFFICE_PUBLIC_URL (см. docker-compose.yml).
// Если переменная не задана — fallback на office.azgroupcompany.net.
const OO_URL  = process.env.ONLYOFFICE_PUBLIC_URL ?? 'https://office.azgroupcompany.net';
let   ooHost  = 'office.azgroupcompany.net';
try { ooHost = new URL(OO_URL).host; } catch {}
const ooOrigin = `https://${ooHost}`;

// Content-Security-Policy. Цель — отбить XSS-инъекции в сторонние домены
// (загрузка script с evil.com, утечка данных через img/connect и т.д.),
// при этом не сломав интеграцию с OnlyOffice (api.js + iframe редактора).
//
// Компромиссы:
//   - 'unsafe-inline' для script/style: Next.js inject'ит inline-скрипты для
//     hydration и runtime-конфигов; убирать через nonce — отдельная история
//     (требует middleware, генерирующий nonce для каждого запроса).
//   - 'unsafe-eval' для script: некоторые билды Next/recharts используют new Function().
//   - img-src https:: позволяет картинкам с внешних доменов (карты, аватарки
//     из Google, превью OG из соцсетей).
//   - frame-src ${ooOrigin}: для встроенного редактора OnlyOffice.
//   - connect-src 'self' ${ooOrigin}: fetch к нашему API + к OO для api.js.
//   - frame-ancestors 'none': дублирует X-Frame-Options=SAMEORIGIN, явно
//     запрещая встраивать НАС в чужой iframe.
const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${ooOrigin}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  `connect-src 'self' ${ooOrigin}`,
  `frame-src 'self' ${ooOrigin}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: { bodySizeLimit: '4mb' }
  },

  // Базовые security headers + CSP с явным разрешением OnlyOffice-домена.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy',   value: CSP },
          { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options',    value: 'nosniff' },
          { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
          { key: 'X-DNS-Prefetch-Control',    value: 'off' },
        ],
      },
    ];
  },
};

export default nextConfig;
