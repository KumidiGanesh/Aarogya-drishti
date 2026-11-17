import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import i18n from '../../i18n/index.js';
import OtpCodeInput from './OtpCodeInput.jsx';

describe('OTP code input', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en');
  });

  it('renders six single-digit inputs and accepts a complete pasted code', () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <OtpCodeInput onChange={onChange} value="" />
      </I18nextProvider>,
    );

    const inputs = Array.from({ length: 6 }, (_, index) =>
      screen.getByLabelText(`Verification code digit ${index + 1}`));
    expect(screen.getByRole('group', { name: 'Six-digit verification code' })).toBeInTheDocument();
    inputs.forEach((input) => expect(input).toHaveAttribute('maxlength', '1'));

    fireEvent.paste(inputs[0], { clipboardData: { getData: () => '123456' } });

    expect(onChange).toHaveBeenLastCalledWith('123456');
    expect(document.activeElement).toBe(inputs[5]);
  });

  it('distributes a six-digit mobile autofill value across all inputs', () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <OtpCodeInput onChange={onChange} value="" />
      </I18nextProvider>,
    );

    fireEvent.change(screen.getByLabelText('Verification code digit 1'), {
      target: { value: '654321' },
    });

    expect(onChange).toHaveBeenLastCalledWith('654321');
  });

  it('moves backward and clears the preceding digit when backspace is pressed on an empty box', () => {
    const onChange = vi.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <OtpCodeInput onChange={onChange} value="123" />
      </I18nextProvider>,
    );
    const third = screen.getByLabelText('Verification code digit 3');
    const fourth = screen.getByLabelText('Verification code digit 4');

    fireEvent.keyDown(fourth, { key: 'Backspace' });

    expect(onChange).toHaveBeenLastCalledWith('12');
    expect(document.activeElement).toBe(third);
  });
});
