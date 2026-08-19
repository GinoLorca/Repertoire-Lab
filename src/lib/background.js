// Custom page background.
//
// Unlike opening artwork this isn't square and isn't a thumbnail — it's a wide
// image sitting behind the whole app, so the job is to get it small enough to
// live in local storage without looking soft on a Retina iPad.

const MAX_BYTES = 12 * 1024 * 1024; // what we'll accept off disk
const MAX_EDGE = 2560; // what we keep — plenty for a 13" iPad at 2x
const TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Validates and downscales, returning a data URL. Always re-encodes as JPEG:
// a photographic background as PNG runs to tens of megabytes, and every byte
// here is carried in the backup file too.
export function processBackground(file) {
  return new Promise((resolve, reject) => {
    if (!TYPES.includes(file.type)) {
      reject(new Error('Background must be a JPG, PNG, GIF or WebP file.'));
      return;
    }
    if (file.size > MAX_BYTES) {
      reject(new Error('Background must be 12 MB or smaller.'));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const { naturalWidth: w, naturalHeight: h } = img;
      if (!w || !h) {
        reject(new Error('Could not read that image file.'));
        return;
      }
      const scale = Math.min(1, MAX_EDGE / Math.max(w, h));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image file.'));
    };
    img.src = url;
  });
}
