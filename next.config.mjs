/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverActions: { bodySizeLimit: '4mb' }
  },

  // Базовые security headers. CSP не задаём — OnlyOffice грузит api.js
  // с другого домена (office.azgroup.pl) и для безболезненной интеграции
  // CSP нужно настраивать с явным `script-src` под этот домен.
  // X-Frame-Options=SAMEORIGIN: чужие сайты не могут нас встраивать в iframe.
  // OnlyOffice работает наоборот — это МЫ грузим api.js OO, не наоборот,
  // так что SAMEORIGIN не мешает.
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
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
