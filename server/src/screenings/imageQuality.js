const sharp = require('sharp');

const MIN_IMAGE_PIXELS = 400 * 300;

const mimeSignatures = [
  { mime: 'image/jpeg', matches: (buffer) => buffer[0] === 0xff && buffer[1] === 0xd8 },
  {
    mime: 'image/png',
    matches: (buffer) =>
      buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mime: 'image/webp',
    matches: (buffer) =>
      buffer.length >= 12 &&
      buffer.toString('ascii', 0, 4) === 'RIFF' &&
      buffer.toString('ascii', 8, 12) === 'WEBP',
  },
];

function assertImageSignature(buffer, declaredMime) {
  const detected = mimeSignatures.find((signature) => signature.matches(buffer))?.mime;
  if (!detected || detected !== declaredMime) {
    const error = new Error('Image content does not match an allowed image type');
    error.status = 422;
    error.code = 'INVALID_IMAGE_CONTENT';
    throw error;
  }
  return detected;
}

function laplacianVariance(pixels, width, height, channels) {
  const values = [];
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const current = pixels[(y * width + x) * channels];
      const left = pixels[(y * width + x - 1) * channels];
      const right = pixels[(y * width + x + 1) * channels];
      const top = pixels[((y - 1) * width + x) * channels];
      const bottom = pixels[((y + 1) * width + x) * channels];
      values.push(left + right + top + bottom - 4 * current);
    }
  }
  if (!values.length) return 0;
  const mean = values.reduce((total, value) => total + value, 0) / values.length;
  return values.reduce((total, value) => total + (value - mean) ** 2, 0) / values.length;
}

function qualityNotes({ width, height, darkPixelRatio, brightPixelRatio, sharpness }) {
  const notes = [];
  if (width * height < MIN_IMAGE_PIXELS) notes.push('too small');
  if (sharpness < 35) notes.push('blurry');
  if (darkPixelRatio >= 0.75) notes.push('too dark');
  if (brightPixelRatio >= 0.75) notes.push('too bright');
  return notes;
}

async function prepareImage(buffer, declaredMime) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) {
    const error = new Error('The image file is empty or incomplete');
    error.status = 422;
    error.code = 'INVALID_IMAGE_CONTENT';
    throw error;
  }
  const mimeType = assertImageSignature(buffer, declaredMime);
  let sanitized;
  let info;
  let grayscale;
  let grayscaleInfo;
  try {
    const input = sharp(buffer, { limitInputPixels: 40_000_000, failOn: 'error' }).rotate();
    const { width: inputWidth, height: inputHeight } = await input.metadata();
    if (!inputWidth || !inputHeight) {
      const error = new Error('The image dimensions could not be read');
      error.status = 422;
      error.code = 'INVALID_IMAGE_CONTENT';
      throw error;
    }

    const sanitizedPipeline = sharp(buffer, {
      limitInputPixels: 40_000_000,
      failOn: 'error',
    }).rotate();
    if (mimeType === 'image/jpeg') sanitizedPipeline.jpeg({ quality: 90 });
    if (mimeType === 'image/png') sanitizedPipeline.png({ compressionLevel: 8 });
    if (mimeType === 'image/webp') sanitizedPipeline.webp({ quality: 90 });
    ({ data: sanitized, info } = await sanitizedPipeline.toBuffer({ resolveWithObject: true }));

    ({ data: grayscale, info: grayscaleInfo } = await sharp(sanitized)
      .greyscale()
      .resize({
        width: Math.min(info.width, 256),
        height: Math.min(info.height, 256),
        fit: 'inside',
      })
      .raw()
      .toBuffer({ resolveWithObject: true }));
  } catch (cause) {
    if (cause.status === 422) throw cause;
    const error = new Error('The image is damaged or could not be processed');
    error.status = 422;
    error.code = 'INVALID_IMAGE_CONTENT';
    error.cause = cause;
    throw error;
  }
  const pixels = grayscaleInfo.width * grayscaleInfo.height;
  let darkPixels = 0;
  let brightPixels = 0;
  for (const value of grayscale) {
    if (value < 45) darkPixels += 1;
    if (value > 220) brightPixels += 1;
  }
  const darkPixelRatio = darkPixels / pixels;
  const brightPixelRatio = brightPixels / pixels;
  const sharpness = laplacianVariance(
    grayscale,
    grayscaleInfo.width,
    grayscaleInfo.height,
    grayscaleInfo.channels,
  );
  const notes = qualityNotes({
    width: info.width,
    height: info.height,
    darkPixelRatio,
    brightPixelRatio,
    sharpness,
  });
  const resolutionScore = Math.min(1, (info.width * info.height) / MIN_IMAGE_PIXELS);
  const brightnessScore = darkPixelRatio >= 0.75 || brightPixelRatio >= 0.75 ? 0.2 : 1;
  const sharpnessScore = Math.min(1, sharpness / 180);
  const score = Math.max(
    0,
    Math.min(
      1,
      0.35 * resolutionScore + 0.35 * sharpnessScore + 0.3 * brightnessScore,
    ),
  );

  return {
    buffer: sanitized,
    mimeType,
    width: info.width,
    height: info.height,
    sharpness: Number(sharpness.toFixed(2)),
    qualityScore: Number(score.toFixed(4)),
    qualityNotes: notes,
  };
}

module.exports = { prepareImage, assertImageSignature, laplacianVariance };
