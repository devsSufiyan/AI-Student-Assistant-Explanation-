/**
 * Document parsing: uploaded bytes -> plain text for the RAG index.
 *
 * SUPPORTED
 *   text-like   .txt .md .markdown .csv .tsv .json .xml .yml .log .js .py ...
 *   web         .html .htm                      (tags stripped)
 *   rich text   .rtf                            (control words stripped)
 *   pdf         .pdf                            (via optional `pdf-parse`)
 *   office zip  .docx .pptx .xlsx .odt .odp .ods (via our own ZIP reader)
 *
 * WHY NO PER-FORMAT DEPENDENCIES
 *   The Office formats are ZIP archives of XML. We already ship a tiny ZIP
 *   reader (zip.js), so extracting their text is a couple of regex passes rather
 *   than four libraries. That keeps `npm install` reliable and works offline.
 *
 * FAILURE POLICY
 *   Extraction failure must be EXPLICIT. We never write binary garbage into the
 *   RAG index: if we cannot find real text, we throw an error that names the
 *   format, so the upload route can mark the material `failed` with a fixable
 *   message instead of silently indexing noise.
 */

import { isZip, readZipEntries, readZipText } from './zip.js';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Lowercased file extension without the dot ('' when there is none). */
export function extOf(filename = '') {
  const m = String(filename).toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : '';
}

/** Decode the XML/HTML entity set that actually appears in Office and web files. */
export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    // &amp; must be decoded LAST or we would double-decode "&amp;lt;".
    .replace(/&amp;/g, '&');
}

/** Collapse the ragged whitespace that XML stripping leaves behind. */
function tidy(text) {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/**
 * Guard against indexing binary noise (e.g. someone uploads a .jpg renamed to
 * .txt). Replacement characters and NULs are the reliable tell.
 */
function assertSensibleText(text, label) {
  const sample = text.slice(0, 4000);
  if (sample.length === 0) return;
  const bad = (sample.match(/[\u0000\uFFFD]/g) ?? []).length;
  if (bad / sample.length > 0.02) {
    throw new Error(
      `"${label}" looks like a binary file, not a document. Upload a text, PDF, or Office file.`,
    );
  }
}

/**
 * Strip XML/HTML tags while preserving line structure.
 * Block-level close tags become newlines, and table cells become tabs, so
 * spreadsheets and slides stay readable once flattened to text.
 */
function stripMarkup(xml, { blockTags = [], cellTags = [] } = {}) {
  let text = String(xml);
  text = text.replace(/<\?[\s\S]*?\?>/g, ' '); // XML declarations
  text = text.replace(/<!--[\s\S]*?-->/g, ' '); // comments
  text = text.replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' '); // embedded code

  for (const tag of blockTags) {
    text = text.replace(new RegExp(`</(?:\\w+:)?${tag}\\s*>`, 'gi'), '\n');
  }
  for (const tag of cellTags) {
    text = text.replace(new RegExp(`</(?:\\w+:)?${tag}\\s*>`, 'gi'), '\t');
  }
  // Self-closing line breaks.
  text = text.replace(/<(?:w:br|a:br|br)\s*\/?>/gi, '\n');

  text = text.replace(/<[^>]+>/g, '');
  return tidy(decodeEntities(text));
}

// ---------------------------------------------------------------------------
// Format parsers
// ---------------------------------------------------------------------------

export function parseText(buffer) {
  return tidy(buffer.toString('utf8'));
}

export function parseHtml(buffer) {
  return stripMarkup(buffer.toString('utf8'), {
    blockTags: ['p', 'div', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'tr', 'section', 'article'],
    cellTags: ['td', 'th'],
  });
}

/** RTF: drop control words and groups, keep the literal text runs. */
export function parseRtf(buffer) {
  let text = buffer.toString('latin1');
  text = text.replace(/\\'[0-9a-f]{2}/gi, ' '); // hex escapes
  text = text.replace(/\\[a-z]+-?\d*\s?/gi, ' '); // control words
  text = text.replace(/[{}]/g, ' ');
  return tidy(text);
}

/** PDF via the optional `pdf-parse` dependency, loaded only when needed. */
export async function parsePdf(buffer) {
  try {
    const mod = await import('pdf-parse');
    const pdfParse = mod.default ?? mod;
    const result = await pdfParse(buffer);
    return tidy(result.text ?? '');
  } catch (err) {
    throw new Error(
      'PDF parsing is unavailable. Install it with `npm i pdf-parse`, or upload .txt/.md/.docx. ' +
        `Original error: ${err.message}`,
    );
  }
}

/** Word documents: paragraphs live in word/document.xml. */
export function parseDocx(buffer) {
  const entries = readZipEntries(buffer);
  const doc = entries.find((e) => e.name === 'word/document.xml');
  if (!doc) throw new Error('Not a valid .docx file (word/document.xml is missing).');
  return stripMarkup(readZipText(buffer, doc), { blockTags: ['p', 'tr'], cellTags: ['tc'] });
}

/** PowerPoint: one text stream per slide, numbered for context. */
export function parsePptx(buffer) {
  const entries = readZipEntries(buffer);
  const slides = entries
    .filter((e) => /^ppt\/slides\/slide\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/(\d+)/)[1]) - Number(b.name.match(/(\d+)/)[1]));
  if (slides.length === 0) throw new Error('Not a valid .pptx file (no slides found).');

  const parts = [];
  slides.forEach((slide, i) => {
    const text = stripMarkup(readZipText(buffer, slide), { blockTags: ['p'] });
    if (text) parts.push(`Slide ${i + 1}:\n${text}`);
  });
  return tidy(parts.join('\n\n'));
}

/**
 * Excel workbooks: cell values come either from `sharedStrings.xml` (by index)
 * or inline. We emit tab-separated rows so the structure survives flattening.
 */
export function parseXlsx(buffer) {
  const entries = readZipEntries(buffer);

  const shared = [];
  const sharedEntry = entries.find((e) => e.name === 'xl/sharedStrings.xml');
  if (sharedEntry) {
    const xml = readZipText(buffer, sharedEntry);
    for (const m of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(stripMarkup(m[1]));
  }

  const sheetEntries = entries
    .filter((e) => /^xl\/worksheets\/sheet\d+\.xml$/.test(e.name))
    .sort((a, b) => Number(a.name.match(/(\d+)/)[1]) - Number(b.name.match(/(\d+)/)[1]));

  const lines = [];
  for (const sheet of sheetEntries) {
    const xml = readZipText(buffer, sheet);
    for (const row of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b[^>]*>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[0];
        const inner = cell[1];
        const inline = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/);
        const value = inner.match(/<v>([\s\S]*?)<\/v>/);
        if (inline) cells.push(stripMarkup(inline[1]));
        else if (value) {
          const isShared = /\bt="s"/.test(attrs);
          cells.push(isShared ? (shared[Number(value[1])] ?? '') : tidy(value[1]));
        } else {
          cells.push('');
        }
      }
      if (cells.some((c) => c.length > 0)) lines.push(cells.join('\t'));
    }
  }

  if (lines.length === 0) throw new Error('Not a valid .xlsx file (no worksheet rows found).');
  return tidy(lines.join('\n'));
}

/** OpenDocument (odt/odp/ods): a single content.xml holds the body. */
export function parseOdf(buffer) {
  const entries = readZipEntries(buffer);
  const content = entries.find((e) => e.name === 'content.xml');
  if (!content) throw new Error('Not a valid OpenDocument file (content.xml is missing).');
  return stripMarkup(readZipText(buffer, content), {
    blockTags: ['p', 'h', 'table-row'],
    cellTags: ['table-cell'],
  });
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ZIP_OFFICE = {
  docx: parseDocx,
  pptx: parsePptx,
  xlsx: parseXlsx,
  odt: parseOdf,
  odp: parseOdf,
  ods: parseOdf,
};

/**
 * Extract plain text from an uploaded file.
 *
 * @param {object} args
 * @param {Buffer} args.buffer
 * @param {string} [args.mimetype]
 * @param {string} [args.filename]
 * @returns {Promise<{ text: string, format: string }>}
 */
export async function extractText({ buffer, mimetype = '', filename = '' }) {
  const ext = extOf(filename);

  // 1. Formats with a dedicated parser.
  if (ext === 'pdf' || mimetype === 'application/pdf') {
    return { text: await parsePdf(buffer), format: 'pdf' };
  }
  if (ext in ZIP_OFFICE) {
    return { text: ZIP_OFFICE[ext](buffer), format: ext };
  }
  if (ext === 'html' || ext === 'htm' || ext === 'xhtml' || mimetype === 'text/html') {
    return { text: parseHtml(buffer), format: 'html' };
  }
  if (ext === 'rtf' || mimetype === 'application/rtf') {
    return { text: parseRtf(buffer), format: 'rtf' };
  }

  // 2. Unknown extension but the bytes are a ZIP: sniff the payload name.
  //    (Handles Office files that arrive with a generic or wrong extension.)
  if (isZip(buffer)) {
    try {
      const names = readZipEntries(buffer).map((e) => e.name);
      if (names.includes('word/document.xml')) return { text: parseDocx(buffer), format: 'docx' };
      if (names.some((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
        return { text: parsePptx(buffer), format: 'pptx' };
      }
      if (names.some((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n))) {
        return { text: parseXlsx(buffer), format: 'xlsx' };
      }
      if (names.includes('content.xml')) return { text: parseOdf(buffer), format: 'odf' };
    } catch {
      // Fall through to the binary check below for a clearer message.
    }
  }

  // 3. Anything else is treated as UTF-8 text (covers code, csv, json, logs...),
  //    then rejected if it is actually binary.
  const text = parseText(buffer);
  assertSensibleText(text, filename || 'uploaded file');
  return { text, format: ext || 'text' };
}
