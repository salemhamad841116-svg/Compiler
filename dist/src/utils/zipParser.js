const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');

const IMAGE_EXTS = ['.jp2', '.jpx', '.j2k', '.jpg', '.jpeg', '.png', '.webp', '.tif', '.tiff', '.bmp'];
const TEXT_EXTS = ['.txt', '.md', '.text'];
const DOC_EXTS = ['.pdf', '.epub'];

/**
 * Natural alphanumeric comparator so page_1, page_2, ..., page_10 sort in order.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

/**
 * Inspects a ZIP archive, filtering out system metadata and categorizing entries.
 * @param {string} zipPath - Absolute path to the .zip archive on disk.
 * @returns {{
 *   zip: AdmZip,
 *   entries: Array<object>,
 *   imageEntries: Array<object>,
 *   textEntries: Array<object>,
 *   documentEntries: Array<object>,
 *   totalValidEntries: number
 * }}
 */
function inspectZip(zipPath) {
  const zip = new AdmZip(zipPath);
  const rawEntries = zip.getEntries();
  const valid = [];

  for (const entry of rawEntries) {
    if (entry.isDirectory) continue;
    const name = entry.entryName;
    const base = path.basename(name);
    // Ignore macOS resource forks and OS desktop metadata
    if (name.includes('__MACOSX') || base.startsWith('._') || base === '.DS_Store' || base.toLowerCase() === 'thumbs.db') {
      continue;
    }
    valid.push(entry);
  }

  valid.sort((a, b) => collator.compare(a.entryName, b.entryName));

  const imageEntries = [];
  const textEntries = [];
  const documentEntries = [];

  for (const entry of valid) {
    const ext = path.extname(entry.entryName).toLowerCase();
    if (IMAGE_EXTS.includes(ext)) {
      imageEntries.push(entry);
    } else if (TEXT_EXTS.includes(ext)) {
      textEntries.push(entry);
    } else if (DOC_EXTS.includes(ext)) {
      documentEntries.push(entry);
    }
  }

  let kind = 'empty';
  if (imageEntries.length > 0 && textEntries.length === 0 && documentEntries.length === 0) {
    kind = 'images';
  } else if (textEntries.length > 0 && imageEntries.length === 0 && documentEntries.length === 0) {
    kind = 'text';
  } else if (documentEntries.length === 1 && imageEntries.length === 0 && textEntries.length === 0) {
    kind = 'single_doc';
  } else if (valid.length > 0) {
    kind = imageEntries.length >= textEntries.length ? 'images' : 'text';
  }

  return {
    zip,
    entries: valid,
    imageEntries,
    textEntries,
    documentEntries,
    totalValidEntries: valid.length,
    kind,
    subDocExt: documentEntries.length > 0 ? path.extname(documentEntries[0].entryName).toLowerCase() : null,
  };
}

/**
 * Extracts a specific entry from the archive to a designated file path.
 * @param {object} entry - AdmZip entry object.
 * @param {string} destPath - Destination file path.
 * @returns {string} Absolute path to the written file.
 */
function extractEntry(entry, destPath) {
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, entry.getData());
  return destPath;
}

module.exports = {
  inspectZip,
  extractEntry,
  naturalCompare: (a, b) => collator.compare(a, b),
  IMAGE_EXTS,
  TEXT_EXTS,
  DOC_EXTS,
};
