import { z } from 'zod';
import * as nodemailer from 'nodemailer';
import { ProviderManifest } from '../provider.interface';

const configSchema = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  fromAddress: z.string().email(),
  fromName: z.string().optional(),
});

const credentialSchema = z.object({
  user: z.string().min(1),
  pass: z.string().min(1),
});

export type SmtpConfig = z.infer<typeof configSchema>;
export type SmtpCreds = z.infer<typeof credentialSchema>;

export interface SendMailOptions {
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
}

export class SmtpProvider implements ProviderManifest<SmtpConfig, SmtpCreds> {
  key = 'smtp';
  label = 'SMTP Email';
  category = 'email' as const;
  icon = 'Mail';
  auth = {
    type: 'basic' as const,
  };
  configSchema = configSchema;
  credentialSchema = credentialSchema;
  capabilities = ['send_email'];
  rateLimit = {
    perSecond: 5,
    perDay: 50000,
  };

  createTransport(config: SmtpConfig, credentials: SmtpCreds): nodemailer.Transporter {
    return nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: {
        user: credentials.user,
        pass: credentials.pass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 5000,
    });
  }

  async healthCheck(ctx: { config: SmtpConfig; credentials: SmtpCreds }): Promise<{ ok: boolean; detail?: string }> {
    try {
      const transporter = this.createTransport(ctx.config, ctx.credentials);
      await transporter.verify();
      return { ok: true, detail: 'SMTP connection verified successfully' };
    } catch (err: any) {
      return { ok: false, detail: err.message || 'SMTP verification failed' };
    }
  }

  async sendMail(
    config: SmtpConfig,
    credentials: SmtpCreds,
    options: SendMailOptions,
  ): Promise<{ messageId: string }> {
    const transporter = this.createTransport(config, credentials);
    const from = config.fromName ? `"${config.fromName}" <${config.fromAddress}>` : config.fromAddress;

    const info = await transporter.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      text: options.text,
      html: options.html,
      replyTo: options.replyTo,
      headers: options.headers,
    });

    return {
      messageId: info.messageId,
    };
  }
}

export const smtpProvider = new SmtpProvider();
