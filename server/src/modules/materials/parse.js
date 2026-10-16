/**
 * Document parsing: file bytes -> plain text.
 *
 * Design note: PDF support is OPTIONAL and lazily imported. Shipping a hard
 * dependency on a heavy PDF library would make `npm install` fragile, and most
 * demo material is text/markdown anyway. If the library is missing we return a
 * clear, actionable error instead of crashing the server at boot.
 */

/** Decode an uploaded buffer to a UTF-8 string. */
export function parseText(buffer) {
  return buffer.toString('utf8');
}

/**
 * Extract text from a PDF using `pdf-parse` if it happens to be installed.
 * To enable: `npm i pdf-parse`.
 */
export async function parsePdf(buffer) {
  try {
    const mod = await import('pdf-parse');
    const pdfParse = mod.default ?? mod;
    const result = await pdfParse(buffer);
    return result.text;
  } catch (err) {
    throw new Error(
      'PDF parsing is unavailable. Install it with `npm i pdf-parse`, or upload .txt/.md instead. ' +
        `Original error: ${err.message}`,
    );
  }
}

/**
 * Route a file to the right parser based on mime type / extension.
 * @returns {Promise<string>} extracted plain text
 */
export async function extractText({ buffer, mimetype, filename }) {
  const name = (filename ?? '').toLowerCase();
  if (mimetype === 'application/pdf' || name.endsWith('.pdf')) {
    return parsePdf(buffer);
  }
  // Everything else is treated as text (txt, md, csv, code, etc.).
  return parseText(buffer);
}
