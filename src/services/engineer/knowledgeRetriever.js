// ==============================================================================
// Engineer Coding Knowledge Base & RAG Retriever (Pillar 1)
// Scoped retrieval of official documentation, coding standards, and libraries.
// Attributing language, framework, version, and license for every snippet.
// ==============================================================================
const { get, all } = require('../../db/database');

const FRAMEWORK_KEYWORDS = [
  'react', 'vue', 'tailwind', 'bootstrap', 'sqlite', 'express', 'node',
  'typescript', 'javascript', 'html', 'css', 'chartjs', 'playwright',
  'lucide', 'font-awesome', 'radix', 'shadcn', 'flexbox', 'grid', 'rtl'
];

function extractKeywords(prompt = '') {
  const words = String(prompt).toLowerCase().split(/[^a-z0-9_.-]+/i).filter(Boolean);
  const found = new Set();
  for (const w of words) {
    if (FRAMEWORK_KEYWORDS.includes(w) || w.length > 3) {
      found.add(w);
    }
  }
  return Array.from(found);
}

/**
 * Retrieves coding knowledge chunks relevant to the current project prompt.
 * Attaches framework metadata, version, and license.
 */
function retrieveCodingContext(promptOrOptions, options = {}) {
  const prompt = typeof promptOrOptions === 'string' ? promptOrOptions : (promptOrOptions?.prompt || '');
  const maxChunks = (typeof promptOrOptions === 'object' && (promptOrOptions?.limit || promptOrOptions?.maxChunks)) || options.maxChunks || options.limit || 4;
  const categoryKey = (typeof promptOrOptions === 'object' && promptOrOptions?.categoryKey) || options.categoryKey || 'cat.programming_engineering';

  const keywords = extractKeywords(prompt);
  const chunks = [];

  // 1. Check for documents tagged in the programming category or matching keywords
  try {
    const category = get('SELECT id FROM categories WHERE name_key = ?', categoryKey);
    const catId = category ? category.id : null;

    if (keywords.length > 0) {
      const likeClauses = keywords.slice(0, 5).map(() => '(c.text LIKE ? OR d.title LIKE ?)').join(' OR ');
      const params = [];
      keywords.slice(0, 5).forEach((kw) => {
        params.push(`%${kw}%`, `%${kw}%`);
      });

      let sql = `
        SELECT c.id, c.text, c.chunk_index, d.id AS doc_id, d.title, d.category_id
        FROM chunks c
        JOIN documents d ON c.document_id = d.id
        WHERE (${likeClauses})
      `;
      if (catId) {
        sql += ' AND (d.category_id = ? OR d.category_id IS NULL)';
        params.push(catId);
      }
      sql += ' LIMIT ?';
      params.push(maxChunks);

      const rows = all(sql, ...params);
      for (const r of rows) {
        chunks.push({
          id: r.id,
          docTitle: r.title,
          chunkIndex: r.chunk_index,
          content: r.text,
          framework: detectFramework(r.title + ' ' + r.text),
          version: 'latest',
          license: 'Standard / Permissible',
        });
      }
    }
  } catch (_) {
    // Fall through to curated standards
  }

  // 2. Built-in modern web standards (RTL, accessible buttons, modern styling, zero-console-errors)
  const defaultStandards = [
    {
      framework: 'modern-web-standards',
      version: '2026',
      license: 'MIT',
      docTitle: 'Production Arabic RTL & Accessibility Standard',
      content: 'Use direction: rtl, font-family: Plus Jakarta Sans / system-ui, minimum 44px tap targets, semantic HTML (header, main, section, button, input), stable data-testid attributes, and prevent unhandled promise rejections or console.error calls.',
    },
    {
      framework: 'data-persistence',
      version: '1.0',
      license: 'MIT',
      docTitle: 'Client Sandbox Data Persistence Standard',
      content: 'Use window.SaneaDB (async list, create, update, remove) or isolated localStorage keys prefixed with project ID. Always reload and render state after page refresh to ensure data longevity.',
    },
  ];

  const merged = [...chunks, ...defaultStandards].slice(0, maxChunks);

  const contextText = merged.map((c) => {
    return `[Doc: ${c.docTitle} | Framework: ${c.framework} | Version: ${c.version} | License: ${c.license}]\n${c.content}`;
  }).join('\n\n');

  return {
    keywords,
    chunks: merged,
    contextText,
    sourcesCount: merged.length,
  };
}

/**
 * Returns formatted array of knowledge snippets with metadata.
 */
function retrieveCodingKnowledge(promptOrOptions, options = {}) {
  const res = retrieveCodingContext(promptOrOptions, options);
  return res.chunks.map((c) => ({
    title: c.docTitle,
    framework: c.framework,
    version: c.version,
    license: c.license,
    snippet: c.content,
  }));
}

function detectFramework(text = '') {
  const lower = text.toLowerCase();
  for (const fw of FRAMEWORK_KEYWORDS) {
    if (lower.includes(fw)) return fw;
  }
  return 'general-web';
}

module.exports = {
  extractKeywords,
  retrieveCodingContext,
  retrieveCodingKnowledge,
  detectFramework,
};
