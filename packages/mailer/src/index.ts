import { createTransport, Transporter } from 'nodemailer';

// ==================== Types ====================

export interface MailerOptions {
  host?: string;
  port?: number;
  secure?: boolean;
  auth?: { user: string; pass: string };
  from?: string;
  transport?: 'smtp' | 'json' | 'test';
}

export interface MailMessage {
  from?: string;
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  subject: string;
  text?: string;
  html?: string;
  attachments?: Array<{ filename: string; content: Buffer | string; contentType?: string }>;
  replyTo?: string;
  headers?: Record<string, string>;
}

export interface MailResult {
  messageId: string;
  accepted: string[];
  rejected: string[];
}

// ==================== Mailer ====================

export class Mailer {
  private transporter: Transporter;
  private defaultFrom: string;

  constructor(options: MailerOptions = {}) {
    this.defaultFrom = options.from || 'noreply@tlevor.app';

    if (options.transport === 'test' || (!options.host && !options.transport)) {
      this.transporter = createTransport({ jsonTransport: true });
    } else {
      this.transporter = createTransport({
        host: options.host || 'smtp.gmail.com',
        port: options.port || 587,
        secure: options.secure || false,
        auth: options.auth,
      });
    }
  }

  async send(message: MailMessage): Promise<MailResult> {
    const info = await this.transporter.sendMail({
      from: message.from || this.defaultFrom,
      to: Array.isArray(message.to) ? message.to.join(', ') : message.to,
      cc: message.cc ? (Array.isArray(message.cc) ? message.cc.join(', ') : message.cc) : undefined,
      bcc: message.bcc ? (Array.isArray(message.bcc) ? message.bcc.join(', ') : message.bcc) : undefined,
      subject: message.subject,
      text: message.text,
      html: message.html,
      attachments: message.attachments,
      replyTo: message.replyTo,
      headers: message.headers,
    });

    return {
      messageId: info.messageId,
      accepted: Array.isArray(info.accepted) ? info.accepted : [info.accepted],
      rejected: Array.isArray(info.rejected) ? info.rejected : [info.rejected],
    };
  }

  async sendBulk(messages: MailMessage[]): Promise<MailResult[]> {
    return Promise.all(messages.map(msg => this.send(msg)));
  }

  async verify(): Promise<boolean> {
    try { await this.transporter.verify(); return true; }
    catch { return false; }
  }

  getTransporter(): Transporter { return this.transporter; }
}

// ==================== Templates ====================

export interface EmailTemplate {
  subject: string;
  text?: string;
  html: string;
}

export class TemplateEngine {
  private templates: Map<string, EmailTemplate> = new Map();

  register(name: string, template: EmailTemplate): void { this.templates.set(name, template); }

  render(name: string, data: Record<string, any>): { subject: string; text?: string; html: string } {
    const template = this.templates.get(name);
    if (!template) throw new Error(`Template "${name}" not found`);

    const renderStr = (str: string) => str.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] !== undefined ? String(data[key]) : `{{${key}}}`);

    return {
      subject: renderStr(template.subject),
      text: template.text ? renderStr(template.text) : undefined,
      html: renderStr(template.html),
    };
  }
}

// ==================== Factory ====================

export function createMailer(options?: MailerOptions): Mailer { return new Mailer(options); }
export function createTemplateEngine(): TemplateEngine { return new TemplateEngine(); }