// Opening artwork pipeline.
// Input rules: 1:1 aspect ratio, min 650×650 px, max 3 MB, JPG / PNG / GIF.
// Outputs: medium 650×650 and small 90×90 (center-cropped, canvas-rendered).

const MIN_SIZE = 650;
const MAX_BYTES = 3 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/gif'];
const ASPECT_TOLERANCE = 0.02; // 2% slack for off-by-a-pixel exports

function renderSquare(img, size, mimeType) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  // JPEG sources re-encode as JPEG (much smaller); PNG/GIF keep PNG.
  return mimeType === 'image/jpeg'
    ? canvas.toDataURL('image/jpeg', 0.87)
    : canvas.toDataURL('image/png');
}

// Validates the file and returns { medium, small } data URLs, or rejects
// with a user-readable error.
export function processArtwork(file) {
  return new Promise((resolve, reject) => {
    if (!TYPES.includes(file.type)) {
      reject(new Error('Artwork must be a JPG, PNG or GIF file.'));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error('Artwork must be 3 MB or smaller.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < MIN_SIZE || h < MIN_SIZE) {
        reject(new Error(`Artwork must be at least ${MIN_SIZE}×${MIN_SIZE} px (this one is ${w}×${h}).`));
        return;
      }
      if (Math.abs(w - h) > Math.max(w, h) * ASPECT_TOLERANCE) {
        reject(new Error(`Artwork must be square (1:1) — this one is ${w}×${h}.`));
        return;
      }
      resolve({
        medium: renderSquare(img, 650, file.type),
        small: renderSquare(img, 90, file.type),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}
