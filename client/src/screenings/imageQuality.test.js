import { afterEach, describe, expect, it, vi } from 'vitest';
import { inspectImage } from './imageQuality.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('inspectImage resolution checks', () => {
  it('does not flag a portrait image whose pixel count meets the minimum', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 600,
      height: 800,
      close: vi.fn(),
    })));
    vi.spyOn(document, 'createElement').mockReturnValue({
      set width(_value) {},
      set height(_value) {},
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({
          data: new Uint8ClampedArray(128 * 128 * 4).fill(100),
        }),
      }),
    });

    const result = await inspectImage(new File(['image'], 'portrait.jpg', { type: 'image/jpeg' }));

    expect(result.width).toBe(600);
    expect(result.height).toBe(800);
    expect(result.notes).not.toContain('too_small');
  });

  it('continues to flag images below the minimum pixel count', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 300,
      height: 200,
      close: vi.fn(),
    })));
    vi.spyOn(document, 'createElement').mockReturnValue({
      set width(_value) {},
      set height(_value) {},
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({
          data: new Uint8ClampedArray(96 * 64 * 4).fill(100),
        }),
      }),
    });

    const result = await inspectImage(new File(['image'], 'small.jpg', { type: 'image/jpeg' }));

    expect(result.notes).toContain('too_small');
  });

  it('does not call an image dark when only a smaller region is dark', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 800,
      height: 600,
      close: vi.fn(),
    })));
    vi.spyOn(document, 'createElement').mockReturnValue({
      set width(_value) {},
      set height(_value) {},
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => {
          const data = new Uint8ClampedArray(128 * 96 * 4);
          for (let index = 0; index < data.length; index += 4) {
            const pixelIndex = index / 4;
            const isDarkRegion = pixelIndex % 4 === 0;
            const value = isDarkRegion ? 25 : 180;
            data[index] = value;
            data[index + 1] = value;
            data[index + 2] = value;
            data[index + 3] = 255;
          }
          return { data };
        },
      }),
    });

    const result = await inspectImage(new File(['image'], 'mixed.jpg', { type: 'image/jpeg' }));

    expect(result.notes).not.toContain('too_dark');
  });

  it('continues to flag consistently underexposed images', async () => {
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({
      width: 800,
      height: 600,
      close: vi.fn(),
    })));
    vi.spyOn(document, 'createElement').mockReturnValue({
      set width(_value) {},
      set height(_value) {},
      getContext: () => ({
        drawImage: vi.fn(),
        getImageData: () => ({
          data: new Uint8ClampedArray(128 * 96 * 4).fill(25),
        }),
      }),
    });

    const result = await inspectImage(new File(['image'], 'dark.jpg', { type: 'image/jpeg' }));

    expect(result.notes).toContain('too_dark');
  });
});
