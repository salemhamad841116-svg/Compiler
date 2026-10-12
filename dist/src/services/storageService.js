const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config');

/**
 * Data Vault: permanent file storage. Files are stored under docs/<yyyy-mm>/<documentId>_<name>
 * independent of category so renaming/reassigning a category never moves or orphans a file.
 * Optionally mirrored to Google Cloud Storage when GCS_BUCKET_NAME is set AND @google-cloud/storage is installed.
 * The storage reference only claims gs:// when the mirror upload really succeeded.
 */
class StorageService {
  get vaultDir() {
    return config.vaultDir;
  }

  sanitizeFilename(name) {
    return String(name || 'file').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'file';
  }

  ensureDirs() {
    fs.mkdirSync(this.vaultDir, { recursive: true });
    fs.mkdirSync(config.tempUploadDir, { recursive: true });
  }

  /** Resolves a vault-relative path to an absolute path, rejecting traversal. */
  resolve(relPath) {
    if (!relPath) return null;
    const abs = path.resolve(this.vaultDir, relPath);
    const root = path.resolve(this.vaultDir) + path.sep;
    if (!abs.startsWith(root)) return null;
    return abs;
  }

  exists(relPath) {
    const abs = this.resolve(relPath);
    return Boolean(abs && fs.existsSync(abs));
  }

  sha256File(filePath) {
    const hash = crypto.createHash('sha256');
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(1024 * 1024);
    try {
      let n;
      while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) hash.update(buf.subarray(0, n));
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest('hex');
  }

  relPathFor(documentId, originalName, at = new Date()) {
    const ym = at.toISOString().slice(0, 7);
    return path.posix.join('docs', ym, `${documentId}_${this.sanitizeFilename(originalName)}`);
  }

  /** Moves an uploaded temp file into the vault. */
  async saveFile(tempPath, documentId, originalName) {
    this.ensureDirs();
    if (!fs.existsSync(tempPath)) throw new Error('Uploaded temp file is missing.');
    const rel = this.relPathFor(documentId, originalName);
    const abs = this.resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    const sha256 = this.sha256File(tempPath);
    try {
      fs.renameSync(tempPath, abs);
    } catch (_) {
      fs.copyFileSync(tempPath, abs);
      fs.unlinkSync(tempPath);
    }
    const size = fs.statSync(abs).size;
    const storageReference = await this.mirrorToCloud(rel, abs);
    return { relPath: rel, absPath: abs, size, sha256, storageReference };
  }

  async saveText(text, documentId, name) {
    this.ensureDirs();
    const fileName = /\.txt$/i.test(name) ? name : `${name}.txt`;
    const rel = this.relPathFor(documentId, fileName);
    const abs = this.resolve(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text, 'utf-8');
    const size = fs.statSync(abs).size;
    const sha256 = crypto.createHash('sha256').update(text).digest('hex');
    const storageReference = await this.mirrorToCloud(rel, abs);
    return { relPath: rel, absPath: abs, size, sha256, storageReference };
  }

  removeTemp(tempPath) {
    try {
      if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch (_) {
      /* best effort */
    }
  }

  deleteFile(relPath) {
    const abs = this.resolve(relPath);
    if (abs && fs.existsSync(abs)) {
      fs.unlinkSync(abs);
      return true;
    }
    return false;
  }

  /** Lists every file in the vault (relative posix paths) - used by reconciliation. */
  listAllFiles() {
    const out = [];
    const root = path.resolve(this.vaultDir);
    if (!fs.existsSync(root)) return out;
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name !== '.gitkeep' && !entry.name.startsWith('.')) {
          const st = fs.statSync(full);
          out.push({ relPath: path.relative(root, full).split(path.sep).join('/'), size: st.size, mtime: st.mtime.toISOString() });
        }
      }
    };
    walk(root);
    return out;
  }

  /** Legacy lookup used by old /api/vault/<category>/<file> links. */
  findLegacyFile(filename, category) {
    const safe = path.basename(filename || '');
    if (!safe) return null;
    const candidates = [];
    if (category) candidates.push(path.join(this.sanitizeFilename(category), safe));
    candidates.push(safe);
    for (const c of candidates) if (this.exists(c)) return c.split(path.sep).join('/');
    for (const f of this.listAllFiles()) if (path.posix.basename(f.relPath) === safe) return f.relPath;
    return null;
  }

  cloudConfigured() {
    return Boolean(process.env.GCS_BUCKET_NAME);
  }

  cloudClient() {
    if (this._gcs !== undefined) return this._gcs;
    try {
      const { Storage } = require('@google-cloud/storage');
      this._gcs = new Storage();
    } catch (_) {
      this._gcs = null;
    }
    return this._gcs;
  }

  async mirrorToCloud(relPath, absPath) {
    const local = `local://vault/${relPath}`;
    if (!this.cloudConfigured()) return local;
    const client = this.cloudClient();
    if (!client) return local; // package not installed: do not claim cloud storage
    try {
      await client.bucket(process.env.GCS_BUCKET_NAME).upload(absPath, { destination: `vault/${relPath}` });
      return `gs://${process.env.GCS_BUCKET_NAME}/vault/${relPath}`;
    } catch (err) {
      console.error('[Storage] GCS mirror failed (file remains safely in the local vault):', err.message);
      return local;
    }
  }

  health() {
    let writable = false;
    try {
      this.ensureDirs();
      const probe = path.join(this.vaultDir, `.write_probe_${process.pid}`);
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      writable = true;
    } catch (_) {
      writable = false;
    }
    let cloudMirror = 'not_configured';
    if (this.cloudConfigured()) cloudMirror = this.cloudClient() ? 'active' : 'unavailable_package_not_installed';
    return { writable, vaultDir: this.vaultDir, cloudMirror, persistentVolumeHint: config.isProduction ? 'Ensure DATA_DIR is on a persistent volume' : null };
  }
}

module.exports = new StorageService();
