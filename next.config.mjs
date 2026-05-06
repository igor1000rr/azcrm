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
  //
  // 06.05.2026 — #2.20 аудита (security headers): добавлен Strict-Transport-Security
  // и Cross-Origin-* заголовки. HSTS выставляется только в production — в dev
  // браузер будет отказываться от http://localhost после первого визита.
  async headers() {
    const isProd = process.env.NODE_ENV === 'production';
    const baseHeaders = [
      { key: 'Content-Security-Policy',   value: CSP },
      { key: 'X-Frame-Options',           value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options',    value: 'nosniff' },
      { key: 'Referrer-Policy',           value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy',        value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()' },
      { key: 'X-DNS-Prefetch-Control',    value: 'off' },
      // Cross-Origin-Opener-Policy: same-origin — изоляция окна от popup'ов
      // других origin'ов (защита от Spectre + блокирует window.opener атаки).
      { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
      // Cross-Origin-Resource-Policy: same-site — ресурсы CRM не могут быть
      // встроены на чужом сайте (img/script/etc с кросс-оригин).
      { key: 'Cross-Origin-Resource-Policy', value: 'same-site' },
    ];
    if (isProd) {
      // HSTS: браузер будет ходить только по HTTPS на этот домен и все его
      // субдомены. Два года. preload — разрешаем включение в встроенный
      // список Chrome (https://hstspreload.org/) — Anna может зарегистрировать
      // crm.azgroupcompany.net там позже.
      baseHeaders.push({
        key:   'Strict-Transport-Security',
        value: 'max-age=63072000; includeSubDomains; preload',
      });
    }
    return [{ source: '/:path*', headers: baseHeaders }];
  },
};

export default nextConfig;
