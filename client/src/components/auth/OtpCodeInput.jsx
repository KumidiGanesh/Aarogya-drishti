import { useRef } from 'react';
import { useTranslation } from 'react-i18next';

export default function OtpCodeInput({ value, onChange, disabled = false }) {
  const { t } = useTranslation();
  const refs = useRef([]);
  const digits = Array.from({ length: 6 }, (_, index) => value[index] || '');

  const update = (index, input) => {
    const entered = input.replace(/\D/g, '');
    if (entered.length > 1) {
      const start = entered.length >= 6 ? 0 : index;
      const code = entered.slice(0, 6 - start);
      const next = [...digits];
      code.split('').forEach((digit, offset) => {
        next[start + offset] = digit;
      });
      onChange(next.join(''));
      refs.current[Math.min(start + code.length, 5)]?.focus();
      return;
    }
    const next = [...digits];
    next[index] = entered;
    onChange(next.join(''));
    if (entered && index < 5) refs.current[index + 1]?.focus();
  };

  const paste = (event, index) => {
    const entered = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!entered) return;
    event.preventDefault();
    const next = [...digits];
    const start = entered.length === 6 ? 0 : index;
    const pasted = entered.slice(0, 6 - start);
    pasted.split('').forEach((digit, offset) => {
      next[start + offset] = digit;
    });
    onChange(next.join(''));
    refs.current[Math.min(start + pasted.length, 5)]?.focus();
  };

  return (
    <div aria-label={t('auth.otpCode')} className="otp-code" role="group">
      {digits.map((digit, index) => (
        <input
          aria-label={t('auth.otpDigit', { number: index + 1 })}
          autoFocus={index === 0}
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          disabled={disabled}
          inputMode="numeric"
          key={index}
          maxLength={1}
          onChange={(event) => update(index, event.target.value)}
          onPaste={(event) => paste(event, index)}
          onKeyDown={(event) => {
            if (event.key === 'Backspace' && !digits[index] && index > 0) {
              const next = [...digits];
              next[index - 1] = '';
              onChange(next.join(''));
              refs.current[index - 1]?.focus();
            } else if (event.key === 'ArrowLeft' && index > 0) {
              refs.current[index - 1]?.focus();
            } else if (event.key === 'ArrowRight' && index < 5) {
              refs.current[index + 1]?.focus();
            }
          }}
          pattern="[0-9]*"
          ref={(element) => { refs.current[index] = element; }}
          type="text"
          value={digit}
        />
      ))}
    </div>
  );
}
