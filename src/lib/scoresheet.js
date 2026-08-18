// A photo of a handwritten scoresheet, attached straight to a game record —
// just for reference (there's no OCR here, see components/ScoresheetPhoto.jsx
// and lib/avatar.js for that distinction). Unlike an avatar this keeps its
// own aspect ratio rather than center-cropping to a square, since cropping a
// page of notation would cut moves off.

const MAX_BYTES = 12 * 1024 * 1024; // a phone photo straight from the camera
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_DIM = 1600; // long edge — plenty to read handwriting back later

function renderScaled(img) {
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d').drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.85);
}

// Resolves to a single scaled-down data URL, or rejects with a user-readable error.
export function processScoresheetPhoto(file) {
  return new Promise((resolve, reject) => {
    if (!TYPES.includes(file.type)) {
      reject(new Error('Use a JPG, PNG or WEBP photo.'));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error('That photo is over 12 MB — try a smaller one.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(renderScaled(img));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}
