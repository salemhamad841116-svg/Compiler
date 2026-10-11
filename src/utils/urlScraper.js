/**
 * Backend Web URL Scraper & Article Extractor.
 *
 * Implements native HTTP fetching with browser-grade headers, anti-bot/Cloudflare
 * challenge detection, timeout protection, and clean article extraction.
 * No API keys are required from the client or UI.
 *
 * @param {string} targetUrl - Web URL to scrape.
 * @returns {Promise<{ title: string, content: string, url: string }>}
 */
async function scrapeWebUrl(targetUrl) {
  if (!targetUrl || typeof targetUrl !== 'string') {
    throw new Error('Please provide a valid web URL.');
  }

  let formattedUrl = targetUrl.trim();
  if (!formattedUrl.startsWith('http://') && !formattedUrl.startsWith('https://')) {
    formattedUrl = `https://${formattedUrl}`;
  }

  try {
    new URL(formattedUrl);
  } catch (err) {
    throw new Error('Invalid URL format. Please provide a complete URL starting with http:// or https://');
  }

  // Optional backend-only scraping proxy or API from .env (never exposed to UI)
  const proxyEndpoint = process.env.SCRAPING_PROXY_URL;
  const fetchUrl = proxyEndpoint ? `${proxyEndpoint}?url=${encodeURIComponent(formattedUrl)}` : formattedUrl;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15-second timeout

  const defaultScrapeErrorMessage =
    'Cannot extract text from this specific URL. The site may be protected or require login. Please copy and paste the text manually using the "Paste Raw Text" tab.';

  let response;
  try {
    response = await fetch(fetchUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9,ar;q=0.8',
        'Cache-Control': 'no-cache',
        'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Ch-Ua-Platform': '"macOS"',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'none',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1',
      },
      redirect: 'follow',
    });
  } catch (fetchErr) {
    clearTimeout(timeoutId);
    if (fetchErr.name === 'AbortError') {
      throw new Error(
        'Connection timed out while reaching the website. ' + defaultScrapeErrorMessage
      );
    }
    throw new Error(
      `Unable to reach website (${fetchErr.message}). ` + defaultScrapeErrorMessage
    );
  } finally {
    clearTimeout(timeoutId);
  }

  // Handle HTTP status codes indicating protection or failure
  if (response.status === 403 || response.status === 401 || response.status === 429) {
    throw new Error(defaultScrapeErrorMessage);
  }

  if (response.status === 404) {
    throw new Error('The requested web page was not found (HTTP 404). Please verify the URL.');
  }

  if (!response.ok) {
    throw new Error(defaultScrapeErrorMessage);
  }

  const html = await response.text();

  // Detect Cloudflare / Anti-bot verification challenge pages
  const lowerHtml = html.toLowerCase();
  const isCloudflareChallenge =
    lowerHtml.includes('cf-browser-verification') ||
    lowerHtml.includes('challenge-platform') ||
    lowerHtml.includes('just a moment...') ||
    lowerHtml.includes('ddos-guard') ||
    lowerHtml.includes('turnstile') ||
    lowerHtml.includes('please verify you are a human') ||
    (lowerHtml.includes('captcha') && html.length < 5000);

  if (isCloudflareChallenge) {
    throw new Error(defaultScrapeErrorMessage);
  }

  // 1. Extract Page Title
  let title = '';
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  const twitterTitleMatch = html.match(/<meta[^>]*name=["']twitter:title["'][^>]*content=["']([^"']+)["']/i);
  const titleTagMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);

  if (ogTitleMatch && ogTitleMatch[1]) {
    title = ogTitleMatch[1];
  } else if (twitterTitleMatch && twitterTitleMatch[1]) {
    title = twitterTitleMatch[1];
  } else if (titleTagMatch && titleTagMatch[1]) {
    title = titleTagMatch[1];
  } else if (h1Match && h1Match[1]) {
    title = h1Match[1];
  } else {
    title = new URL(formattedUrl).hostname;
  }

  title = decodeHtmlEntities(title).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();

  // 2. Extract & Clean Article / Body Content
  let cleaned = html
    // Remove scripts, styles, noscript, svg, and iframes
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, ' ')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, ' ')
    .replace(/<noscript\b[^<]*(?:(?!<\/noscript>)<[^<]*)*<\/noscript>/gi, ' ')
    .replace(/<svg\b[^<]*(?:(?!<\/svg>)<[^<]*)*<\/svg>/gi, ' ')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, ' ')
    // Remove navigation, headers, footers, sidebars, and dialogs
    .replace(/<header\b[^<]*(?:(?!<\/header>)<[^<]*)*<\/header>/gi, ' ')
    .replace(/<footer\b[^<]*(?:(?!<\/footer>)<[^<]*)*<\/footer>/gi, ' ')
    .replace(/<nav\b[^<]*(?:(?!<\/nav>)<[^<]*)*<\/nav>/gi, ' ')
    .replace(/<aside\b[^<]*(?:(?!<\/aside>)<[^<]*)*<\/aside>/gi, ' ');

  // Prioritize <article> or <main> container if present with substantial content
  const articleMatch = cleaned.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
                       cleaned.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);

  if (articleMatch && articleMatch[1] && articleMatch[1].length > 200) {
    cleaned = articleMatch[1];
  }

  // Convert HTML block tags to newlines
  cleaned = cleaned
    .replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|blockquote|tr|section|article)>/gi, '\n')
    .replace(/<br\s*[\/]?>/gi, '\n');

  // Strip all remaining HTML tags
  cleaned = cleaned.replace(/<[^>]+>/g, ' ');

  // Decode HTML entities
  cleaned = decodeHtmlEntities(cleaned);

  // Normalize whitespace and paragraphs
  const formattedText = cleaned
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  if (!formattedText || formattedText.length < 50) {
    throw new Error(defaultScrapeErrorMessage);
  }

  return {
    title,
    content: formattedText,
    url: formattedUrl,
  };
}

/**
 * Decodes common HTML entities.
 * @param {string} str
 * @returns {string}
 */
function decodeHtmlEntities(str) {
  if (!str) return '';
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (match, dec) => String.fromCharCode(dec));
}

module.exports = { scrapeWebUrl };

