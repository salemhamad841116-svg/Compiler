const { EPub } = require('epub2');
const striptags = require('striptags');

/**
 * Decodes common HTML entities into their plain text characters.
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&#(\d+);/g, (_, code) => {
      const num = parseInt(code, 10);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    })
    .replace(/&#x([a-fA-F0-9]+);/gi, (_, hex) => {
      const num = parseInt(hex, 16);
      return Number.isFinite(num) ? String.fromCharCode(num) : '';
    });
}

/**
 * Strips HTML tags and normalizes whitespace and paragraphs.
 * @param {string} html
 * @returns {string}
 */
function cleanText(html) {
  if (!html) return '';
  const withBreaks = html.replace(/(<\/(?:p|div|h[1-6]|li|tr|section|article)>|<(?:br|hr)\s*\/?>)/gi, '$1\n');
  const stripped = striptags(withBreaks);
  const decoded = decodeHtmlEntities(stripped);
  return decoded
    .replace(/\r\n|\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

/**
 * Parses an EPUB file into structured chapters and plain text.
 * @param {string} filePath Absolute path to the EPUB file.
 * @returns {Promise<{
 *   title: string|null,
 *   metadata: object,
 *   chapters: Array<{ id: string, title: string, order: number, text: string }>,
 *   text: string,
 *   chapterCount: number
 * }>}
 */
function parseEpub(filePath) {
  return new Promise((resolve, reject) => {
    let epub;
    try {
      epub = new EPub(filePath);
    } catch (err) {
      return reject(err);
    }

    epub.on('error', (err) => {
      reject(err);
    });

    epub.on('end', async () => {
      try {
        const metadata = epub.metadata || {};
        const title = (metadata.title && typeof metadata.title === 'string')
          ? metadata.title.trim()
          : (metadata.title && metadata.title._) || null;

        const flow = Array.isArray(epub.flow) ? epub.flow : [];
        const chapters = [];
        let fullText = '';

        for (let i = 0; i < flow.length; i++) {
          const item = flow[i];
          if (!item || !item.id) continue;

          const rawOrHtml = await new Promise((res) => {
            epub.getChapter(item.id, (err, text) => {
              if (err) {
                epub.getChapterRaw(item.id, (errRaw, raw) => {
                  if (errRaw) return res('');
                  return res(raw || '');
                });
              } else {
                res(text || '');
              }
            });
          });

          const cleaned = cleanText(rawOrHtml);
          if (cleaned) {
            const chTitle = item.title && typeof item.title === 'string'
              ? item.title.trim()
              : `Chapter ${chapters.length + 1}`;

            chapters.push({
              id: item.id,
              title: chTitle,
              order: chapters.length + 1,
              text: cleaned,
            });
            fullText += (fullText ? '\n\n' : '') + cleaned;
          }
        }

        resolve({
          title,
          metadata,
          chapters,
          text: fullText,
          chapterCount: chapters.length,
        });
      } catch (err) {
        reject(err);
      }
    });

    epub.parse();
  });
}

module.exports = {
  parseEpub,
  cleanText,
  decodeHtmlEntities,
};
