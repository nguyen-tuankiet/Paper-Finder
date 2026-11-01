import nodemailer from 'nodemailer';
import type { Logger } from '../logger.js';

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Gửi email giao dịch (hiện chỉ dùng cho đặt lại mật khẩu). */
export interface Mailer {
  /** 'smtp' = gửi thật qua máy chủ SMTP; 'console' = chỉ ghi nội dung thư vào log (chỉ dùng khi phát triển ở máy local). */
  readonly mode: 'smtp' | 'console';
  send(message: MailMessage): Promise<void>;
}

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user?: string;
  pass?: string;
  /** Địa chỉ người gửi, vd. `PaperFinder <no-reply@ten-mien.com>`. */
  from: string;
}

export function createSmtpMailer(config: SmtpConfig): Mailer {
  const transport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: config.pass ?? '' } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  return {
    mode: 'smtp',
    async send(message) {
      await transport.sendMail({ from: config.from, to: message.to, subject: message.subject, text: message.text, html: message.html });
    },
  };
}

/** Thư không được gửi đi mà chỉ ghi vào log, để thử đặt lại mật khẩu ở máy local khi chưa có SMTP. */
export function createConsoleMailer(logger: Logger): Mailer {
  return {
    mode: 'console',
    async send(message) {
      logger.info('mail_console', { to: message.to, subject: message.subject, text: message.text });
    },
  };
}
