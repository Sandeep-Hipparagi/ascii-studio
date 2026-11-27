/**
 * Procedural Studio Sample Canvas Generators.
 * Shared across `useAsciiEngine` and `/styles` thumbnail previews so cards
 * and workspace render identical clean-room test artwork.
 */

export type SamplePresetId = 'calibration' | 'rings' | 'prism';

export const REALTIME_STYLE_SAMPLE_PATHS: Readonly<Record<string, string>> = {
  'classic-density': '/samples/golden-lotus.jpg',
  'sobel-edge': '/samples/luminous-butterfly.jpg',
  'bayer-dither': '/samples/prism-flower.jpg',
  'braille-highres': '/samples/cosmic-bloom.jpg',
};

const styleSampleCache = new Map<string, Promise<HTMLImageElement | null>>();

/**
 * Asynchronously loads and caches the reference JPG assigned to a Real-Time
 * style with `crossOrigin = 'anonymous'` so `getImageData()` never taints the canvas.
 */
export function loadStyleSampleImage(styleId: string): Promise<HTMLImageElement | null> {
  if (typeof window === 'undefined') return Promise.resolve(null);
  const src = REALTIME_STYLE_SAMPLE_PATHS[styleId];
  if (!src) return Promise.resolve(null);

  const cached = styleSampleCache.get(src);
  if (cached) return cached;

  const promise = new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode === 'function') {
        void img.decode().catch(() => {}).finally(() => resolve(img));
      } else {
        resolve(img);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });

  styleSampleCache.set(src, promise);
  return promise;
}

export function createProceduralSampleCanvas(
  presetId: SamplePresetId,
  width = 640,
  height = 480
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  const scaleX = width / 640;
  const scaleY = height / 480;
  ctx.save();
  ctx.scale(scaleX, scaleY);

  const w = 640;
  const h = 480;

  ctx.fillStyle = '#07090d';
  ctx.fillRect(0, 0, w, h);

  if (presetId === 'rings') {
    for (let r = 240; r >= 24; r -= 22) {
      const t = 1 - r / 240;
      const hue = Math.round(180 + t * 140);
      ctx.strokeStyle = `hsl(${hue}, 85%, ${35 + t * 40}%)`;
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(w * 0.5, h * 0.5, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    const rad = ctx.createRadialGradient(w * 0.42, h * 0.38, 8, w * 0.5, h * 0.5, 130);
    rad.addColorStop(0, '#ffffff');
    rad.addColorStop(0.5, '#38bdf8');
    rad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = rad;
    ctx.beginPath();
    ctx.arc(w * 0.5, h * 0.5, 130, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    return canvas;
  }

  if (presetId === 'prism') {
    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, '#0f172a');
    bg.addColorStop(0.5, '#1e1b4b');
    bg.addColorStop(1, '#09090b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.14);
    ctx.lineTo(w * 0.78, h * 0.78);
    ctx.lineTo(w * 0.22, h * 0.78);
    ctx.closePath();
    ctx.stroke();

    const grad = ctx.createLinearGradient(w * 0.5, h * 0.14, w * 0.5, h * 0.78);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#22d3ee');
    grad.addColorStop(0.7, '#a855f7');
    grad.addColorStop(1, '#f43f5e');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
    return canvas;
  }

  // Default: Rich borderless Nebula Sculpture studio showcase (zero outer frame)
  const bg = ctx.createRadialGradient(w * 0.52, h * 0.48, 24, w * 0.5, h * 0.5, w * 0.68);
  bg.addColorStop(0, '#0f172a');
  bg.addColorStop(0.55, '#070b18');
  bg.addColorStop(1, '#020308');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  const plumeCyan = ctx.createRadialGradient(w * 0.28, h * 0.34, 10, w * 0.3, h * 0.36, 250);
  plumeCyan.addColorStop(0, 'rgba(56, 189, 248, 0.72)');
  plumeCyan.addColorStop(0.45, 'rgba(37, 99, 235, 0.34)');
  plumeCyan.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = plumeCyan;
  ctx.fillRect(0, 0, w, h);

  const plumeMagenta = ctx.createRadialGradient(w * 0.72, h * 0.64, 12, w * 0.7, h * 0.62, 240);
  plumeMagenta.addColorStop(0, 'rgba(244, 63, 94, 0.65)');
  plumeMagenta.addColorStop(0.45, 'rgba(168, 85, 247, 0.3)');
  plumeMagenta.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = plumeMagenta;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.34);
  const ringGrad = ctx.createLinearGradient(-230, 0, 230, 0);
  ringGrad.addColorStop(0, 'rgba(56, 189, 248, 0.15)');
  ringGrad.addColorStop(0.35, 'rgba(125, 211, 252, 0.92)');
  ringGrad.addColorStop(0.65, 'rgba(251, 191, 36, 0.88)');
  ringGrad.addColorStop(1, 'rgba(244, 63, 94, 0.18)');
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 0, 225, 58, 0, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  const sphere = ctx.createRadialGradient(w * 0.42, h * 0.39, 10, w * 0.5, h * 0.5, 146);
  sphere.addColorStop(0, '#ffffff');
  sphere.addColorStop(0.24, '#bae6fd');
  sphere.addColorStop(0.55, '#3b82f6');
  sphere.addColorStop(0.84, '#4c1d95');
  sphere.addColorStop(1, '#090d1a');
  ctx.fillStyle = sphere;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, 144, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(251, 146, 60, 0.85)';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(w * 0.5, h * 0.5, 142, 0.12, 1.35);
  ctx.stroke();

  ctx.save();
  ctx.translate(w * 0.5, h * 0.5);
  ctx.rotate(-0.34);
  ctx.strokeStyle = ringGrad;
  ctx.lineWidth = 14;
  ctx.beginPath();
  ctx.ellipse(0, 0, 225, 58, 0, 0, Math.PI);
  ctx.stroke();
  ctx.restore();

  ctx.restore();
  return canvas;
}
