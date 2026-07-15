import { describe, it, expect } from 'vitest';
import { Mailer, TemplateEngine, createMailer, createTemplateEngine } from '../src/index';

describe('Mailer', () => {
  it('should create mailer with default options', () => {
    const mailer = createMailer({ transport: 'test' });
    expect(mailer).toBeInstanceOf(Mailer);
  });

  it('should create mailer with custom options', () => {
    const mailer = createMailer({
      host: 'smtp.test.com',
      port: 587,
      from: 'test@test.com',
      transport: 'test',
    });
    expect(mailer).toBeInstanceOf(Mailer);
  });
});

describe('TemplateEngine', () => {
  it('should register and render templates', () => {
    const engine = createTemplateEngine();
    engine.register('welcome', {
      subject: 'Welcome {{name}}!',
      html: '<h1>Hello {{name}}</h1><p>Your email is {{email}}</p>',
    });

    const rendered = engine.render('welcome', { name: 'John', email: 'john@test.com' });
    expect(rendered.subject).toBe('Welcome John!');
    expect(rendered.html).toContain('<h1>Hello John</h1>');
    expect(rendered.html).toContain('john@test.com');
  });

  it('should throw for non-existent template', () => {
    const engine = createTemplateEngine();
    expect(() => engine.render('nonexistent', {})).toThrow('Template "nonexistent" not found');
  });

  it('should handle missing variables', () => {
    const engine = createTemplateEngine();
    engine.register('test', { subject: 'Hello {{name}}', html: 'Hi {{name}}' });
    const rendered = engine.render('test', {});
    expect(rendered.subject).toBe('Hello {{name}}');
  });
});