// ==============================================================================
// Local open-source document tools (Phase 5), installed in the backend image:
//   tesseract (+ ara/eng traineddata)  - local OCR engine (fallback / privacy mode)
//   pdftoppm / pdfinfo (poppler-utils) - render scanned PDF pages to images
//   ffmpeg                             - extract/split audio for Whisper, shrink big images
// Everything runs as a child process with a timeout; nothing leaves the server.
// Binaries are resolved from PATH (tests put fake binaries on PATH).
// ==============================================================================
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const config = require('../../config');

const availability = new Map(); // binary -> { ok, version, at }
const AVAIL_TTL_MS = 5 * 60 * 1000;

function exec(bin, args, { timeoutMs = 120000, maxBuffer = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: timeoutMs, maxBuffer, encoding: 'buffer', windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const msg = (stderr && stderr.toString('utf8').trim().split('\n').slice(-3).join(' | ')) || err.message;
        const e = new Error(`${bin} failed${err.killed ? ` (timeout after ${timeoutMs} ms)` : ''}: ${msg.slice(0, 300)}`);
        e.code = err.code === 'ENOENT' ? 'TOOL_MISSING' : 'TOOL_FAILED';
        return reject(e);
      }
      resolve({ stdout, stderr });
    });
  });
}

/** True when a binary can be executed (cached for a few minutes). */
async function has(bin) {
  const c = availability.get(bin);
  if (c && Date.now() - c.at < AVAIL_TTL_MS) return c.ok;
  const versionArgs = { tesseract: ['--version'], pdftoppm: ['-v'], pdfinfo: ['-v'], ffmpeg: ['-version'], sips: ['--version'], opj_decompress: ['-h'], convert: ['-version'] }[bin] || ['--version'];
  let ok = false;
  let version = null;
  try {
    const { stdout, stderr } = await exec(bin, versionArgs, { timeoutMs: 10000 });
    ok = true;
    version = `${stdout.toString('utf8')}${stderr.toString('utf8')}`.trim().split('\n')[0].slice(0, 80);
  } catch (_) {
    ok = false;
  }
  availability.set(bin, { ok, version, at: Date.now() });
  return ok;
}

async function toolStatus() {
  const out = {};
  for (const b of ['tesseract', 'pdftoppm', 'pdfinfo', 'ffmpeg']) {
    const ok = await has(b);
    out[b] = { available: ok, version: ok ? availability.get(b).version : null };
  }
  return out;
}

/** Private scratch directory for one job; always remove it with cleanupWorkDir(). */
function makeWorkDir(label = 'job') {
  const dir = path.join(config.aiTmpDir, `${label}-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanupWorkDir(dir) {
  if (!dir) return;
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* best effort */ }
}

// ------------------------------------------------------------------ tesseract
function tesseractLangs() {
  return String(process.env.TESSERACT_LANGS || 'ara+eng').replace(/[^a-z_+]/gi, '') || 'ara+eng';
}

/** Local OCR of one image file with Tesseract. */
async function tesseractOcr(imagePath) {
  const { stdout } = await exec('tesseract', [imagePath, 'stdout', '-l', tesseractLangs(), '--psm', '3'], { timeoutMs: 180000 });
  return stdout.toString('utf8').replace(/\f/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

// ------------------------------------------------------------------ poppler
/** Page count via pdfinfo (works on PDFs that pdf.js cannot parse). */
async function pdfPageCount(pdfPath) {
  const { stdout } = await exec('pdfinfo', [pdfPath], { timeoutMs: 30000 });
  const m = stdout.toString('utf8').match(/^Pages:\s+(\d+)/m);
  if (!m) throw Object.assign(new Error('pdfinfo did not report a page count.'), { code: 'TOOL_FAILED' });
  return parseInt(m[1], 10);
}

/** Renders ONE PDF page to a JPEG and returns its path. */
async function renderPdfPage(pdfPath, pageNumber, workDir) {
  const dpi = parseInt(process.env.PDF_OCR_DPI, 10) || 200;
  const prefix = path.join(workDir, `page-${pageNumber}`);
  await exec('pdftoppm', ['-r', String(dpi), '-f', String(pageNumber), '-l', String(pageNumber), '-singlefile', '-jpeg', '-jpegopt', 'quality=85', pdfPath, prefix], { timeoutMs: 120000 });
  const out = `${prefix}.jpg`;
  if (!fs.existsSync(out)) throw Object.assign(new Error(`pdftoppm produced no image for page ${pageNumber}.`), { code: 'TOOL_FAILED' });
  return out;
}

// ------------------------------------------------------------------ ffmpeg
/**
 * Converts any audio/video file to 16 kHz mono MP3 segments (default 10 minutes each)
 * so every piece stays well under the provider's upload limit.
 * @returns {Promise<string[]>} segment paths in order
 */
async function splitAudio(mediaPath, workDir) {
  const seconds = parseInt(process.env.TRANSCRIBE_SEGMENT_SECONDS, 10) || 600;
  const pattern = path.join(workDir, 'seg-%03d.mp3');
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', mediaPath, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k',
    '-f', 'segment', '-segment_time', String(seconds), '-reset_timestamps', '1', pattern], { timeoutMs: 30 * 60 * 1000 });
  const segs = fs.readdirSync(workDir).filter((f) => /^seg-\d+\.mp3$/.test(f)).sort().map((f) => path.join(workDir, f));
  if (!segs.length) throw Object.assign(new Error('ffmpeg produced no audio (the file may have no audio track).'), { code: 'TOOL_FAILED' });
  return segs;
}

/** Re-encodes an image as a JPEG no larger than maxSide pixels (keeps aspect ratio). */
async function shrinkImage(imagePath, workDir, maxSide = 2048) {
  const out = path.join(workDir, `img-${crypto.randomBytes(4).toString('hex')}.jpg`);
  await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', imagePath,
    '-vf', `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`, '-frames:v', '1', '-q:v', '3', out], { timeoutMs: 60000 });
  if (!fs.existsSync(out)) throw Object.assign(new Error('ffmpeg produced no image.'), { code: 'TOOL_FAILED' });
  return out;
}

/** Decompresses/converts a JPEG 2000 (.jp2/.jpx) scan into a standard JPEG image for OCR. */
async function convertJp2ToImage(jp2Path, workDir) {
  const out = path.join(workDir, `jp2conv-${crypto.randomBytes(4).toString('hex')}.jpg`);
  try {
    if (process.platform === 'darwin' && (await has('sips'))) {
      await exec('sips', ['-s', 'format', 'jpeg', jp2Path, '--out', out], { timeoutMs: 60000 });
    } else if (await has('opj_decompress')) {
      await exec('opj_decompress', ['-i', jp2Path, '-o', out], { timeoutMs: 60000 });
    } else if (await has('convert')) {
      await exec('convert', [jp2Path, out], { timeoutMs: 60000 });
    } else if (await has('ffmpeg')) {
      await exec('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', jp2Path, out], { timeoutMs: 60000 });
    }
  } catch (err) {
    console.warn(`[LocalTools] JP2 conversion warning for ${path.basename(jp2Path)}: ${err.message}`);
  }
  return fs.existsSync(out) ? out : jp2Path;
}

module.exports = {
  has,
  toolStatus,
  makeWorkDir,
  cleanupWorkDir,
  tesseractOcr,
  pdfPageCount,
  renderPdfPage,
  splitAudio,
  shrinkImage,
  convertJp2ToImage,
  _resetAvailability: () => availability.clear(),
};
