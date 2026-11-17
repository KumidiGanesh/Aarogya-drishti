import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';
import i18n from '../i18n/index.js';
import WhatsAppContact, { getWhatsAppHref } from './WhatsAppContact.jsx';

describe('WhatsApp contact link', () => {
  it('creates an encoded link for a valid international number', () => {
    expect(getWhatsAppHref('+91 98765-43210', 'Hello Aarogya')).toBe(
      'https://wa.me/919876543210?text=Hello%20Aarogya',
    );
  });

  it.each(['', '1234567', '0123456789', '+91 98765 ABCDE', '919876543210extra'])(
    'rejects an invalid or missing WhatsApp number: %s',
    (number) => {
      expect(getWhatsAppHref(number, 'Hello')).toBeNull();
    },
  );

  it('shows no contact link when a number is not configured', () => {
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '');
    render(
      <I18nextProvider i18n={i18n}>
        <WhatsAppContact />
      </I18nextProvider>,
    );

    expect(screen.queryByRole('link', { name: /whatsapp/i })).not.toBeInTheDocument();
  });

  it('opens WhatsApp with only a localized generic message', () => {
    vi.stubEnv('VITE_WHATSAPP_NUMBER', '+91 98765 43210');
    render(
      <I18nextProvider i18n={i18n}>
        <WhatsAppContact />
      </I18nextProvider>,
    );

    const link = screen.getByRole('link', { name: 'Contact support on WhatsApp' });
    expect(link).toHaveAttribute('href', expect.stringContaining('wa.me/919876543210?text='));
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    expect(decodeURIComponent(link.getAttribute('href'))).toContain(
      'Hello, I need help with Aarogya Drishti.',
    );
  });
});
