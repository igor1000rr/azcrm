// PM2 — два процесса: Next.js + WhatsApp worker
module.exports = {
  apps: [
    {
      name: 'azcrm-web',
      cwd: '/home/igorcrm/azcrm',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      env: {
        NODE_ENV: 'production',
        PORT: '3000',
      },
      instances: 1,
      exec_mode: 'fork',
      max_memory_restart: '1G',
      autorestart: true,
      watch: false,
      out_file: '/home/igorcrm/logs/web-out.log',
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
      out_file: '/home/igorcrm/logs/worker-out.log',
      error_file: '/home/igorcrm/logs/worker-err.log',
      time: true,
    },
  ],
};
