const MIN_IMAGE_PIXELS = 400 * 300;

export async function inspectImage(file) {
  const notes = [];
  let score = 1;
  if (file.size > 8 * 1024 * 1024) {
    return { score: 0, notes: ['too_large'], width: 0, height: 0 };
  }
  if (!file.type.startsWith('image/')) {
    return { score: 0, notes: ['invalid_type'], width: 0, height: 0 };
  }
  try {
    const image = await createImageBitmap(file);
    const width = image.width;
    const height = image.height;
    if (width * height < MIN_IMAGE_PIXELS) {
      notes.push('too_small');
      score -= 0.6;
    }
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, 128 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Image analysis canvas is unavailable');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    const luminance = [];
    for (let index = 0; index < data.length; index += 4) {
      luminance.push(
        0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2],
      );
    }
    const darkPixelRatio =
      luminance.filter((pixel) => pixel < 45).length / luminance.length;
    const brightPixelRatio =
      luminance.filter((pixel) => pixel > 220).length / luminance.length;
    if (darkPixelRatio >= 0.75) {
      notes.push('too_dark');
      score -= 0.35;
    } else if (brightPixelRatio >= 0.75) {
      notes.push('too_bright');
      score -= 0.25;
    }
    let laplacianTotal = 0;
    let samples = 0;
    for (let y = 1; y < canvas.height - 1; y += 1) {
      for (let x = 1; x < canvas.width - 1; x += 1) {
        const index = y * canvas.width + x;
        const laplacian =
          4 * luminance[index] -
          luminance[index - 1] -
          luminance[index + 1] -
          luminance[index - canvas.width] -
          luminance[index + canvas.width];
        laplacianTotal += laplacian ** 2;
        samples += 1;
      }
    }
    const sharpness = samples ? laplacianTotal / samples : 0;
    if (sharpness < 35) {
      notes.push('blurry');
      score -= 0.35;
    }
    return { score: Math.max(0, score), notes, width, height };
  } catch {
    return { score: 0, notes: ['invalid_type'], width: 0, height: 0 };
  }
}
