const sharp = require('sharp');
const { createWorker } = require('tesseract.js');
const { createCanvas, DOMMatrix, ImageData, Path2D, loadImage } = require('@napi-rs/canvas');
const jsQR = require('jsqr');

const MAX_PDF_PAGES = 2;
const OCR_MAX_PIXELS = 12_000_000;
const KNOWN_LABELS = /^(government of india|unique identification authority of india|aadhaar|aadhar|uidai|dob|date of birth|year of birth|male|female|transgender|address|enrolment no|enrollment no|my aadhaar|mera aadhaar meri pehchaan)$/i;

function validFileSignature(buffer, mimetype) {
  if (mimetype === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimetype === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mimetype === 'application/pdf') return buffer.subarray(0, 5).toString('ascii') === '%PDF-';
  return false;
}

async function normalizeImage(buffer) {
  const image = sharp(buffer, { failOn: 'error', limitInputPixels: OCR_MAX_PIXELS }).rotate();
  const metadata = await image.metadata();
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > OCR_MAX_PIXELS) {
    throw new Error('The image dimensions are not supported.');
  }
  const normalized = await image.resize({ width: 2600, height: 2000, fit: 'inside', withoutEnlargement: true }).png().toBuffer();
  const size = await sharp(normalized).metadata();
  return { buffer: normalized, width: size.width, height: size.height };
}

async function renderPdf(buffer) {
  globalThis.DOMMatrix ||= DOMMatrix;
  globalThis.ImageData ||= ImageData;
  globalThis.Path2D ||= Path2D;
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false }).promise;
  if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) {
    await pdf.destroy();
    throw new Error('Use a PDF with one or two pages for the Aadhaar sides.');
  }

  const pages = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const initial = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 2600 / initial.width, 2000 / initial.height);
      const viewport = page.getViewport({ scale });
      const width = Math.ceil(viewport.width);
      const height = Math.ceil(viewport.height);
      if (width * height > OCR_MAX_PIXELS) throw new Error('The PDF page dimensions are not supported.');
      const canvas = createCanvas(width, height);
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      pages.push({ buffer: canvas.toBuffer('image/png'), width, height });
      page.cleanup();
    }
  } finally {
    await pdf.destroy();
  }
  return pages;
}

function parseTsv(tsv) {
  const lines = String(tsv || '').split(/\r?\n/);
  const words = [];
  for (const line of lines.slice(1)) {
    const cols = line.split('\t');
    if (cols.length < 12 || cols[0] !== '5' || !cols[11]?.trim()) continue;
    words.push({
      block: cols[2], paragraph: cols[3], line: cols[4],
      left: Number(cols[6]), top: Number(cols[7]), width: Number(cols[8]), height: Number(cols[9]),
      confidence: Number(cols[10]), text: cols.slice(11).join('\t').trim(),
    });
  }
  return words;
}

function numberGroups(words) {
  const lines = new Map();
  for (const word of words) {
    const key = `${word.block}:${word.paragraph}:${word.line}`;
    if (!lines.has(key)) lines.set(key, []);
    lines.get(key).push(word);
  }
  const groups = [];
  for (const lineWords of lines.values()) {
    lineWords.sort((a, b) => a.left - b.left);
    for (let start = 0; start < lineWords.length; start += 1) {
      let digits = '';
      const boxes = [];
      for (let end = start; end < Math.min(lineWords.length, start + 5); end += 1) {
        const word = lineWords[end];
        if (end > start && word.left - (lineWords[end - 1].left + lineWords[end - 1].width) > 90) break;
        const token = word.text.replace(/\s/g, '');
        if (!/^\d{1,12}$/.test(token)) break;
        digits += token;
        boxes.push(word);
        if (digits.length === 12) {
          if (/^[2-9]\d{11}$/.test(digits)) groups.push({ number: digits, boxes: [...boxes] });
          break;
        }
        if (digits.length > 12) break;
      }
    }
  }
  return groups;
}

function maskBoxes(sourceBuffer, boxes, width, height, qrLocation) {
  const rectangles = [];
  for (const box of boxes) {
    const left = Math.max(0, box.left - 6);
    const top = Math.max(0, box.top - 5);
    const rectWidth = Math.min(width - left, box.width + 12);
    const rectHeight = Math.min(height - top, box.height + 10);
    rectangles.push(`<rect x="${left}" y="${top}" width="${rectWidth}" height="${rectHeight}" fill="#000"/>`);
  }
  if (qrLocation) {
    const points = [qrLocation.topLeft, qrLocation.topRight, qrLocation.bottomLeft, qrLocation.bottomRight].filter(Boolean);
    if (points.length) {
      const left = Math.max(0, Math.floor(Math.min(...points.map((point) => point.x)) - 10));
      const top = Math.max(0, Math.floor(Math.min(...points.map((point) => point.y)) - 10));
      const right = Math.min(width, Math.ceil(Math.max(...points.map((point) => point.x)) + 10));
      const bottom = Math.min(height, Math.ceil(Math.max(...points.map((point) => point.y)) + 10));
      rectangles.push(`<rect x="${left}" y="${top}" width="${right - left}" height="${bottom - top}" fill="#000"/>`);
    }
  }
  if (!rectangles.length) return null;
  const svg = Buffer.from(`<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">${rectangles.join('')}</svg>`);
  return sharp(sourceBuffer).composite([{ input: svg }]).png().toBuffer();
}

async function detectQr(buffer) {
  const image = await loadImage(buffer);
  const width = image.width;
  const height = image.height;
  const canvas = createCanvas(width, height);
  const context = canvas.getContext('2d');
  context.drawImage(image, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  const result = jsQR(pixels.data, width, height, { inversionAttempts: 'attemptBoth' });
  return result?.location || null;
}

function normalizeDate(text) {
  const match = String(text).match(/(?:dob|date\s+of\s+birth|birth)\s*[:\-]?\s*(\d{1,2}[./-]\d{1,2}[./-]\d{4}|\d{4})/i);
  if (!match) return '';
  if (/^\d{4}$/.test(match[1])) return '';
  const parts = match[1].split(/[./-]/).map(Number);
  const [day, month, year] = parts[0] > 12 ? parts : [parts[1], parts[0], parts[2]];
  if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return '';
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function extractFields(text, aadhaarNumber) {
  const lines = String(text || '').split(/\r?\n/).map((line) => line.replace(/\s+/g, ' ').trim()).filter(Boolean);
  const cleaned = lines.map((line) => line.replace(/[^\p{L}\s.'-]/gu, '').trim()).filter((line) => line && !KNOWN_LABELS.test(line) && !/\b(government|unique identification|authority of india|aadhaar|aadhar|uidai)\b/i.test(line));
  const genderLine = lines.find((line) => /\b(female|male|transgender)\b/i.test(line)) || '';
  const genderMatch = genderLine.match(/\b(female|male|transgender)\b/i)?.[1]?.toLowerCase();
  const dobLine = lines.find((line) => /\b(dob|date\s+of\s+birth|birth)\b/i.test(line)) || '';
  const addressIndex = lines.findIndex((line) => /^address\b/i.test(line));
  const addressLines = addressIndex < 0 ? [] : lines.slice(addressIndex, addressIndex + 5)
    .map((line) => line.replace(/^address\s*[:\-]?\s*/i, '').trim())
    .filter((line) => line && !/\b(?:dob|female|male|aadhaar|uidai)\b/i.test(line));
  const name = cleaned.find((line) => line.split(/\s+/).length >= 2 && line.length <= 80 && !/\d/.test(line)) || '';
  return {
    full_name: name,
    date_of_birth: normalizeDate(dobLine),
    gender: genderMatch === 'female' ? 'female' : genderMatch === 'male' ? 'male' : 'undisclosed',
    address: addressLines.join(', ').slice(0, 500),
    aadhaar_number: aadhaarNumber || '',
    aadhaar_last4: aadhaarNumber?.slice(-4) || '',
  };
}

async function recognize(worker, page) {
  const { data } = await worker.recognize(page.buffer, {}, { text: true, tsv: true });
  const words = parseTsv(data.tsv);
  return { text: data.text || '', words, numbers: numberGroups(words) };
}

async function extractAndRedact(buffer, mimetype) {
  if (!Buffer.isBuffer(buffer) || !validFileSignature(buffer, mimetype)) {
    const error = new Error('The file content does not match a supported image or PDF type.');
    error.status = 422;
    error.code = 'AADHAAR_FILE_INVALID';
    throw error;
  }
  const pages = mimetype === 'application/pdf' ? await renderPdf(buffer) : [await normalizeImage(buffer)];
  const worker = await createWorker('eng', 1, {
    logger: () => {},
    errorHandler: () => {},
  });
  try {
    const ocrPages = [];
    for (const page of pages) ocrPages.push(await recognize(worker, page));
    const numberCandidates = ocrPages.flatMap((page) => page.numbers.map((candidate) => candidate.number));
    const aadhaarNumber = numberCandidates.sort((a, b) => numberCandidates.filter((item) => item === b).length - numberCandidates.filter((item) => item === a).length)[0] || '';
    const extractedText = ocrPages.map((page) => page.text).join('\n');
    const fields = extractFields(extractedText, aadhaarNumber);
    const redactedPages = [];
    let redactionConfirmed = false;
    for (let index = 0; index < pages.length; index += 1) {
      const page = pages[index];
      const recognized = ocrPages[index];
      const qrLocation = await detectQr(page.buffer);
      const groups = recognized.numbers;
      const boxes = groups.flatMap((group) => group.boxes);
      if (!boxes.length && !qrLocation) {
        redactedPages.push(null);
        continue;
      }
      const redacted = await maskBoxes(page.buffer, boxes, page.width, page.height, qrLocation);
      const verify = await recognize(worker, { ...page, buffer: redacted });
      const digitsRemaining = verify.numbers.some((candidate) => candidate.number === aadhaarNumber && aadhaarNumber);
      if (digitsRemaining) {
        redactedPages.push(null);
        continue;
      }
      redactedPages.push(redacted);
      redactionConfirmed = true;
    }
    const documentsReady = Boolean(aadhaarNumber) && redactionConfirmed && redactedPages.every(Boolean);
    return {
      fields,
      redacted_pages: documentsReady ? redactedPages : [],
      documents_ready: documentsReady,
      warning_code: documentsReady ? null : 'AADHAAR_REDACTION_UNCONFIRMED',
    };
  } finally {
    await worker.terminate();
    for (const page of pages) page.buffer.fill(0);
  }
}

module.exports = { extractAndRedact, validFileSignature, parseTsv, numberGroups, normalizeDate, extractFields };
