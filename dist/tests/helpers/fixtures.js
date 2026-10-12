/**
 * Builds a minimal, valid multi-page PDF with a real text layer.
 * @param {number} pages number of pages
 * @param {(n:number)=>string} [textFor] text for page n (1-based); empty string => page without text
 */
function makePdf(pages, textFor = (n) => `Known page ${n} of the generated test document.`) {
  const objects = [];
  const add = (body) => {
    objects.push(body);
    return objects.length; // object number
  };
  const catalog = add(null);
  const pagesObj = add(null);
  const font = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const kids = [];
  for (let n = 1; n <= pages; n++) {
    const text = textFor(n);
    const stream = text ? `BT /F1 14 Tf 50 700 Td (${text.replace(/[()\\]/g, '')}) Tj ET` : '';
    const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
    const page = add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 612 792] /Contents ${content} 0 R /Resources << /Font << /F1 ${font} 0 R >> >> >>`);
    kids.push(`${page} 0 R`);
  }
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${pagesObj} 0 R >>`;
  objects[pagesObj - 1] = `<< /Type /Pages /Kids [${kids.join(' ')}] /Count ${pages} >>`;

  let out = '%PDF-1.4\n';
  const offsets = [];
  objects.forEach((body, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xrefPos = out.length;
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  // Buffer.alloc is never pooled (pooled slices break pdf.js, which ignores byteOffset)
  const buf = Buffer.alloc(out.length);
  buf.write(out, 'latin1');
  return buf;
}

// Minimal 1x1 PNG
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

module.exports = { makePdf, PNG_1X1 };
