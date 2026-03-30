'use strict';

// ============================================================
// PageSpeak Text Extractor
// Readability-style content extraction for "Read entire page"
// No external dependencies — vanilla JS only
// ============================================================

/**
 * Extract the main readable content from the current page.
 * Uses heuristics similar to Readability.js to find the primary
 * content block and extract clean text.
 *
 * @returns {string} The extracted page text, or empty string if none found.
 */
function extractPageContent() {
  // Priority 1: Check for <article> element
  const article = document.querySelector('article');
  if (article) {
    const text = getCleanText(article);
    if (text.length > 200) return text;
  }

  // Priority 2: Check for common content selectors
  const contentSelectors = [
    '[role="main"]',
    'main',
    '.article-body',
    '.article-content',
    '.post-content',
    '.entry-content',
    '.content-body',
    '.story-body',
    '#article-body',
    '#content',
    '.markdown-body', // GitHub
  ];

  for (const selector of contentSelectors) {
    const el = document.querySelector(selector);
    if (el) {
      const text = getCleanText(el);
      if (text.length > 200) return text;
    }
  }

  // Priority 3: Score all container elements and pick the best one
  const candidates = document.querySelectorAll('div, section, td');
  let bestElement = null;
  let bestScore = 0;

  for (const el of candidates) {
    const score = scoreElement(el);
    if (score > bestScore) {
      bestScore = score;
      bestElement = el;
    }
  }

  if (bestElement && bestScore > 20) {
    return getCleanText(bestElement);
  }

  // Fallback: just get all body text
  return getCleanText(document.body);
}

/**
 * Score an element based on how likely it is to be the main content.
 */
function scoreElement(el) {
  let score = 0;

  // Text length is the strongest signal
  const text = getCleanText(el);
  const wordCount = text.split(/\s+/).length;

  if (wordCount < 50) return 0; // Too short to be main content

  score += Math.min(wordCount / 10, 50); // Up to 50 points for word count

  // Bonus for paragraph density
  const paragraphs = el.querySelectorAll('p');
  score += Math.min(paragraphs.length * 3, 30);

  // Bonus for content-like class/id names
  const id = (el.id || '').toLowerCase();
  const className = (el.className || '').toString().toLowerCase();
  const positive = /article|content|post|entry|story|text|body|main/;
  const negative = /sidebar|nav|menu|footer|header|comment|ad|social|share|related|widget|banner/;

  if (positive.test(id) || positive.test(className)) score += 25;
  if (negative.test(id) || negative.test(className)) score -= 50;

  // Penalty for too many links (navigation-heavy sections)
  const links = el.querySelectorAll('a');
  const linkTextLen = Array.from(links).reduce((sum, a) => sum + (a.textContent || '').length, 0);
  const linkDensity = text.length > 0 ? linkTextLen / text.length : 1;
  if (linkDensity > 0.4) score -= 30;

  // Penalty for being too deep in the DOM (probably not the main container)
  let depth = 0;
  let parent = el.parentElement;
  while (parent && parent !== document.body) {
    depth++;
    parent = parent.parentElement;
  }
  if (depth > 10) score -= 10;

  return score;
}

/**
 * Extract clean text from an element, excluding scripts, styles,
 * navigation, and other non-content elements.
 */
function getCleanText(el) {
  // Clone so we don't modify the live DOM
  const clone = el.cloneNode(true);

  // Remove elements that are never content
  const removeSelectors = [
    'script', 'style', 'noscript', 'iframe', 'svg',
    'nav', 'header', 'footer',
    '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
    '[aria-hidden="true"]',
    '.ad', '.ads', '.advertisement', '.social-share',
    '.comments', '.comment-section',
    '.sidebar', '.related-posts',
  ];

  for (const selector of removeSelectors) {
    const els = clone.querySelectorAll(selector);
    for (const e of els) {
      e.remove();
    }
  }

  // Get text content and clean up whitespace
  let text = clone.textContent || '';
  text = text
    .replace(/\t/g, ' ')
    .replace(/ {2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

  return text;
}

// Export for use by content script
if (typeof globalThis !== 'undefined') {
  globalThis.PageSpeakExtractor = { extractPageContent };
}
