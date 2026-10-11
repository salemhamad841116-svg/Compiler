const fs = require('fs');
const path = require('path');
const { extractTextFromPDF } = require('../utils/pdfParser');
const { chunkDocumentText } = require('../utils/textChunker');
const { generateVectorEmbedding } = require('../services/embeddingService');
const { transcribeMediaFile } = require('../utils/mediaTranscriber');
const { scrapeWebUrl } = require('../utils/urlScraper');
const storageService = require('../services/storageService');
const { insertIntoVectorDatabase, getStoredBooksSummary } = require('../models/vectorDbModel');

/**
 * Handles uploading, permanent Data Vault archiving, and indexing of files (.pdf, .txt, .md).
 */
async function processBookUpload(req, res) {
  let uploadedFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded. Please upload a valid document (.pdf, .txt, .md) using the "bookFile" field.',
      });
    }

    uploadedFilePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const bookTitle = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
    const uploadedBy = req.body.uploadedBy || req.headers['x-supervisor-id'] || 'supervisor_default@masruq.com';
    const category = (req.body.category || 'General').trim();
    const language = (req.body.language || 'Arabic').trim();
    const chunkSize = parseInt(req.body.chunkSize, 10) || parseInt(process.env.MAX_CHUNK_SIZE, 10) || 800;
    const chunkOverlap = parseInt(req.body.chunkOverlap, 10) || parseInt(process.env.CHUNK_OVERLAP, 10) || 150;

    console.log(`[Ingestion] Starting Data Vault processing for: "${bookTitle}" [${category} / ${language}] (${fileExt}) by: "${uploadedBy}"`);

    let rawDocumentText = '';
    if (fileExt === '.pdf') {
      rawDocumentText = await extractTextFromPDF(uploadedFilePath);
    } else if (fileExt === '.txt' || fileExt === '.md') {
      rawDocumentText = fs.readFileSync(uploadedFilePath, 'utf-8').trim();
    } else {
      return res.status(400).json({
        success: false,
        error: `Unsupported file type: ${fileExt}. Only .pdf, .txt, and .md files are supported in this endpoint.`,
      });
    }

    if (!rawDocumentText || rawDocumentText.length === 0) {
      return res.status(422).json({
        success: false,
        error: 'The uploaded document contains no readable text.',
      });
    }

    const vaultResult = await storageService.saveUploadedFileToVault(
      uploadedFilePath,
      req.file.originalname,
      uploadedBy,
      category
    );
    uploadedFilePath = null;

    const textChunksArray = chunkDocumentText(rawDocumentText, chunkSize, chunkOverlap);
    const uploadTimestamp = new Date().toISOString();
    let storedCount = 0;

    for (let index = 0; index < textChunksArray.length; index++) {
      const chunk = textChunksArray[index];
      const embeddingVector = await generateVectorEmbedding(chunk);

      await insertIntoVectorDatabase(bookTitle, chunk, embeddingVector, {
        category,
        language,
        uploadedBy,
        uploadType: 'book',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        chunkIndex: index,
        totalChunks: textChunksArray.length,
        sourceType: fileExt.replace('.', ''),
        characterCount: rawDocumentText.length,
        fileSize: vaultResult.fileSize,
        uploadedAt: uploadTimestamp,
      });

      storedCount++;
    }

    console.log(`[Ingestion] Successfully indexed "${bookTitle}" in Data Vault under "${category}" (${storedCount} chunks).`);

    return res.status(200).json({
      success: true,
      message: 'Document permanently archived in Data Vault and indexed successfully.',
      data: {
        bookTitle,
        category,
        language,
        uploadedBy,
        uploadType: 'book',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        totalChunks: storedCount,
        characterCount: rawDocumentText.length,
        fileSize: vaultResult.fileSize,
        sourceType: fileExt.replace('.', ''),
      },
    });
  } catch (error) {
    console.error('[Ingestion] Error during Data Vault file pipeline:', error);

    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupErr) {
        console.error('[Ingestion] Cleanup error:', cleanupErr);
      }
    }

    return res.status(500).json({
      success: false,
      error: error.message || 'Server failed to process and archive the document.',
    });
  }
}

/**
 * Handles raw text input directly.
 */
async function processRawTextInput(req, res) {
  try {
    const { title, textContent, uploadedBy, category: reqCategory, language: reqLanguage, chunkSize, chunkOverlap } = req.body;

    if (!textContent || typeof textContent !== 'string' || textContent.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'A valid "textContent" string is required in the request body.',
      });
    }

    const trimmedText = textContent.trim();
    const docTitle = (title && typeof title === 'string' && title.trim().length > 0)
      ? title.trim()
      : `Pasted Note (${new Date().toLocaleDateString()})`;

    const supervisorId = uploadedBy || req.headers['x-supervisor-id'] || 'supervisor_default@masruq.com';
    const category = (reqCategory || 'General').trim();
    const language = (reqLanguage || 'Arabic').trim();
    const targetChunkSize = parseInt(chunkSize, 10) || parseInt(process.env.MAX_CHUNK_SIZE, 10) || 800;
    const targetOverlap = parseInt(chunkOverlap, 10) || parseInt(process.env.CHUNK_OVERLAP, 10) || 150;

    const vaultResult = await storageService.saveRawTextToVault(
      trimmedText,
      docTitle,
      supervisorId,
      category
    );

    const textChunksArray = chunkDocumentText(trimmedText, targetChunkSize, targetOverlap);
    const uploadTimestamp = new Date().toISOString();
    let storedCount = 0;

    for (let index = 0; index < textChunksArray.length; index++) {
      const chunk = textChunksArray[index];
      const embeddingVector = await generateVectorEmbedding(chunk);

      await insertIntoVectorDatabase(docTitle, chunk, embeddingVector, {
        category,
        language,
        uploadedBy: supervisorId,
        uploadType: 'raw-text',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        chunkIndex: index,
        totalChunks: textChunksArray.length,
        sourceType: 'txt',
        characterCount: trimmedText.length,
        fileSize: vaultResult.fileSize,
        uploadedAt: uploadTimestamp,
      });

      storedCount++;
    }

    return res.status(200).json({
      success: true,
      message: 'Raw text saved as file in Data Vault and indexed successfully.',
      data: {
        bookTitle: docTitle,
        category,
        language,
        uploadedBy: supervisorId,
        uploadType: 'raw-text',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        totalChunks: storedCount,
        characterCount: trimmedText.length,
        fileSize: vaultResult.fileSize,
        sourceType: 'txt',
      },
    });
  } catch (error) {
    console.error('[Ingestion] Error during raw text pipeline:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Server failed to save and index the raw text.',
    });
  }
}

/**
 * Handles Video / Audio upload, Speech-to-Text transcription via Gemini, Data Vault archival, and vector indexing.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function processMediaUpload(req, res) {
  let uploadedFilePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No media file uploaded. Please upload a valid video/audio file using the "mediaFile" field.',
      });
    }

    uploadedFilePath = req.file.path;
    const fileExt = path.extname(req.file.originalname).toLowerCase();
    const mediaTitle = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
    const supervisorId = req.body.uploadedBy || req.headers['x-supervisor-id'] || 'supervisor_default@masruq.com';
    const category = (req.body.category || 'General').trim();
    const language = (req.body.language || 'Arabic').trim();
    const chunkSize = parseInt(req.body.chunkSize, 10) || parseInt(process.env.MAX_CHUNK_SIZE, 10) || 800;
    const chunkOverlap = parseInt(req.body.chunkOverlap, 10) || parseInt(process.env.CHUNK_OVERLAP, 10) || 150;

    console.log(`[Ingestion] Starting Media Speech-to-Text for: "${mediaTitle}" [${category} / ${language}] (${fileExt}) by "${supervisorId}"`);

    // Step 1: Transcribe the media file using Gemini multimodal speech-to-text
    const transcriptText = await transcribeMediaFile(uploadedFilePath);

    // Step 2: Permanently archive the original media file in Data Vault by category
    const vaultResult = await storageService.saveUploadedFileToVault(
      uploadedFilePath,
      req.file.originalname,
      supervisorId,
      category
    );
    uploadedFilePath = null;

    // Step 3: Also archive the transcript as a .txt companion file in Data Vault
    await storageService.saveRawTextToVault(
      transcriptText,
      `${mediaTitle}_transcript`,
      supervisorId,
      category
    );

    // Step 4: Chunk transcript and generate vector embeddings
    const textChunksArray = chunkDocumentText(transcriptText, chunkSize, chunkOverlap);
    console.log(`[Ingestion] Generated ${textChunksArray.length} chunks from media transcript of "${mediaTitle}"`);

    const uploadTimestamp = new Date().toISOString();
    let storedCount = 0;

    for (let index = 0; index < textChunksArray.length; index++) {
      const chunk = textChunksArray[index];
      const embeddingVector = await generateVectorEmbedding(chunk);

      await insertIntoVectorDatabase(mediaTitle, chunk, embeddingVector, {
        category,
        language,
        uploadedBy: supervisorId,
        uploadType: 'media',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        chunkIndex: index,
        totalChunks: textChunksArray.length,
        sourceType: fileExt.replace('.', ''),
        characterCount: transcriptText.length,
        fileSize: vaultResult.fileSize,
        uploadedAt: uploadTimestamp,
      });

      storedCount++;
    }

    console.log(`[Ingestion] Successfully indexed media transcript "${mediaTitle}" in Data Vault (${storedCount} chunks).`);

    return res.status(200).json({
      success: true,
      message: 'Media transcribed, archived in Data Vault, and indexed successfully.',
      data: {
        bookTitle: mediaTitle,
        category,
        language,
        uploadedBy: supervisorId,
        uploadType: 'media',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        totalChunks: storedCount,
        characterCount: transcriptText.length,
        fileSize: vaultResult.fileSize,
        sourceType: fileExt.replace('.', ''),
        transcriptPreview: transcriptText.slice(0, 300) + (transcriptText.length > 300 ? '...' : ''),
      },
    });
  } catch (error) {
    console.error('[Ingestion] Error during media transcription pipeline:', error);

    if (uploadedFilePath && fs.existsSync(uploadedFilePath)) {
      try {
        fs.unlinkSync(uploadedFilePath);
      } catch (cleanupErr) {
        console.error('[Ingestion] Cleanup error:', cleanupErr);
      }
    }

    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to transcribe and index media file.',
    });
  }
}

/**
 * Handles Web URL Scraping, Data Vault text archival, and vector indexing.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 */
async function processUrlScraping(req, res) {
  try {
    const { url, title, uploadedBy, category: reqCategory, language: reqLanguage, chunkSize, chunkOverlap } = req.body;

    if (!url || typeof url !== 'string' || !url.startsWith('http')) {
      return res.status(400).json({
        success: false,
        error: 'A valid "url" starting with http:// or https:// is required.',
      });
    }

    const supervisorId = uploadedBy || req.headers['x-supervisor-id'] || 'supervisor_default@masruq.com';
    const category = (reqCategory || 'General').trim();
    const language = (reqLanguage || 'Arabic').trim();
    const targetChunkSize = parseInt(chunkSize, 10) || parseInt(process.env.MAX_CHUNK_SIZE, 10) || 800;
    const targetOverlap = parseInt(chunkOverlap, 10) || parseInt(process.env.CHUNK_OVERLAP, 10) || 150;

    console.log(`[Ingestion] Scraping Web URL: "${url}" [${category} / ${language}] by "${supervisorId}"`);

    // Step 1: Scrape clean article content
    const scrapedData = await scrapeWebUrl(url);
    const docTitle = (title && typeof title === 'string' && title.trim().length > 0)
      ? title.trim()
      : scrapedData.title;

    // Step 2: Archive scraped article as a .txt file in Data Vault by category
    const vaultResult = await storageService.saveRawTextToVault(
      `Source URL: ${url}\nTitle: ${docTitle}\nCategory: ${category}\nLanguage: ${language}\n\n${scrapedData.content}`,
      docTitle,
      supervisorId,
      category
    );

    // Step 3: Chunk scraped text and generate vector embeddings
    const textChunksArray = chunkDocumentText(scrapedData.content, targetChunkSize, targetOverlap);
    console.log(`[Ingestion] Generated ${textChunksArray.length} chunks from scraped URL "${docTitle}"`);

    const uploadTimestamp = new Date().toISOString();
    let storedCount = 0;

    for (let index = 0; index < textChunksArray.length; index++) {
      const chunk = textChunksArray[index];
      const embeddingVector = await generateVectorEmbedding(chunk);

      await insertIntoVectorDatabase(docTitle, chunk, embeddingVector, {
        category,
        language,
        uploadedBy: supervisorId,
        uploadType: 'url',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        chunkIndex: index,
        totalChunks: textChunksArray.length,
        sourceType: 'url',
        characterCount: scrapedData.content.length,
        fileSize: vaultResult.fileSize,
        uploadedAt: uploadTimestamp,
      });

      storedCount++;
    }

    console.log(`[Ingestion] Successfully indexed web URL "${docTitle}" into Data Vault (${storedCount} chunks).`);

    return res.status(200).json({
      success: true,
      message: 'Web page scraped, archived in Data Vault, and indexed successfully.',
      data: {
        bookTitle: docTitle,
        category,
        language,
        url,
        uploadedBy: supervisorId,
        uploadType: 'url',
        rawFileUrl: vaultResult.rawFileUrl,
        storageReference: vaultResult.storageReference,
        totalChunks: storedCount,
        characterCount: scrapedData.content.length,
        fileSize: vaultResult.fileSize,
        sourceType: 'url',
      },
    });
  } catch (error) {
    console.error('[Ingestion] Error during URL scraping pipeline:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Failed to scrape and index web URL.',
    });
  }
}

/**
 * Downloads a raw file from Data Vault by filename and optional category.
 */
async function downloadVaultFile(req, res) {
  try {
    const { filename, category } = req.params;
    if (!filename) {
      return res.status(400).json({ success: false, error: 'Filename is required.' });
    }

    const filePath = storageService.getVaultFilePath(filename, category);
    if (!filePath || !fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, error: 'File not found in Data Vault.' });
    }

    res.download(filePath, filename);
  } catch (err) {
    console.error('[Storage] Error downloading vault file:', err);
    res.status(500).json({ success: false, error: 'Failed to access Data Vault file.' });
  }
}

/**
 * Lists all indexed documents.
 */
async function listIndexedBooks(req, res) {
  try {
    const books = await getStoredBooksSummary();
    return res.status(200).json({
      success: true,
      data: books,
    });
  } catch (error) {
    console.error('[Ingestion] Error listing books:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve indexed documents.',
    });
  }
}

module.exports = {
  processBookUpload,
  processRawTextInput,
  processMediaUpload,
  processUrlScraping,
  downloadVaultFile,
  listIndexedBooks,
};
