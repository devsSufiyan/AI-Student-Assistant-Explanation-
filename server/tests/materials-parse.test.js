/**
 * Tests for multi-format document extraction.
 *
 * Office formats are ZIP archives, so rather than committing binary fixtures we
 * BUILD the archives in-memory. STORED entries (compression method 0) need no
 * deflate step, which keeps the helper short and the test readable. CRC values
 * are written as 0 because our reader (correctly) does not validate them.
 */

import { describe, it, expect } from 'vitest';
import {
  extractText,
  extOf,
  decodeEntities,
  parseHtml,
  parseRtf,
  parseText,
} from '../src/modules/materials/parse.js';
import { isZip, readZipEntries } from '../src/modules/materials/zip.js';

/**
 * Build a minimal but structurally valid ZIP containing STORED entries.
 * @param {Array<{name:string, content:string}>} files
 */
function makeStoredZip(files) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.content, 'utf8');

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // local header signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt32LE(0, 14); // crc32 (not validated)
    local.writeUInt32LE(data.length, 18); // compressed size
    local.writeUInt32LE(data.length, 22); // uncompressed size
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); // central header signature
    central.writeUInt16LE(20, 4); // version made by
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0, 8); // flags
    central.writeUInt16LE(0, 10); // method
    central.writeUInt32LE(0, 16); // crc32
    central.writeUInt32LE(data.length, 20); // compressed size
    central.writeUInt32LE(data.length, 24); // uncompressed size
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt32LE(offset, 42); // local header offset

    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); // entries on this disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(centralBuffer.length, 12); // central directory size
  eocd.writeUInt32LE(offset, 16); // central directory offset

  return Buffer.concat([...locals, centralBuffer, eocd]);
}

describe('extOf', () => {
  it('extracts a lowercased extension', () => {
    expect(extOf('Notes.DOCX')).toBe('docx');
    expect(extOf('archive.tar.gz')).toBe('gz');
    expect(extOf('noextension')).toBe('');
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#65; &#x42;')).toBe('a & b <c> A B');
  });
  it('decodes &amp; last so it is not double-decoded', () => {
    expect(decodeEntities('&amp;lt;')).toBe('&lt;');
  });
});

describe('zip reader', () => {
  it('recognises a zip buffer and lists its entries', () => {
    const zip = makeStoredZip([{ name: 'a.txt', content: 'hello' }]);
    expect(isZip(zip)).toBe(true);
    expect(readZipEntries(zip).map((e) => e.name)).toEqual(['a.txt']);
  });

  it('rejects a non-zip buffer with a clear error', () => {
    expect(() => readZipEntries(Buffer.from('not a zip at all'))).toThrow(/ZIP/i);
  });
});

describe('extractText - Office formats', () => {
  it('extracts DOCX paragraph text', async () => {
    const zip = makeStoredZip([
      {
        name: 'word/document.xml',
        content:
          '<w:document><w:body>' +
          '<w:p><w:r><w:t>An index speeds up retrieval.</w:t></w:r></w:p>' +
          '<w:p><w:r><w:t>A clustered index orders rows physically.</w:t></w:r></w:p>' +
          '</w:body></w:document>',
      },
    ]);
    const { text, format } = await extractText({ buffer: zip, filename: 'notes.docx' });
    expect(format).toBe('docx');
    expect(text).toContain('An index speeds up retrieval.');
    expect(text).toContain('A clustered index orders rows physically.');
  });

  it('extracts PPTX slides and numbers them', async () => {
    const zip = makeStoredZip([
      {
        name: 'ppt/slides/slide1.xml',
        content: '<p:sld><a:p><a:r><a:t>A transaction is a logical unit of work.</a:t></a:r></a:p></p:sld>',
      },
    ]);
    const { text, format } = await extractText({ buffer: zip, filename: 'deck.pptx' });
    expect(format).toBe('pptx');
    expect(text).toContain('Slide 1:');
    expect(text).toContain('logical unit of work');
  });

  it('extracts XLSX shared strings into tab-separated rows', async () => {
    const zip = makeStoredZip([
      {
        name: 'xl/sharedStrings.xml',
        content: '<sst><si><t>Term</t></si><si><t>Meaning</t></si><si><t>Index</t></si><si><t>Speeds up reads</t></si></sst>',
      },
      {
        name: 'xl/worksheets/sheet1.xml',
        content:
          '<worksheet><sheetData>' +
          '<row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row>' +
          '<row><c t="s"><v>2</v></c><c t="s"><v>3</v></c></row>' +
          '</sheetData></worksheet>',
      },
    ]);
    const { text, format } = await extractText({ buffer: zip, filename: 'sheet.xlsx' });
    expect(format).toBe('xlsx');
    expect(text).toContain('Term\tMeaning');
    expect(text).toContain('Index\tSpeeds up reads');
  });

  it('extracts ODT content', async () => {
    const zip = makeStoredZip([
      { name: 'content.xml', content: '<office:document><text:p>Normalization removes redundancy.</text:p></office:document>' },
    ]);
    const { text, format } = await extractText({ buffer: zip, filename: 'notes.odt' });
    expect(format).toBe('odt');
    expect(text).toContain('Normalization removes redundancy.');
  });

  it('sniffs the format when the extension is wrong', async () => {
    // A DOCX uploaded with a .dat extension must still be recognised.
    const zip = makeStoredZip([
      { name: 'word/document.xml', content: '<w:document><w:p><w:t>Recovered text here.</w:t></w:p></w:document>' },
    ]);
    const { text, format } = await extractText({ buffer: zip, filename: 'mystery.dat' });
    expect(format).toBe('docx');
    expect(text).toContain('Recovered text here.');
  });

  it('explains a malformed Office file instead of indexing noise', async () => {
    const zip = makeStoredZip([{ name: 'random.xml', content: '<a>nothing useful</a>' }]);
    // .docx extension but no word/document.xml -> explicit failure.
    await expect(extractText({ buffer: zip, filename: 'broken.docx' })).rejects.toThrow(/word\/document\.xml/);
  });
});

describe('extractText - plain formats', () => {
  it('strips HTML but keeps block structure and drops scripts', async () => {
    const { text, format } = await extractText({
      buffer: Buffer.from('<h1>Indexes</h1><p>An index speeds up reads.</p><script>alert(1)</script>'),
      filename: 'page.html',
    });
    expect(format).toBe('html');
    expect(text).toContain('Indexes');
    expect(text).toContain('An index speeds up reads.');
    expect(text).not.toContain('alert');
  });

  it('strips RTF control words', async () => {
    const BS = String.fromCharCode(92);
    const rtf = `{${BS}rtf1${BS}ansi The ACID properties are atomicity and durability.}`;
    const { text, format } = await extractText({ buffer: Buffer.from(rtf, 'latin1'), filename: 'doc.rtf' });
    expect(format).toBe('rtf');
    expect(text).toContain('The ACID properties are atomicity and durability.');
    expect(text).not.toContain('rtf1');
  });

  it('passes CSV and JSON through as text', async () => {
    const csv = await extractText({ buffer: Buffer.from('term,meaning\nindex,reads'), filename: 'a.csv' });
    expect(csv.text).toContain('index,reads');
    const json = await extractText({
      buffer: Buffer.from('{"topic":"normalization"}'),
      filename: 'a.json',
    });
    expect(json.text).toContain('normalization');
  });

  it('rejects binary content disguised with a text extension', async () => {
    const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x00, 0x02, 0x00, 0x00, 0xff, 0xfe, 0x00, 0x11]);
    await expect(extractText({ buffer: binary, filename: 'image.png.txt' })).rejects.toThrow(/binary/i);
  });
});

describe('individual helpers', () => {
  it('parseHtml removes tags', () => {
    expect(parseHtml(Buffer.from('<p>Hello <b>world</b></p>'))).toBe('Hello world');
  });
  it('parseText collapses excess whitespace', () => {
    expect(parseText(Buffer.from('a   b\n\n\n\nc'))).toBe('a b\n\nc');
  });
  it('parseRtf keeps literal text', () => {
    const BS = String.fromCharCode(92);
    expect(parseRtf(Buffer.from(`{${BS}rtf1 Hello there}`, 'latin1'))).toBe('Hello there');
  });
});
