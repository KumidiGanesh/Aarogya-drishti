const service = require('./service');

function buildPdf(data) {
  const lines = Object.entries(data).flatMap(([section, value]) => {
    const text = `${section}: ${Array.isArray(value) ? JSON.stringify(value) : value}`;
    return text.match(/.{1,105}/g) || [''];
  }).slice(0, 55);
  const escapePdf = (text) => text.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');
  const stream = `BT /F1 9 Tf 42 790 Td 12 TL ${lines.map((line) => `(${escapePdf(line)}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}\nendstream`,
  ];
  let document = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(document, 'ascii'));
    document += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(document, 'ascii');
  document += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  document += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  document += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(document, 'ascii');
}

async function analytics(req, res, next) {
  try {
    const result = await service.analytics(req.validated.query, req.user, req);
    if (!result.export) {
      res.status(200).json({ success: true, message: 'Analytics loaded', data: result.data, meta: {} });
      return;
    }
    if (result.export === 'csv') {
      const rows = Object.entries(result.data).flatMap(([section, values]) =>
        Array.isArray(values) ? values.map((value) => [section, JSON.stringify(value)]) : [[section, String(values)]]);
      const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
      res.type('text/csv').set('Content-Disposition', 'attachment; filename="aarogya-analytics.csv"');
      res.status(200).send([['section', 'value'], ...rows].map((row) => row.map(escape).join(',')).join('\r\n'));
      return;
    }
    res.type('application/pdf')
      .set('Content-Disposition', 'attachment; filename="aarogya-analytics.pdf"')
      .status(200)
      .send(buildPdf(result.data));
  } catch (error) { next(error); }
}

module.exports = { analytics };
