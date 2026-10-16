/**
 * Minimal ZIP reader.
 *
 * WHY THIS EXISTS
 *   Office formats (.docx, .pptx, .xlsx, .odt) are just ZIP archives containing
 *   XML. Supporting them normally means pulling in a parsing dependency per
 *   format. A ZIP reader plus a small XML-to-text pass covers all of them with
 *   zero new dependencies, which keeps the project installable offline and free
 *   of native builds.
 *
 * SCOPE
 *   Only what we need: enumerate entries, then inflate one entry (STORED or
 *   DEFLATE). Directory entries, ZIP64, encryption and multi-disk archives are
 *   out of scope - Office files never use them in practice.
 */

import zlib from 'node:zlib';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** Cheap check so we can decide whether to attempt ZIP parsing at all. */
export function isZip(buffer) {
  return (
    buffer.length >= 4 &&
    buffer[0] === 0x50 && // 'P'
    buffer[1] === 0x4b && // 'K'
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
  );
}

/**
 * Locate the End Of Central Directory record and read the entry list.
 * The EOCD sits at the very end of the file (before an optional comment), so we
 * scan backwards from the end - that is what the format itself prescribes.
 *
 * @returns {Array<{name:string, method:number, compSize:number, localOffset:number}>}
 */
export function readZipEntries(buffer) {
  const EOCD_MIN = 22; // fixed part of the EOCD record
  const MAX_COMMENT = 0xffff;

  let eocd = -1;
  const lowest = Math.max(0, buffer.length - EOCD_MIN - MAX_COMMENT);
  for (let i = buffer.length - EOCD_MIN; i >= lowest; i -= 1) {
    if (buffer.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('Not a valid ZIP archive (no end-of-central-directory record).');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);

  const entries = [];
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== SIG_CENTRAL) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compSize = buffer.readUInt32LE(offset + 20);
    const nameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    // Some ZIP writers (notably Windows' built-in one) use backslash path
    // separators; Office and the ZIP spec use forward slashes. Normalise so our
    // format parsers can match names consistently.
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLen).replace(/\\/g, '/');

    entries.push({ name, method, compSize, localOffset });
    offset += 46 + nameLen + extraLen + commentLen;
  }

  return entries;
}

/**
 * Inflate a single entry and return its bytes.
 *
 * NOTE on sizes: a local header may store size 0 and rely on a trailing data
 * descriptor. In that case we fall back to the size recorded in the central
 * directory, which is always accurate.
 */
export function readZipEntry(buffer, entry) {
  const off = entry.localOffset;
  if (off + 30 > buffer.length || buffer.readUInt32LE(off) !== SIG_LOCAL) {
    throw new Error(`Corrupt ZIP local header for "${entry.name}".`);
  }

  const nameLen = buffer.readUInt16LE(off + 26);
  const extraLen = buffer.readUInt16LE(off + 28);
  const dataStart = off + 30 + nameLen + extraLen;

  let compSize = buffer.readUInt32LE(off + 18);
  if (compSize === 0) compSize = entry.compSize;

  const data = buffer.subarray(dataStart, dataStart + compSize);
  if (entry.method === 0) return data; // stored, no compression
  if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error(`Unsupported ZIP compression method ${entry.method} in "${entry.name}".`);
}

/**
 * Convert a ZIP entry to UTF-8 text. Convenience wrapper used by the format
 * parsers so they read as one-liners.
 */
export function readZipText(buffer, entry) {
  return readZipEntry(buffer, entry).toString('utf8');
}
