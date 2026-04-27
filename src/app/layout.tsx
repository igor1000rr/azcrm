import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: {
    default:  'AZ Group CRM',
    template: '%s · AZ Group CRM',
  },
  description: 'CRM юридической миграционной фирмы AZ Group',
  applicationName: 'AZ Group CRM',
  authors: [{ name: 'igor1000rr', url: 'https://t.me/igor1000rr' }],
  icons: { icon: '/favicon.svg' },
};

export const viewport: Viewport = {
  themeColor: '#0A1A35',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
