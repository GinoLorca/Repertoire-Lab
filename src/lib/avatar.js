// Profile-photo pipeline — deliberately looser than the opening-artwork one
// (lib/artwork.js): a coach dropping in a phone snapshot of a student
// shouldn't be rejected for not being a pre-cropped 650×650 square. Any
// image gets center-cropped to a square and downscaled, never rejected for
// its shape or size.

const MAX_BYTES = 8 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const OUT_SIZE = 240;

function renderSquare(img, size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = (img.naturalWidth - side) / 2;
  const sy = (img.naturalHeight - side) / 2;
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  return canvas.toDataURL('image/jpeg', 0.88);
}

// Resolves to a single square data URL, or rejects with a user-readable error.
export function processPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!TYPES.includes(file.type)) {
      reject(new Error('Use a JPG, PNG, GIF or WEBP photo.'));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error('That photo is over 8 MB — try a smaller one.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(renderSquare(img, OUT_SIZE));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}
