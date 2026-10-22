/**
 * Supplier quotation scanning — page image preprocessing.
 *
 * A VERBATIM COPY of the preprocessing the CRM's goods-receiving scanner uses
 * (src/components/suppliers/DeliveryModal.jsx, lines 34-146), lifted into its
 * own module so the quotation window can scan documents without touching that
 * file.
 *
 * WHY A COPY AND NOT AN IMPORT
 *   These functions are declared inside DeliveryModal.jsx and are not
 *   exported. Importing them would mean editing that file, which is explicitly
 *   out of bounds — the goods-receiving scanner must keep working exactly as it
 *   does today. The original is itself already a port from Revach Plus (see its
 *   own comment), so duplication is the established pattern here rather than a
 *   new compromise.
 *
 * WHY IT MUST STAY BYTE-IDENTICAL
 *   This pixel maths IS the extraction accuracy. The 2048px long edge, the
 *   grayscale weights, the 64-pixel adaptive-contrast blocks with their
 *   `range < 30` skip, the 5-point sharpen kernel and the 0.92 JPEG quality are
 *   what the Gemini prompt was tuned against on real Hebrew supplier
 *   documents. "Improving" any constant here changes what the model reads.
 *   A test asserts this file's function bodies still match the original's.
 *
 * The only additions are the `export` keywords and this header.
 */

// ── Image preprocessing (ported from Revach Plus) ────────────────────────────
// Grayscale + adaptive contrast + sharpen before sending to Gemini.
// Falls back to the raw file if any step fails.

export const MAX_EDGE = 2048;

export function loadImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = reader.result.split(",")[1];
      const mimeType = file.type || "image/jpeg";
      resolve({ base64, mimeType });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function preprocessImage(file) {
  if (file.type === "application/pdf") return fileToBase64(file);

  try {
    const img = await loadImage(file);

    let w = img.naturalWidth;
    let h = img.naturalHeight;
    if (Math.max(w, h) > MAX_EDGE) {
      const scale = MAX_EDGE / Math.max(w, h);
      w = Math.round(w * scale);
      h = Math.round(h * scale);
    }

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    URL.revokeObjectURL(img.src);

    const imageData = ctx.getImageData(0, 0, w, h);
    const pixels = imageData.data;

    for (let i = 0; i < pixels.length; i += 4) {
      const gray = Math.round(pixels[i] * 0.299 + pixels[i + 1] * 0.587 + pixels[i + 2] * 0.114);
      pixels[i] = gray;
      pixels[i + 1] = gray;
      pixels[i + 2] = gray;
    }

    const blockSize = 64;
    for (let by = 0; by < h; by += blockSize) {
      for (let bx = 0; bx < w; bx += blockSize) {
        const bw = Math.min(blockSize, w - bx);
        const bh = Math.min(blockSize, h - by);
        let lo = 255, hi = 0;
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const v = pixels[(y * w + x) * 4];
            if (v < lo) lo = v;
            if (v > hi) hi = v;
          }
        }
        const range = hi - lo;
        if (range < 30) continue;
        const scale = 255 / range;
        for (let y = by; y < by + bh; y++) {
          for (let x = bx; x < bx + bw; x++) {
            const idx = (y * w + x) * 4;
            const v = Math.min(255, Math.max(0, Math.round((pixels[idx] - lo) * scale)));
            pixels[idx] = v;
            pixels[idx + 1] = v;
            pixels[idx + 2] = v;
          }
        }
      }
    }

    const src = new Uint8ClampedArray(pixels);
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = (y * w + x) * 4;
        const v = 5 * src[idx]
          - src[((y - 1) * w + x) * 4]
          - src[((y + 1) * w + x) * 4]
          - src[(y * w + x - 1) * 4]
          - src[(y * w + x + 1) * 4];
        const clamped = Math.min(255, Math.max(0, v));
        pixels[idx] = clamped;
        pixels[idx + 1] = clamped;
        pixels[idx + 2] = clamped;
      }
    }

    ctx.putImageData(imageData, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
    const base64 = dataUrl.split(",")[1];
    return { base64, mimeType: "image/jpeg" };
  } catch (err) {
    console.warn("[preprocess] failed, using original:", err);
    return fileToBase64(file);
  }
}


// ── Multi-page limits and user-facing errors ─────────────────────────────────
// Copied from DeliveryModal.jsx lines 255-262. MAX_PAGES matches the Edge
// Function's own ceiling, and the Hebrew strings are the proven wording for the
// one failure a user can actually act on: a document too long to read in one
// pass.
export const MAX_PAGES = 10;

export const EXTRACTION_ERRORS = {
  extraction_incomplete:
    "המסמך ארוך מדי והחילוץ נקטע — לא כל המוצרים זוהו. צלם את המסמך בכמה עמודים נפרדים ונסה שוב.",
  too_many_pages: `ניתן לצרף עד ${10} עמודים למסמך אחד.`,
};
