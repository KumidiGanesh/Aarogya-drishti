export function normalizeIndianMobile(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  const nationalNumber = digits.length > 10 && digits.startsWith('91')
    ? digits.slice(2)
    : digits;
  return nationalNumber.slice(0, 10);
}
