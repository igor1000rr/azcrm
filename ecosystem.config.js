// PM2 — два процесса: Next.js (standalone) + WhatsApp worker
//
// azcrm-web запускается через standalone-сервер Next.js (.next/standalone/server.js)
// — это значительно меньше памяти и быстрее старт, чем `next start`.
// Зависит от того что после `next build` отрабатывает postbuild npm-скрипт,
// который копирует public/ и .next/static/ внутрь .next/standalone.
module.exports = {
  apps: [
    {
      name: 'azcrm-web',
      cwd: '/home/igorcrm/azcrm',
      script: '.next/standalone/server.js',
      env: {
        NODE_ENV: 'production',
        PORT:     '3000',
        HOSTNAME: '0.0.0.0',
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      out_file:   '/home/igorcrm/logs/web-out.log',
      error_file: '/home/igorcrm/logs/web-err.log',
      time: true,
    },
    {
      name: 'azcrm-worker',
      cwd: '/home/igorcrm/azcrm/whatsapp-worker',
      script: 'npm',
      args: 'start',
      env: {
        NODE_ENV: 'production',
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      out_file:   '/home/igorcrm/logs/worker-out.log',
      error_file: '/home/igorcrm/logs/worker-err.log',
      time: true,
    },
  ],
};
