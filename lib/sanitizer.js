'use strict';

// ============================================================
// PageSpeak HTML Sanitizer (Security Layer 7)
// Allowlist-only sanitizer for AI response rendering.
// No external dependencies.
// ============================================================

/**
 * Sanitize HTML string from AI responses.
 * Only allows safe tags and strips everything else.
 *
 * @param {string} html - Raw HTML/markdown-converted HTML from AI
 * @returns {string} Sanitized HTML safe for innerHTML
 */
function sanitizeHTML(html) {
  if (!html) return '';

  // Parse into a temporary document
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Walk the DOM and rebuild with only allowed elements
  const clean = sanitizeNode(doc.body);
  return clean.innerHTML;
}

// Allowed tags (lowercase)
const ALLOWED_TAGS = new Set([
  'p', 'br', 'strong', 'b', 'em', 'i', 'u',
  'ul', 'ol', 'li',
  'code', 'pre',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'blockquote', 'hr',
  'span', 'div',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

// Allowed attributes — none needed for AI response rendering
// Removing 'class' eliminates CSS injection via attribute values
const ALLOWED_ATTRS = new Set([]);

/**
 * Recursively sanitize a DOM node.
 * Returns a clean document fragment.
 */
function sanitizeNode(node) {
  const fragment = document.createDocumentFragment();

  for (const child of node.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      fragment.appendChild(document.createTextNode(child.textContent));
      continue;
    }

    if (child.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = child.tagName.toLowerCase();

    if (!ALLOWED_TAGS.has(tag)) {
      // Not allowed — inline its text content (don't drop it)
      const inner = sanitizeNode(child);
      fragment.appendChild(inner);
      continue;
    }

    // Create clean element
    const clean = document.createElement(tag);

    // Copy only allowed attributes
    for (const attr of child.attributes) {
      if (ALLOWED_ATTRS.has(attr.name.toLowerCase())) {
        // Extra check: no javascript: in attribute values
        if (!/javascript\s*:/i.test(attr.value)) {
          clean.setAttribute(attr.name, attr.value);
        }
      }
    }

    // Recurse into children
    const childContent = sanitizeNode(child);
    clean.appendChild(childContent);
    fragment.appendChild(clean);
  }

  return fragment;
}

/**
 * Convert simple markdown-like text to safe HTML.
 * Handles: **bold**, *italic*, `code`, ```code blocks```, lists, headings.
 */
function markdownToSafeHTML(text) {
  if (!text) return '';

  let html = escapeHTML(text);

  // Code blocks (``` ... ```)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>');

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');

  // Headings (### heading)
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');

  // Unordered lists
  html = html.replace(/^- (.+)$/gm, '<li>$1</li>');
  html = html.replace(/(<li>.*<\/li>\n?)+/g, '<ul>$&</ul>');

  // Numbered lists
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>');

  // Paragraphs (double newline)
  html = html.replace(/\n\n/g, '</p><p>');
  html = '<p>' + html + '</p>';

  // Single newlines to <br> (except inside pre/code)
  html = html.replace(/(?<!<\/?(pre|code|li|ul|ol|h[1-6]|p)>)\n/g, '<br>');

  // Clean up empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, '');

  return html;
}

/**
 * Escape HTML special characters.
 */
function escapeHTML(text) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Export for use in side panel
if (typeof globalThis !== 'undefined') {
  globalThis.PageSpeakSanitizer = { sanitizeHTML, markdownToSafeHTML, escapeHTML };
}
