'use strict';

// ============================================================
// PageSpeak Content Script
// Shadow DOM floating UI, selection detection, playback controls,
// keep-alive port, service worker messaging, input sanitization
// ============================================================

// Debug: confirm content script loaded (visible in page's DevTools console)
console.info('PageSpeak content script loaded on:', window.location.href);

/**
 * Check if the extension context is still valid.
 * After extension reload/update, chrome.runtime becomes undefined
 * on pages that still have the old content script running.
 */
function isExtensionContextValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

/**
 * Safe wrapper for chrome.runtime.sendMessage.
 * Silently fails if the extension context has been invalidated.
 */
function safeSendMessage(message, callback) {
  if (!isExtensionContextValid()) return;
  try {
    chrome.runtime.sendMessage(message, (response) => {
      // Check for extension context errors before invoking callback
      if (chrome.runtime.lastError) {
        // Service worker may be restarting — ignore gracefully
        return;
      }
      if (callback) callback(response);
    });
  } catch (e) {
    // Extension context invalidated — page needs a refresh
  }
}

// --- Keep-alive port connection ---
let keepAlivePort = null;

function connectKeepAlive() {
  if (keepAlivePort) return;
  if (!isExtensionContextValid()) return;
  try {
    keepAlivePort = chrome.runtime.connect({ name: 'pagespeak-keepalive' });
    keepAlivePort.onDisconnect.addListener(() => {
      keepAlivePort = null;
    });
  } catch (e) {
    keepAlivePort = null;
  }
}

function disconnectKeepAlive() {
  if (keepAlivePort) {
    try { keepAlivePort.disconnect(); } catch (e) { /* already disconnected */ }
    keepAlivePort = null;
  }
}

// ============================================================
// Security Layer 4: Input Sanitization
// ============================================================

/**
 * Sanitize text from web pages before sending to service worker.
 * Strips HTML tags and rejects suspicious content.
 */
function sanitizeText(text) {
  if (!text) return '';

  // window.getSelection().toString() already returns plain text,
  // but we strip any residual HTML tags as defense-in-depth
  let clean = text
    .replace(/<[^>]*>/g, '')           // Strip HTML tags
    .replace(/\s+/g, ' ')              // Normalize whitespace
    .trim();

  return clean;
}

// ============================================================
// State
// ============================================================
let isReading = false;
let isPaused = false;
let lastSelectionText = '';
let currentSpeed = 1.0;
let highlightEnabled = true;
let highlightColor = '#FFFF00';

// ============================================================
// Word Tracking State
// ============================================================

// Maps character offsets in the TTS text to DOM text node positions
// Each entry: { node: TextNode, offset: number, length: number }
let charMap = [];

// Tracks cumulative char offset per chunk
let chunkOffsets = [];

// The full text being read (for mapping)
let readingFullText = '';

// Highlight overlay element (inside Shadow DOM)
let highlightOverlay = null;

// Whether the current voice supports word boundary events
let wordEventsSupported = true;
let wordEventReceived = false;
let wordEventCheckTimer = null;

// ============================================================
// Shadow DOM Floating UI
// ============================================================

// Host element for the Shadow DOM container
let shadowHost = null;
let shadowRoot = null;

// UI element references (inside shadow DOM)
let floatingBtn = null;
let controlBar = null;

/**
 * Create the Shadow DOM host and build the floating UI elements.
 * Called once on first text selection.
 */
function createShadowUI() {
  if (shadowHost) return;

  // Create host element — sits outside normal page flow
  shadowHost = document.createElement('pagespeak-ui');
  shadowHost.setAttribute('aria-hidden', 'true');
  // Prevent host from affecting page layout
  shadowHost.style.cssText = 'position:fixed;z-index:2147483647;top:0;left:0;width:0;height:0;overflow:visible;pointer-events:none;';
  document.documentElement.appendChild(shadowHost);

  // Closed shadow DOM — host page cannot access internals
  shadowRoot = shadowHost.attachShadow({ mode: 'closed' });

  // Inject styles into shadow DOM
  const style = document.createElement('style');
  style.textContent = getFloatingStyles();
  shadowRoot.appendChild(style);

  // --- Floating Play Button ---
  floatingBtn = document.createElement('button');
  floatingBtn.className = 'ps-float-btn ps-hidden';
  floatingBtn.setAttribute('aria-label', 'Read selected text aloud');
  floatingBtn.setAttribute('tabindex', '0');

  // Speaker icon (SVG, no external resources)
  floatingBtn.innerHTML = getSpeakerSVG();

  floatingBtn.addEventListener('click', onFloatingBtnClick);
  floatingBtn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onFloatingBtnClick();
    }
  });
  shadowRoot.appendChild(floatingBtn);

  // --- Control Bar (play/pause/stop/speed) ---
  controlBar = document.createElement('div');
  controlBar.className = 'ps-control-bar ps-hidden';
  controlBar.setAttribute('role', 'toolbar');
  controlBar.setAttribute('aria-label', 'Reading controls');

  // Pause button
  const pauseBtn = document.createElement('button');
  pauseBtn.className = 'ps-ctrl-btn ps-pause-btn';
  pauseBtn.setAttribute('aria-label', 'Pause reading');
  pauseBtn.setAttribute('tabindex', '0');
  pauseBtn.innerHTML = getPauseSVG();
  pauseBtn.addEventListener('click', onPauseClick);
  controlBar.appendChild(pauseBtn);

  // Resume button (hidden initially)
  const resumeBtn = document.createElement('button');
  resumeBtn.className = 'ps-ctrl-btn ps-resume-btn ps-hidden';
  resumeBtn.setAttribute('aria-label', 'Resume reading');
  resumeBtn.setAttribute('tabindex', '0');
  resumeBtn.innerHTML = getPlaySVG();
  resumeBtn.addEventListener('click', onResumeClick);
  controlBar.appendChild(resumeBtn);

  // Stop button
  const stopBtn = document.createElement('button');
  stopBtn.className = 'ps-ctrl-btn ps-stop-btn';
  stopBtn.setAttribute('aria-label', 'Stop reading');
  stopBtn.setAttribute('tabindex', '0');
  stopBtn.innerHTML = getStopSVG();
  stopBtn.addEventListener('click', onStopClick);
  controlBar.appendChild(stopBtn);

  // Speed button
  const speedBtn = document.createElement('button');
  speedBtn.className = 'ps-ctrl-btn ps-speed-btn';
  speedBtn.setAttribute('aria-label', 'Change reading speed');
  speedBtn.setAttribute('tabindex', '0');
  speedBtn.textContent = '1x';
  speedBtn.addEventListener('click', onSpeedClick);
  controlBar.appendChild(speedBtn);

  shadowRoot.appendChild(controlBar);
}

// ============================================================
// Floating Button — Show / Hide / Position
// ============================================================

/**
 * Show the floating play button near the end of a text selection.
 */
function showFloatingButton(x, y) {
  if (!floatingBtn) return;

  // Smart positioning: keep button within viewport
  const btnSize = 40;
  const margin = 8;
  const viewW = window.innerWidth;
  const viewH = window.innerHeight;

  let posX = x + margin;
  let posY = y - btnSize - margin;

  // Clamp to viewport
  if (posX + btnSize > viewW) posX = viewW - btnSize - margin;
  if (posX < margin) posX = margin;
  if (posY < margin) posY = y + margin; // Flip below selection
  if (posY + btnSize > viewH) posY = viewH - btnSize - margin;

  floatingBtn.style.left = posX + 'px';
  floatingBtn.style.top = posY + 'px';
  floatingBtn.classList.remove('ps-hidden');
}

function hideFloatingButton() {
  if (floatingBtn) {
    floatingBtn.classList.add('ps-hidden');
  }
}

/**
 * Show the control bar at the same position as the floating button.
 */
function showControlBar() {
  if (!controlBar || !floatingBtn) return;

  const left = parseFloat(floatingBtn.style.left) || 0;
  const top = parseFloat(floatingBtn.style.top) || 0;

  controlBar.style.left = left + 'px';
  controlBar.style.top = top + 'px';

  // Smart positioning: keep bar in viewport
  const viewW = window.innerWidth;
  const barWidth = 170;
  if (left + barWidth > viewW) {
    controlBar.style.left = (viewW - barWidth - 8) + 'px';
  }

  controlBar.classList.remove('ps-hidden');
  hideFloatingButton();
  updateControlBarState();
}

function hideControlBar() {
  if (controlBar) {
    controlBar.classList.add('ps-hidden');
  }
}

function updateControlBarState() {
  if (!controlBar) return;

  const pauseBtn = controlBar.querySelector('.ps-pause-btn');
  const resumeBtn = controlBar.querySelector('.ps-resume-btn');
  const speedBtn = controlBar.querySelector('.ps-speed-btn');

  if (isPaused) {
    pauseBtn.classList.add('ps-hidden');
    resumeBtn.classList.remove('ps-hidden');
  } else {
    pauseBtn.classList.remove('ps-hidden');
    resumeBtn.classList.add('ps-hidden');
  }

  speedBtn.textContent = currentSpeed.toFixed(1).replace(/\.0$/, '') + 'x';
}

// ============================================================
// Word Tracking — Character-to-DOM Mapping
// ============================================================

/**
 * Build a character position map from the current selection or page text.
 * Maps each character offset in the TTS text to a DOM text node + offset.
 */
function buildCharMap(fullText) {
  charMap = [];
  chunkOffsets = [];
  readingFullText = fullText;

  if (!fullText) return;

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    // Page read mode — build map from body
    buildCharMapFromElement(document.body, fullText);
    return;
  }

  const range = selection.getRangeAt(0);
  buildCharMapFromRange(range, fullText);
}

/**
 * Walk text nodes within a Range and map character positions.
 */
function buildCharMapFromRange(range, fullText) {
  const textNodes = [];
  collectTextNodes(range.commonAncestorContainer, textNodes);

  // Filter to nodes within the range
  const filtered = textNodes.filter((node) => {
    return range.intersectsNode(node);
  });

  mapTextNodesToChars(filtered, fullText);
}

/**
 * Walk text nodes within an element and map character positions.
 */
function buildCharMapFromElement(element, fullText) {
  const textNodes = [];
  collectTextNodes(element, textNodes);
  mapTextNodesToChars(textNodes, fullText);
}

/**
 * Recursively collect all text nodes under a parent.
 */
function collectTextNodes(node, result) {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent;
    if (text && text.trim().length > 0) {
      result.push(node);
    }
    return;
  }

  // Skip hidden elements, scripts, styles
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName;
    if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return;
    if (tag === 'PAGESPEAK-UI') return; // Skip our own UI

    const style = window.getComputedStyle(node);
    if (style.display === 'none' || style.visibility === 'hidden') return;
  }

  for (const child of node.childNodes) {
    collectTextNodes(child, result);
  }
}

/**
 * Map text nodes to character positions in the full TTS text.
 * Uses a sliding window approach to find where each node's text
 * appears in the full text string.
 */
function mapTextNodesToChars(textNodes, fullText) {
  // Normalize full text for matching (same normalization as service worker)
  const normalizedFull = fullText.replace(/\s+/g, ' ').trim();
  let searchPos = 0;

  for (const node of textNodes) {
    const nodeText = node.textContent.replace(/\s+/g, ' ').trim();
    if (!nodeText) continue;

    // Find this node's text in the full text starting from searchPos
    const idx = normalizedFull.indexOf(nodeText, searchPos);
    if (idx === -1) {
      // Try partial match — the node text might span across whitespace normalization
      // Skip this node if we can't find it
      continue;
    }

    // Map each character in this node
    for (let i = 0; i < nodeText.length; i++) {
      charMap[idx + i] = {
        node: node,
        // Map back to the original node offset (accounting for whitespace)
        offset: findOriginalOffset(node.textContent, i),
      };
    }

    searchPos = idx + nodeText.length;
  }
}

/**
 * Map a normalized text offset back to the original text node offset.
 */
function findOriginalOffset(originalText, normalizedOffset) {
  let normIdx = -1;
  let inWhitespace = true;

  for (let i = 0; i < originalText.length; i++) {
    const isSpace = /\s/.test(originalText[i]);

    if (!isSpace || (isSpace && !inWhitespace)) {
      if (!isSpace) {
        normIdx++;
        inWhitespace = false;
      } else {
        normIdx++;
        inWhitespace = true;
      }
    } else {
      // Consecutive whitespace — skip
      continue;
    }

    // Skip leading whitespace
    if (normIdx === -1) continue;

    if (normIdx >= normalizedOffset) {
      return i;
    }
  }

  return originalText.length - 1;
}

// ============================================================
// Word Highlighting — Overlay Approach
// ============================================================

/**
 * Create the highlight overlay element inside Shadow DOM.
 */
function createHighlightOverlay() {
  if (highlightOverlay) return;
  if (!shadowRoot) return;

  highlightOverlay = document.createElement('div');
  highlightOverlay.className = 'ps-highlight-overlay ps-hidden';
  shadowRoot.appendChild(highlightOverlay);
}

/**
 * Highlight a word on the page by positioning an overlay over it.
 * @param {number} globalCharIndex - Character index in the full text
 * @param {number} length - Length of the word
 */
function highlightWord(globalCharIndex, length) {
  if (!highlightEnabled) return;

  createHighlightOverlay();
  if (!highlightOverlay) return;

  // Find the DOM range for this word
  const wordRange = getWordRange(globalCharIndex, length);
  if (!wordRange) {
    highlightOverlay.classList.add('ps-hidden');
    return;
  }

  // Get bounding rect of the word
  const rect = wordRange.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    highlightOverlay.classList.add('ps-hidden');
    return;
  }

  // Position the highlight overlay
  highlightOverlay.style.left = rect.left + 'px';
  highlightOverlay.style.top = rect.top + 'px';
  highlightOverlay.style.width = rect.width + 'px';
  highlightOverlay.style.height = rect.height + 'px';
  highlightOverlay.style.backgroundColor = highlightColor;
  highlightOverlay.classList.remove('ps-hidden');

  // Auto-scroll to keep the word visible
  autoScrollToRect(rect);
}

/**
 * Create a DOM Range for a word at the given character position.
 */
function getWordRange(charIndex, length) {
  try {
    const startEntry = charMap[charIndex];
    const endEntry = charMap[Math.min(charIndex + length - 1, charMap.length - 1)];

    if (!startEntry || !endEntry) return null;
    if (!startEntry.node || !startEntry.node.parentNode) return null;

    const range = document.createRange();
    range.setStart(startEntry.node, Math.min(startEntry.offset, startEntry.node.length));

    if (endEntry.node === startEntry.node) {
      range.setEnd(endEntry.node, Math.min(endEntry.offset + 1, endEntry.node.length));
    } else {
      range.setEnd(endEntry.node, Math.min(endEntry.offset + 1, endEntry.node.length));
    }

    return range;
  } catch (e) {
    return null;
  }
}

/**
 * Clear the highlight overlay.
 */
function clearHighlight() {
  if (highlightOverlay) {
    highlightOverlay.classList.add('ps-hidden');
  }
}

/**
 * Auto-scroll to keep a rect visible in the viewport.
 */
function autoScrollToRect(rect) {
  const margin = 100; // Pixels of margin above/below
  const viewH = window.innerHeight;

  if (rect.top < margin) {
    // Word is above viewport
    window.scrollBy({ top: rect.top - margin, behavior: 'smooth' });
  } else if (rect.bottom > viewH - margin) {
    // Word is below viewport
    window.scrollBy({ top: rect.bottom - viewH + margin, behavior: 'smooth' });
  }
}

/**
 * Handle sentence-level fallback highlighting.
 * When word boundary events aren't available, highlight the entire chunk.
 */
function highlightChunkFallback(chunkIndex) {
  if (!highlightEnabled) return;
  if (chunkIndex >= chunkOffsets.length) return;

  const start = chunkOffsets[chunkIndex] || 0;
  const end = chunkIndex + 1 < chunkOffsets.length
    ? chunkOffsets[chunkIndex + 1]
    : readingFullText.length;

  // Highlight the first word of the chunk as an indicator
  const chunkText = readingFullText.substring(start, end);
  const firstWordMatch = chunkText.match(/\S+/);
  if (firstWordMatch) {
    highlightWord(start + firstWordMatch.index, firstWordMatch[0].length);
  }
}

// ============================================================
// UI Event Handlers
// ============================================================

function onFloatingBtnClick() {
  const selection = window.getSelection();
  const rawText = selection ? selection.toString().trim() : '';
  // Fall back to the last captured selection — clicking the button
  // often clears the selection on SPAs before we can read it.
  const text = sanitizeText(rawText || lastSelectionText);

  if (!text) return;

  safeSendMessage({ type: 'START_READING', text });
  showControlBar();
}

function onPauseClick() {
  safeSendMessage({ type: 'PAUSE_READING' });
}

function onResumeClick() {
  safeSendMessage({ type: 'RESUME_READING' });
}

function onStopClick() {
  safeSendMessage({ type: 'STOP_READING' });
  hideControlBar();
}

const SPEED_CYCLE = [0.75, 1.0, 1.5, 2.0, 2.5, 3.0];

function onSpeedClick() {
  const currentIndex = SPEED_CYCLE.indexOf(currentSpeed);
  const nextIndex = (currentIndex + 1) % SPEED_CYCLE.length;
  currentSpeed = SPEED_CYCLE[nextIndex];

  safeSendMessage({
    type: 'UPDATE_SETTINGS',
    settings: { speed: currentSpeed },
  });

  updateControlBarState();
}

// ============================================================
// Selection Detection
// ============================================================

// ============================================================
// Selection Detection
// Uses selectionchange as PRIMARY trigger (works on all sites
// including SPAs like claude.ai, ChatGPT that stopPropagation
// on mouseup). mouseup with capture:true is a BACKUP trigger.
// ============================================================

let selectionTimer = null;

/**
 * Core selection handler — called from both selectionchange and mouseup.
 * Shows floating button when text is selected, hides when cleared.
 */
function handleSelectionChange() {
  clearTimeout(selectionTimer);
  selectionTimer = setTimeout(() => {
    try {
      const selection = window.getSelection();
      const text = selection ? selection.toString().trim() : '';

      if (text && !isReading) {
        lastSelectionText = text;
        createShadowUI();
        if (selection.rangeCount > 0) {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          if (rect.width > 0 || rect.height > 0) {
            showFloatingButton(rect.right, rect.bottom);
          } else {
            // SPA fallback: rect can be 0x0 during React re-renders.
            // Retry once after a short delay to let the DOM settle.
            setTimeout(() => {
              try {
                const sel = window.getSelection();
                if (sel && sel.toString().trim() && sel.rangeCount > 0) {
                  const r = sel.getRangeAt(0).getBoundingClientRect();
                  if (r.width > 0 || r.height > 0) {
                    showFloatingButton(r.right, r.bottom);
                  }
                }
              } catch (_) { /* ignore */ }
            }, 50);
          }
        }
      } else if (!text) {
        lastSelectionText = '';
        if (!isReading) hideFloatingButton();
      }
    } catch (err) {
      console.error('PageSpeak selection error:', err);
    }
  }, 200);
}

// PRIMARY: selectionchange fires on document regardless of stopPropagation.
// This is what makes PageSpeak work on claude.ai, ChatGPT, and other SPAs.
document.addEventListener('selectionchange', handleSelectionChange);

// BACKUP: mouseup in capture phase (fires before SPA handlers can block it).
// Provides faster response on simple pages where selectionchange may be delayed.
document.addEventListener('mouseup', (evt) => {
  if (evt.target === shadowHost) return;
  handleSelectionChange();
}, true); // capture: true — fires before any SPA stopPropagation

// Hide floating UI when clicking elsewhere (not on our UI)
document.addEventListener('mousedown', (evt) => {
  // Don't hide if clicking on our own Shadow DOM host
  if (evt.target === shadowHost) return;
  // Don't hide while reading (control bar should stay)
  if (isReading) return;
  // Small delay to let the floating button click handler fire first
  setTimeout(() => {
    if (!isReading) hideFloatingButton();
  }, 100);
}, true); // capture phase for SPA compatibility

// Hide on scroll if not reading
let scrollTimer = null;
document.addEventListener('scroll', () => {
  if (!isReading) {
    hideFloatingButton();
  }
}, { passive: true });

// ============================================================
// Message Listener — responds to service worker messages
// ============================================================
if (isExtensionContextValid()) chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Error boundary: wrap entire handler so one feature failure doesn't crash others
  try {
    return handleMessage(message, sender, sendResponse);
  } catch (e) {
    console.error('PageSpeak message handler error:', e);
    sendResponse({ error: 'Internal error' });
    return false;
  }
});

function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'GET_SELECTION': {
      const selection = window.getSelection();
      const rawText = selection ? selection.toString().trim() : '';
      if (rawText) {
        sendResponse({ text: sanitizeText(rawText) });
      } else if (typeof PageSpeakExtractor !== 'undefined') {
        const pageText = sanitizeText(PageSpeakExtractor.extractPageContent());
        sendResponse({ text: pageText, isPageRead: true });
      } else {
        sendResponse({ text: '' });
      }
      break;
    }

    case 'READING_STARTED':
      isReading = true;
      isPaused = false;
      wordEventsSupported = true;
      wordEventReceived = false;
      connectKeepAlive();

      // Each feature wrapped independently — one failure won't block others
      try { createShadowUI(); showControlBar(); } catch (e) { console.error('PageSpeak UI error:', e); }
      try { createFocusLens(); if (dimmingEnabled) showDimming(); } catch (e) { console.error('PageSpeak lens/dimming error:', e); }
      try { if (focusLensEnabled && message.chunks && message.chunks.length > 0) updateFocusLens(message.chunks[0]); } catch (e) { /* non-critical */ }

      try {
        if (message.text) {
          buildCharMap(message.text);
          if (message.chunks) {
            // Calculate chunk offsets by finding each chunk's position in the full text
            const normalizedText = message.text.replace(/\s+/g, ' ').trim();
            chunkOffsets = [];
            let searchFrom = 0;
            for (const chunk of message.chunks) {
              const idx = normalizedText.indexOf(chunk, searchFrom);
              chunkOffsets.push(idx >= 0 ? idx : searchFrom);
              searchFrom = (idx >= 0 ? idx : searchFrom) + chunk.length;
            }
          }
        }
      } catch (e) { console.error('PageSpeak charMap error:', e); }

      clearTimeout(wordEventCheckTimer);
      wordEventCheckTimer = setTimeout(() => {
        if (!wordEventReceived && isReading) {
          wordEventsSupported = false;
          try { highlightChunkFallback(0); } catch (e) { /* non-critical */ }
        }
      }, 2000);
      break;

    case 'READING_STOPPED':
    case 'READING_COMPLETE':
      isReading = false;
      isPaused = false;
      disconnectKeepAlive();
      try { hideControlBar(); } catch (e) { /* non-critical */ }
      try { hideFloatingButton(); } catch (e) { /* non-critical */ }
      try { clearHighlight(); } catch (e) { /* non-critical */ }
      try { hideFocusLens(); } catch (e) { /* non-critical */ }
      try { hideDimming(); } catch (e) { /* non-critical */ }
      clearTimeout(wordEventCheckTimer);
      charMap = [];
      chunkOffsets = [];
      readingFullText = '';
      break;

    case 'READING_PAUSED':
      isPaused = true;
      try { updateControlBarState(); } catch (e) { /* non-critical */ }
      break;

    case 'READING_RESUMED':
      isPaused = false;
      try { updateControlBarState(); } catch (e) { /* non-critical */ }
      break;

    case 'WORD_BOUNDARY': {
      wordEventReceived = true;
      if (!highlightEnabled) break;
      try {
        const chunkOffset = chunkOffsets[message.chunkIndex] || 0;
        const globalIndex = chunkOffset + (message.charIndex || 0);
        const wordLength = message.charLength || 5;
        highlightWord(globalIndex, wordLength);
      } catch (e) { /* word tracking failure is non-critical */ }
      break;
    }

    case 'CHUNK_COMPLETE':
      try {
        if (!wordEventsSupported && highlightEnabled) {
          highlightChunkFallback(message.chunkIndex + 1);
        }
        if (focusLensEnabled && message.nextChunkText) {
          updateFocusLens(message.nextChunkText);
        }
      } catch (e) { /* non-critical */ }
      break;

    default:
      break;
  }

  return false;
}

// ============================================================
// SESSION 4: Focus Lens, Dimming, Reading Ruler, Dyslexia Toolkit
// ============================================================

// --- Focus Lens ---
let focusLensEl = null;
let focusLensEnabled = false;
let focusLensFontSize = 'medium';

function createFocusLens() {
  if (focusLensEl || !shadowRoot) return;

  focusLensEl = document.createElement('div');
  focusLensEl.className = 'ps-focus-lens ps-hidden';
  focusLensEl.setAttribute('role', 'status');
  focusLensEl.setAttribute('aria-live', 'polite');
  focusLensEl.setAttribute('aria-label', 'Current sentence being read');
  shadowRoot.appendChild(focusLensEl);
}

function updateFocusLens(text) {
  if (!focusLensEnabled || !focusLensEl) return;
  focusLensEl.textContent = text;
  focusLensEl.dataset.size = focusLensFontSize;
  focusLensEl.classList.remove('ps-hidden');
}

function hideFocusLens() {
  if (focusLensEl) focusLensEl.classList.add('ps-hidden');
}

// --- Distraction Dimming ---
let dimmingOverlayEl = null;
let dimmingEnabled = false;

function createDimmingOverlay() {
  if (dimmingOverlayEl) return;

  // The dimming overlay is injected directly into the page (not Shadow DOM)
  // because it needs to interact with page elements visually
  dimmingOverlayEl = document.createElement('pagespeak-dimming');
  dimmingOverlayEl.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);pointer-events:none;z-index:2147483640;display:none;transition:opacity 0.3s;';
  document.documentElement.appendChild(dimmingOverlayEl);
}

function showDimming() {
  if (!dimmingEnabled) return;
  createDimmingOverlay();
  if (dimmingOverlayEl) dimmingOverlayEl.style.display = 'block';
}

function hideDimming() {
  if (dimmingOverlayEl) dimmingOverlayEl.style.display = 'none';
}

// --- Reading Ruler ---
let readingRulerEl = null;
let readingRulerEnabled = false;

function createReadingRuler() {
  if (readingRulerEl || !shadowRoot) return;

  readingRulerEl = document.createElement('div');
  readingRulerEl.className = 'ps-reading-ruler ps-hidden';
  shadowRoot.appendChild(readingRulerEl);
}

function onMouseMoveRuler(e) {
  if (!readingRulerEnabled || !readingRulerEl) return;
  // Position the ruler centered on the mouse Y position
  const rulerHeight = 60;
  readingRulerEl.style.top = (e.clientY - rulerHeight / 2) + 'px';
  readingRulerEl.classList.remove('ps-hidden');
}

// Track ruler state for event listener management
let rulerListenerAttached = false;

function enableReadingRuler() {
  createShadowUI();
  createReadingRuler();
  if (!rulerListenerAttached) {
    document.addEventListener('mousemove', onMouseMoveRuler, { passive: true });
    rulerListenerAttached = true;
  }
  if (readingRulerEl) readingRulerEl.classList.remove('ps-hidden');
}

function disableReadingRuler() {
  if (readingRulerEl) readingRulerEl.classList.add('ps-hidden');
  if (rulerListenerAttached) {
    document.removeEventListener('mousemove', onMouseMoveRuler);
    rulerListenerAttached = false;
  }
}

// --- Font Picker (applied to page) ---
let pageFontStyleEl = null;

function applyPageFont(fontFamily) {
  if (fontFamily === 'default') {
    removePageFont();
    return;
  }

  if (!pageFontStyleEl) {
    pageFontStyleEl = document.createElement('style');
    pageFontStyleEl.setAttribute('data-pagespeak', 'font');
    document.head.appendChild(pageFontStyleEl);
  }

  if (!isExtensionContextValid()) return;
  const fontUrl = chrome.runtime.getURL('fonts/' + getFontFile(fontFamily));

  pageFontStyleEl.textContent = `
    @font-face {
      font-family: '${fontFamily}';
      src: url('${fontUrl}') format('woff2');
      font-weight: normal;
      font-style: normal;
      font-display: swap;
    }
    body, body * {
      font-family: '${fontFamily}', sans-serif !important;
    }
  `;
}

function getFontFile(fontFamily) {
  switch (fontFamily) {
    case 'OpenDyslexic': return 'OpenDyslexic-Regular.woff2';
    case 'Atkinson Hyperlegible': return 'AtkinsonHyperlegible-Regular.woff2';
    case 'Lexend': return 'Lexend-Regular.woff2';
    default: return '';
  }
}

function removePageFont() {
  if (pageFontStyleEl) {
    pageFontStyleEl.remove();
    pageFontStyleEl = null;
  }
}

// --- Line Spacing ---
let lineSpacingStyleEl = null;

function applyLineSpacing(spacing) {
  if (spacing === 1.5) { // default
    removeLineSpacing();
    return;
  }

  if (!lineSpacingStyleEl) {
    lineSpacingStyleEl = document.createElement('style');
    lineSpacingStyleEl.setAttribute('data-pagespeak', 'line-spacing');
    document.head.appendChild(lineSpacingStyleEl);
  }

  lineSpacingStyleEl.textContent = `
    body, body p, body li, body td, body span, body div {
      line-height: ${spacing} !important;
    }
  `;
}

function removeLineSpacing() {
  if (lineSpacingStyleEl) {
    lineSpacingStyleEl.remove();
    lineSpacingStyleEl = null;
  }
}

// --- Letter Spacing ---
let letterSpacingStyleEl = null;

function applyLetterSpacing(spacing) {
  if (spacing === 'normal') {
    removeLetterSpacing();
    return;
  }

  const values = { wide: '0.05em', 'extra-wide': '0.1em' };
  const val = values[spacing] || '0';

  if (!letterSpacingStyleEl) {
    letterSpacingStyleEl = document.createElement('style');
    letterSpacingStyleEl.setAttribute('data-pagespeak', 'letter-spacing');
    document.head.appendChild(letterSpacingStyleEl);
  }

  letterSpacingStyleEl.textContent = `
    body, body * {
      letter-spacing: ${val} !important;
    }
  `;
}

function removeLetterSpacing() {
  if (letterSpacingStyleEl) {
    letterSpacingStyleEl.remove();
    letterSpacingStyleEl = null;
  }
}

// --- Color Overlay / Tint ---
let colorOverlayEl = null;

function applyColorOverlay(enabled, color, opacity) {
  if (!enabled) {
    removeColorOverlay();
    return;
  }

  if (!colorOverlayEl) {
    colorOverlayEl = document.createElement('pagespeak-overlay');
    colorOverlayEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483639;transition:background 0.3s;';
    document.documentElement.appendChild(colorOverlayEl);
  }

  colorOverlayEl.style.background = color;
  colorOverlayEl.style.opacity = opacity;
  colorOverlayEl.style.display = 'block';
}

function removeColorOverlay() {
  if (colorOverlayEl) {
    colorOverlayEl.style.display = 'none';
  }
}

// ============================================================
// Load & Sync All Settings
// ============================================================

/**
 * Apply loaded settings to the content script UI.
 */
function applySettings(s) {
  if (!s) return;
  if (s.speed) currentSpeed = s.speed;
  if (s.highlightEnabled !== undefined) highlightEnabled = s.highlightEnabled;
  if (s.highlightColor) highlightColor = s.highlightColor;

  // Session 4 settings
  if (s.focusLensEnabled !== undefined) focusLensEnabled = s.focusLensEnabled;
  if (s.focusLensFontSize) focusLensFontSize = s.focusLensFontSize;
  if (s.dimmingEnabled !== undefined) dimmingEnabled = s.dimmingEnabled;
  if (s.readingRulerEnabled !== undefined) {
    readingRulerEnabled = s.readingRulerEnabled;
    if (readingRulerEnabled) enableReadingRuler();
  }
  if (s.fontFamily && s.fontFamily !== 'default') applyPageFont(s.fontFamily);
  if (s.lineSpacing && s.lineSpacing !== 1.5) applyLineSpacing(s.lineSpacing);
  if (s.letterSpacing && s.letterSpacing !== 'normal') applyLetterSpacing(s.letterSpacing);
  if (s.colorOverlayEnabled) applyColorOverlay(true, s.colorOverlayColor, s.colorOverlayOpacity);
}

// Primary: ask service worker for settings (includes defaults)
safeSendMessage({ type: 'GET_SETTINGS' }, (response) => {
  if (response && response.settings) applySettings(response.settings);
});

// Fallback: load directly from chrome.storage.sync in case the service
// worker message fails (e.g., service worker is still waking up).
// This ensures overlay and fonts appear even if the service worker is slow.
try {
  chrome.storage.sync.get(null, (settings) => {
    if (chrome.runtime.lastError) return;
    if (settings) applySettings(settings);
  });
} catch (e) { /* extension context invalid */ }

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;

  // Session 3 settings
  if (changes.highlightEnabled) highlightEnabled = changes.highlightEnabled.newValue;
  if (changes.highlightColor) {
    highlightColor = changes.highlightColor.newValue;
    if (highlightOverlay) highlightOverlay.style.backgroundColor = highlightColor;
  }
  if (changes.speed) currentSpeed = changes.speed.newValue;

  // Session 4 settings
  if (changes.focusLensEnabled) {
    focusLensEnabled = changes.focusLensEnabled.newValue;
    if (!focusLensEnabled) hideFocusLens();
  }
  if (changes.focusLensFontSize) {
    focusLensFontSize = changes.focusLensFontSize.newValue;
    if (focusLensEl) focusLensEl.dataset.size = focusLensFontSize;
  }
  if (changes.dimmingEnabled) {
    dimmingEnabled = changes.dimmingEnabled.newValue;
    if (!dimmingEnabled) hideDimming();
    else if (isReading) showDimming();
  }
  if (changes.readingRulerEnabled) {
    readingRulerEnabled = changes.readingRulerEnabled.newValue;
    if (readingRulerEnabled) enableReadingRuler();
    else disableReadingRuler();
  }
  if (changes.fontFamily) applyPageFont(changes.fontFamily.newValue);
  if (changes.lineSpacing) applyLineSpacing(changes.lineSpacing.newValue);
  if (changes.letterSpacing) applyLetterSpacing(changes.letterSpacing.newValue);
  if (changes.colorOverlayEnabled || changes.colorOverlayColor || changes.colorOverlayOpacity) {
    chrome.storage.sync.get(['colorOverlayEnabled', 'colorOverlayColor', 'colorOverlayOpacity'], (s) => {
      applyColorOverlay(s.colorOverlayEnabled, s.colorOverlayColor, s.colorOverlayOpacity);
    });
  }
});

// ============================================================
// SVG Icons (inline, no external resources)
// ============================================================

function getSpeakerSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';
}

function getPauseSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
}

function getPlaySVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
}

function getStopSVG() {
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>';
}

// ============================================================
// Floating UI Styles (injected into Shadow DOM)
// ============================================================

function getFloatingStyles() {
  return `
    :host {
      all: initial;
    }

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }

    .ps-hidden {
      display: none !important;
    }

    /* --- Floating Play Button --- */
    .ps-float-btn {
      position: fixed;
      width: 40px;
      height: 40px;
      border: none;
      border-radius: 50%;
      background: #00897b;
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
      transition: background 0.15s, transform 0.15s, box-shadow 0.15s;
      pointer-events: auto;
      z-index: 2147483647;
    }

    .ps-float-btn:hover {
      background: #00695c;
      transform: scale(1.1);
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
    }

    .ps-float-btn:focus-visible {
      outline: 3px solid #4dd0e1;
      outline-offset: 2px;
    }

    .ps-float-btn:active {
      transform: scale(0.95);
    }

    /* --- Control Bar --- */
    .ps-control-bar {
      position: fixed;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 6px;
      background: #00897b;
      border-radius: 22px;
      box-shadow: 0 2px 12px rgba(0, 0, 0, 0.3);
      pointer-events: auto;
      z-index: 2147483647;
    }

    .ps-ctrl-btn {
      width: 32px;
      height: 32px;
      border: none;
      border-radius: 50%;
      background: rgba(255, 255, 255, 0.15);
      color: #fff;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
      font-size: 12px;
      font-weight: 700;
    }

    .ps-ctrl-btn:hover {
      background: rgba(255, 255, 255, 0.3);
    }

    .ps-ctrl-btn:focus-visible {
      outline: 2px solid #4dd0e1;
      outline-offset: 1px;
    }

    .ps-ctrl-btn:active {
      background: rgba(255, 255, 255, 0.4);
    }

    .ps-speed-btn {
      width: auto;
      min-width: 36px;
      padding: 0 8px;
      border-radius: 16px;
      font-size: 11px;
      letter-spacing: 0.5px;
    }

    /* --- Stop button highlight --- */
    .ps-stop-btn:hover {
      background: rgba(244, 67, 54, 0.5);
    }

    /* --- Word Highlight Overlay --- */
    .ps-highlight-overlay {
      position: fixed;
      pointer-events: none;
      border-radius: 2px;
      opacity: 0.4;
      transition: left 0.08s ease-out, top 0.08s ease-out, width 0.08s ease-out;
      z-index: 2147483646;
    }

    /* --- Focus Lens Bar --- */
    .ps-focus-lens {
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      padding: 16px 24px;
      background: rgba(0, 0, 0, 0.88);
      color: #fff;
      text-align: center;
      line-height: 1.6;
      pointer-events: none;
      z-index: 2147483645;
      box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      word-wrap: break-word;
      overflow-wrap: break-word;
    }

    .ps-focus-lens[data-size="small"] { font-size: 18px; padding: 12px 20px; }
    .ps-focus-lens[data-size="medium"] { font-size: 24px; padding: 16px 24px; }
    .ps-focus-lens[data-size="large"] { font-size: 32px; padding: 20px 28px; }
    .ps-focus-lens[data-size="extra-large"] { font-size: 40px; padding: 24px 32px; }

    /* --- Reading Ruler --- */
    .ps-reading-ruler {
      position: fixed;
      left: 0;
      right: 0;
      height: 60px;
      pointer-events: none;
      z-index: 2147483644;
      border-top: 2px solid rgba(0, 137, 123, 0.6);
      border-bottom: 2px solid rgba(0, 137, 123, 0.6);
      background: rgba(0, 137, 123, 0.08);
      transition: top 0.05s ease-out;
    }

    /* --- PDF Banner --- */
    .ps-pdf-banner {
      position: fixed;
      bottom: 20px;
      right: 20px;
      padding: 12px 18px;
      background: #00897b;
      color: #fff;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.3);
      pointer-events: auto;
      z-index: 2147483647;
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.15s, transform 0.15s;
    }
    .ps-pdf-banner:hover {
      background: #00695c;
      transform: translateY(-2px);
    }
  `;
}

// ============================================================
// PDF Detection — show banner to open in PageSpeak Reader
// ============================================================

(function detectPDF() {
  try {
    const url = window.location.href;
    // Detect if current page is a PDF (Chrome's built-in viewer or direct .pdf URL)
    const isPdfUrl = /\.pdf(\?|#|$)/i.test(url);
    const isPdfEmbed = document.contentType === 'application/pdf';
    const hasPdfEmbed = document.querySelector('embed[type="application/pdf"]');

    if (isPdfUrl || isPdfEmbed || hasPdfEmbed) {
      // Wait a moment for Shadow DOM to be available
      setTimeout(() => {
        createShadowUI();
        if (!shadowRoot) return;

        const banner = document.createElement('div');
        banner.className = 'ps-pdf-banner';
        banner.textContent = 'Open in PageSpeak Reader';
        banner.setAttribute('role', 'button');
        banner.setAttribute('tabindex', '0');
        banner.addEventListener('click', () => {
          safeSendMessage({ type: 'OPEN_PDF_READER', url: url });
          banner.remove();
        });
        banner.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            safeSendMessage({ type: 'OPEN_PDF_READER', url: url });
            banner.remove();
          }
        });
        shadowRoot.appendChild(banner);
      }, 500);
    }
  } catch (e) {
    // PDF detection failure is non-critical
  }
})();
