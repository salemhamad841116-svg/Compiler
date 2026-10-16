const dns = require('dns').promises;
const net = require('net');
const { AppError } = require('../utils/errors');
const documents = require('../services/documentService');
const jobQueue = require('../services/jobQueue');
const { scrapeWebUrl } = require('../utils/urlScraper');

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  return (fwd ? String(fwd).split(',')[0].trim() : req.socket.remoteAddress) || 'unknown';
}

function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const l = ip.toLowerCase();
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('::ffff:127.') || l.startsWith('::ffff:10.') || l.startsWith('::ffff:192.168.');
}

/** SSRF guard: only public http(s) hosts may be scraped. */
async function assertPublicUrl(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch (_) {
    throw new AppError(400, 'URL_INVALID', 'A valid http(s) URL is required.');
  }
  if (!['http:', 'https:'].includes(u.protocol)) throw new AppError(400, 'URL_INVALID', 'Only http and https URLs are allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = net.isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addrs.length) throw new AppError(422, 'URL_UNRESOLVABLE', 'The URL host could not be resolved.');
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new AppError(400, 'URL_FORBIDDEN', 'This URL points to a private or internal network address.');
}

function shape(doc, message) {
  const d = documents.mapDocument(doc);
  return { success: true, message, data: { ...d, bookTitle: d.title, totalChunks: d.chunkCount } };
}

function uploadFile(expectKind) {
  return async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'NO_FILE', 'No file was received. Select a file and try again.');
    }
    const doc = await documents.storeUploadedFile({
      file: req.file,
      body: { ...req.body, _expectKind: expectKind },
      actor: req.user,
      ip: clientIp(req),
    });
    jobQueue.enqueue(doc.id);
    res.status(201).json(shape(doc, 'File stored successfully. Processing has been queued.'));
  };
}

async function uploadBookImages(req, res) {
  const files = req.files || (req.file ? [req.file] : []);
  if (!files.length) {
    throw new AppError(400, 'NO_FILES', 'No image files were received. Select one or more images and try again.');
  }
  const doc = await documents.storeBookImages({
    files,
    body: req.body || {},
    actor: req.user,
    ip: clientIp(req),
  });
  jobQueue.enqueue(doc.id);
  res.status(201).json(shape(doc, 'Book images stored successfully. OCR and indexing queued.'));
}

async function rawText(req, res) {
  const { title, textContent } = req.body || {};
  const doc = await documents.storeRawText({ title, textContent, body: req.body || {}, actor: req.user, ip: clientIp(req) });
  jobQueue.enqueue(doc.id);
  res.status(201).json(shape(doc, 'Text stored successfully. Indexing has been queued.'));
}

async function scrapeUrl(req, res) {
  const { url, title } = req.body || {};
  try {
    await assertPublicUrl(url);
    const scraped = await scrapeWebUrl(url);
    const doc = await documents.storeScrapedUrl({ url, title, scraped, body: req.body || {}, actor: req.user, ip: clientIp(req) });
    jobQueue.enqueue(doc.id);
    return res.status(201).json(shape(doc, 'Page content stored successfully. Indexing has been queued.'));
  } catch (err) {
    if (!(err instanceof AppError) || err.code.startsWith('URL_')) {
      documents.recordUploadFailure({
        actor: req.user, ownerRef: (req.body || {}).supervisorId, filename: url, categoryRef: (req.body || {}).categoryId || (req.body || {}).category,
        batchId: (req.body || {}).batchId, code: err.code || 'SCRAPE_FAILED', reason: err.message, ip: clientIp(req), kind: 'url', fileType: 'url',
      });
    }
    if (err instanceof AppError) throw err;
    throw new AppError(422, 'SCRAPE_FAILED', err.message || 'Could not extract text from this URL. Paste the text manually instead.');
  }
}

async function createBatch(req, res) {
  const batch = documents.createBatch({ declaredCount: (req.body || {}).declaredCount, supervisorId: (req.body || {}).supervisorId }, req.user);
  res.status(201).json({ success: true, data: batch });
}

async function getBatch(req, res) {
  res.json({ success: true, data: documents.batchSummary(req.params.id, req.user) });
}

async function retryFailedInBatch(req, res) {
  const summary = documents.batchSummary(req.params.id, req.user);
  let queued = 0;
  const skipped = [];
  for (const f of summary.files) {
    if (f.pipelineStatus !== 'failed') continue;
    try {
      if (jobQueue.retryDocument(f.id, req.user, { ip: clientIp(req) }).queued) queued++;
    } catch (e) {
      skipped.push({ id: f.id, code: e.code });
    }
  }
  res.json({ success: true, data: { queued, skipped } });
}

async function listBooks(req, res) {
  const result = documents.listDocuments({ ...req.query, status: 'completed', pageSize: req.query.pageSize || 200 }, req.user);
  res.json({ success: true, data: result.items.map((d) => ({ ...d, bookTitle: d.title, totalChunks: d.chunkCount })) });
}

module.exports = { uploadFile, uploadBookImages, rawText, scrapeUrl, createBatch, getBatch, retryFailedInBatch, listBooks, assertPublicUrl, isPrivateAddress };
