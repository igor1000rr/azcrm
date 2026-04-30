// Email уведомления через SMTP (nodemailer).
// Используется для дублирования критичных уведомлений на email,
// если у юзера нет push или браузер закрыт.

import nodemailer from 'nodemailer';
import { logger } from '@/lib/logger';

const SMTP_HOST = process.env.SMTP_HOST ?? '';
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? '587', 10);
const SMTP_USER = process.env.SMTP_USER ?? '';
const SMTP_PASS = process.env.SMTP_PASS ?? '';
const SMTP_FROM = process.env.SMTP_FROM ?? 'AZ Group CRM <noreply@azgroup.pl>';
const SMTP_SECURE = process.env.SMTP_SECURE === 'true';

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (!isEmailConfigured()) return null;
  if (transporter) return transporter;

  transporter = nodemailer.createTransport({
    host:   SMTP_HOST,
    port:   SMTP_PORT,
    secure: SMTP_SECURE,
    auth:   SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });

  return transporter;
}

export function isEmailConfigured(): boolean {
  return !!SMTP_HOST;
}

interface EmailPayload {
  to:       string | string[];
  subject:  string;
  text?:    string;
  html?:    string;
  replyTo?: string;
}

export async function sendEmail(payload: EmailPayload): Promise<boolean> {
  const t = getTransporter();
  if (!t) return false;

  try {
    await t.sendMail({
      from:    SMTP_FROM,
      to:      payload.to,
      subject: payload.subject,
      text:    payload.text,
      html:    payload.html,
      replyTo: payload.replyTo,
    });
    return true;
  } catch (e) {
    logger.error('[email] send failed:', e);
    return false;
  }
}

/** Простой HTML-шаблон письма с фирменным стилем */
export function renderEmailTemplate(opts: {
  title: string;
  body:  string;       // текст параграфами (\n\n)
  ctaUrl?: string;
  ctaLabel?: string;
}): string {
  const paragraphs = opts.body.split('\n\n').map((p) => `<p style="margin:0 0 14px;color:#3F3F46;line-height:1.6">${escapeHtml(p)}</p>`).join('');

  const cta = opts.ctaUrl && opts.ctaLabel
    ? `<a href="${escapeHtml(opts.ctaUrl)}" style="display:inline-block;padding:11px 22px;background:#0A1A35;color:#B8924A;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;letter-spacing:0.04em">${escapeHtml(opts.ctaLabel)}</a>`
    : '';

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${escapeHtml(opts.title)}</title></head>
<body style="margin:0;padding:0;background:#FAFAFA;font-family:-apple-system,Inter,sans-serif">
  <div style="max-width:580px;margin:30px auto;padding:0 20px">
    <div style="text-align:center;margin-bottom:20px">
      <div style="display:inline-block;width:40px;height:40px;background:#0A1A35;color:#B8924A;border-radius:6px;line-height:40px;font-weight:700;font-size:20px;font-family:Georgia,serif">AZ</div>
      <div style="color:#0A1A35;font-weight:700;letter-spacing:0.06em;margin-top:8px;font-size:13px">AZ GROUP · MIGRATION OFFICE</div>
    </div>
    <div style="background:#FFFFFF;border:1px solid #ECECEC;border-radius:10px;padding:28px">
      <h1 style="margin:0 0 16px;color:#18181B;font-size:18px;font-weight:700">${escapeHtml(opts.title)}</h1>
      ${paragraphs}
      ${cta ? `<div style="margin-top:20px">${cta}</div>` : ''}
    </div>
    <p style="text-align:center;color:#A1A1AA;font-size:11px;margin-top:14px">
      Это автоматическое письмо. Чтобы отписаться, измените настройки в профиле CRM.
    </p>
  </div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
