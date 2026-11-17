function normalizeIndianMobile(value) {
  let digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

function mobileLookupValues(value) {
  const mobile = normalizeIndianMobile(value);
  if (!mobile) return [String(value ?? '')];

  const prefix = mobile.slice(0, 5);
  const suffix = mobile.slice(5);
  return [...new Set([
    mobile,
    `0${mobile}`,
    `91${mobile}`,
    `91 ${mobile}`,
    `91-${mobile}`,
    `+91${mobile}`,
    `+91 ${mobile}`,
    `+91-${mobile}`,
    `${prefix} ${suffix}`,
    `${prefix}-${suffix}`,
    `+91 ${prefix} ${suffix}`,
    `+91-${prefix}-${suffix}`,
  ])];
}

module.exports = { normalizeIndianMobile, mobileLookupValues };
