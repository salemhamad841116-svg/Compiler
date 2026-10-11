const fs = require('fs');
const path = require('path');

// Local Data Vault directory fallback for persistent raw file archiving
const LOCAL_VAULT_DIR = path.join(__dirname, '../../data/vault/');

// Ensure local vault storage directory exists
if (!fs.existsSync(LOCAL_VAULT_DIR)) {
  fs.mkdirSync(LOCAL_VAULT_DIR, { recursive: true });
}

/**
 * Storage Service handling permanent file archiving to Google Cloud / Firebase Storage
 * or the dedicated Local Data Vault with direct URL references.
 */
class StorageService {
  constructor() {
    this.bucketName = process.env.GCS_BUCKET_NAME || process.env.FIREBASE_STORAGE_BUCKET || 'private-rag-raw-books-vault';
    this.useCloudStorage = Boolean(process.env.GCS_BUCKET_NAME || process.env.FIREBASE_STORAGE_BUCKET);
  }

  /**
   * Sanitizes a string for safe filename and folder generation.
   * @param {string} name
   * @returns {string}
   */
  sanitizeFilename(name) {
    return (name || '').replace(/[^a-zA-Z0-9._-]/g, '_');
  }

  /**
   * Permanently archives an uploaded file into the Data Vault organized by category.
   *
   * @param {string} tempFilePath - Temporary file path on disk.
   * @param {string} originalFilename - Original name of the document.
   * @param {string} supervisorId - Email/ID of uploading supervisor.
   * @param {string} category - Document category (e.g. Religion, History, Science).
   * @returns {Promise<{ vaultPath: string, storageReference: string, rawFileUrl: string, fileSize: number, category: string }>}
   */
  async saveUploadedFileToVault(tempFilePath, originalFilename, supervisorId = 'supervisor_default', category = 'General') {
    if (!fs.existsSync(tempFilePath)) {
      throw new Error(`Temp file not found at path: ${tempFilePath}`);
    }

    const fileStats = fs.statSync(tempFilePath);
    const sanitizedSupervisor = this.sanitizeFilename(supervisorId);
    const sanitizedName = this.sanitizeFilename(originalFilename);
    const sanitizedCategory = this.sanitizeFilename(category || 'General');
    const timestamp = Date.now();
    const vaultFileName = `${timestamp}_${sanitizedSupervisor}_${sanitizedName}`;

    // Target folder by category
    const categoryDir = path.join(LOCAL_VAULT_DIR, sanitizedCategory);
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    const destinationPath = path.join(categoryDir, vaultFileName);

    // Copy from temp upload directory to permanent Data Vault storage
    fs.copyFileSync(tempFilePath, destinationPath);

    // Remove temp file after successful archival into vault
    if (fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (err) {
        console.warn('[Storage] Warning removing temp file:', err.message);
      }
    }

    const storageReference = `gs://${this.bucketName}/raw-files/${sanitizedCategory}/${vaultFileName}`;
    const rawFileUrl = `/api/vault/${encodeURIComponent(sanitizedCategory)}/${vaultFileName}`;

    console.log(`[Storage] Document archived in Data Vault under category "${sanitizedCategory}": "${vaultFileName}" (${fileStats.size} bytes)`);

    return {
      vaultPath: destinationPath,
      vaultFileName,
      category: sanitizedCategory,
      storageReference,
      rawFileUrl,
      fileSize: fileStats.size,
      mimeType: path.extname(originalFilename).toLowerCase(),
    };
  }

  /**
   * Automatically creates a permanent .txt file for pasted raw text and saves it into the Data Vault by category.
   *
   * @param {string} textContent - Raw text content string.
   * @param {string} docTitle - Document title / topic name.
   * @param {string} supervisorId - Email/ID of uploading supervisor.
   * @param {string} category - Document category.
   * @returns {Promise<{ vaultPath: string, storageReference: string, rawFileUrl: string, fileSize: number, category: string }>}
   */
  async saveRawTextToVault(textContent, docTitle, supervisorId = 'supervisor_default', category = 'General') {
    const sanitizedSupervisor = this.sanitizeFilename(supervisorId);
    const sanitizedTitle = this.sanitizeFilename(docTitle || 'pasted_note');
    const sanitizedCategory = this.sanitizeFilename(category || 'General');
    const timestamp = Date.now();
    const vaultFileName = `${timestamp}_${sanitizedSupervisor}_${sanitizedTitle}.txt`;

    // Target folder by category
    const categoryDir = path.join(LOCAL_VAULT_DIR, sanitizedCategory);
    if (!fs.existsSync(categoryDir)) {
      fs.mkdirSync(categoryDir, { recursive: true });
    }

    const destinationPath = path.join(categoryDir, vaultFileName);

    // Write the raw text into a permanent file in Data Vault
    fs.writeFileSync(destinationPath, textContent, 'utf-8');
    const fileStats = fs.statSync(destinationPath);

    const storageReference = `gs://${this.bucketName}/raw-files/${sanitizedCategory}/${vaultFileName}`;
    const rawFileUrl = `/api/vault/${encodeURIComponent(sanitizedCategory)}/${vaultFileName}`;

    console.log(`[Storage] Raw text saved in Data Vault under category "${sanitizedCategory}": "${vaultFileName}" (${fileStats.size} bytes)`);

    return {
      vaultPath: destinationPath,
      vaultFileName,
      category: sanitizedCategory,
      storageReference,
      rawFileUrl,
      fileSize: fileStats.size,
      mimeType: '.txt',
    };
  }

  /**
   * Retrieves a file path from the Data Vault by filename and optional category.
   *
   * @param {string} filename
   * @param {string} [category]
   * @returns {string|null}
   */
  getVaultFilePath(filename, category = null) {
    const safeName = path.basename(filename);

    if (category) {
      const safeCategory = this.sanitizeFilename(category);
      const catPath = path.join(LOCAL_VAULT_DIR, safeCategory, safeName);
      if (fs.existsSync(catPath)) return catPath;
    }

    // Direct root vault check
    const rootPath = path.join(LOCAL_VAULT_DIR, safeName);
    if (fs.existsSync(rootPath)) return rootPath;

    // Search subdirectories inside vault
    if (fs.existsSync(LOCAL_VAULT_DIR)) {
      const entries = fs.readdirSync(LOCAL_VAULT_DIR, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const subPath = path.join(LOCAL_VAULT_DIR, entry.name, safeName);
          if (fs.existsSync(subPath)) return subPath;
        }
      }
    }

    return null;
  }
}

module.exports = new StorageService();
