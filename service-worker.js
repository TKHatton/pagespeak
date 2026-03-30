'use strict';

// ============================================================
// PageSpeak Service Worker
// TTS engine, message broker, keyboard shortcuts, keep-alive,
// context menu, onInstalled handler
// ============================================================

// --- Constants ---
const SETTINGS_VERSION = 1;
const DEFAULT_SETTINGS = {
  settingsVersion: SETTINGS_VERSION,
  voiceName: '',
  speed: 1.0,
  pitch: 1.0,
  volume: 1.0,
  highlightEnabled: true,
  highlightColor: '#FFFF00',
  focusLensEnabled: false,
  focusLensFontSize: 'medium',
  dimmingEnabled: false,
  fontFamily: 'default',
  lineSpacing: 1.5,
  letterSpacing: 'normal',
  colorOverlayEnabled: false,
  colorOverlayColor: '#FFFF00',
  colorOverlayOpacity: 0.15,
  readingRulerEnabled: false,
  aiTier: 'off',
  ollamaUrl: 'http://localhost:11434',
};

// --- TTS State ---
let ttsState = {
  isReading: false,
  isPaused: false,
  chunks: [],
  currentChunkIndex: 0,
  currentText: '',
  tabId: null,
};

// --- Keep-alive port connections ---
const keepAlivePorts = new Map();

// --- Reading context for side panel ---
// Persisted to chrome.storage.session so it survives service worker restarts
// (session storage is cleared when browser closes, not persisted to disk)
let readingContext = '';

// --- API key in memory only (Security: never persisted to storage) ---
let claudeApiKey = '';

// --- Reading stats tracking ---
let readingStartTime = 0;

// Restore reading context from session storage on service worker startup
try {
  chrome.storage.session.get('readingContext', (data) => {
    if (!chrome.runtime.lastError && data && data.readingContext) {
      readingContext = data.readingContext;
    }
  });
} catch (e) {
  // chrome.storage.session may not be available in older Chrome versions
}

// ============================================================
// Message origin validation (Security Layer 3)
// ============================================================
function isValidSender(sender) {
  return sender && sender.id === chrome.runtime.id;
}

// ============================================================
// Installation & Update Handler
// ============================================================
chrome.runtime.onInstalled.addListener(async (details) => {
  // Create context menus
  chrome.contextMenus.create({
    id: 'pagespeak-read-aloud',
    title: 'Read Aloud with PageSpeak',
    contexts: ['selection'],
  });

  chrome.contextMenus.create({
    id: 'pagespeak-read-pdf',
    title: 'Open PDF in PageSpeak Reader',
    contexts: ['link'],
    targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*'],
  });

  if (details.reason === 'install') {
    // First install — set default settings and open welcome page
    await chrome.storage.sync.set(DEFAULT_SETTINGS);
    chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  } else if (details.reason === 'update') {
    // Settings migration
    const stored = await chrome.storage.sync.get('settingsVersion');
    const storedVersion = stored.settingsVersion || 0;

    if (storedVersion < SETTINGS_VERSION) {
      // Merge new defaults with existing settings (preserving user values)
      const current = await chrome.storage.sync.get(null);
      const merged = { ...DEFAULT_SETTINGS, ...current, settingsVersion: SETTINGS_VERSION };
      await chrome.storage.sync.set(merged);
    }
  }
});

// ============================================================
// Context Menu Click Handler
// ============================================================
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'pagespeak-read-aloud' && info.selectionText) {
    startReading(info.selectionText, tab.id);
  } else if (info.menuItemId === 'pagespeak-read-pdf' && info.linkUrl) {
    // Open PDF in PageSpeak reader
    const readerUrl = chrome.runtime.getURL('pdf-reader.html') + '?url=' + encodeURIComponent(info.linkUrl);
    chrome.tabs.create({ url: readerUrl });
  }
});

// ============================================================
// Keyboard Shortcut Handler
// ============================================================
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'read-selection') {
    // Ask content script for selected text
    chrome.tabs.sendMessage(tab.id, { type: 'GET_SELECTION' }, (response) => {
      if (chrome.runtime.lastError) {
        return; // Content script not available
      }
      if (response && response.text) {
        startReading(response.text, tab.id);
      }
    });
  } else if (command === 'toggle-reading') {
    toggleReading();
  }
});

// ============================================================
// Message Router
// ============================================================
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Security Layer 3: Validate message origin
  if (!isValidSender(sender)) {
    sendResponse({ error: 'Unauthorized sender' });
    return false;
  }

  switch (message.type) {
    case 'START_READING':
      startReading(message.text, sender.tab?.id);
      sendResponse({ success: true });
      break;

    case 'STOP_READING':
      stopReading();
      sendResponse({ success: true });
      break;

    case 'PAUSE_READING':
      pauseReading();
      sendResponse({ success: true });
      break;

    case 'RESUME_READING':
      resumeReading();
      sendResponse({ success: true });
      break;

    case 'TOGGLE_READING':
      toggleReading();
      sendResponse({ success: true });
      break;

    case 'GET_VOICES':
      chrome.tts.getVoices((voices) => {
        sendResponse({ voices: voices || [] });
      });
      return true; // async response

    case 'GET_TTS_STATE':
      sendResponse({
        isReading: ttsState.isReading,
        isPaused: ttsState.isPaused,
      });
      break;

    case 'GET_SETTINGS':
      chrome.storage.sync.get(null, (settings) => {
        sendResponse({ settings });
      });
      return true; // async response

    case 'UPDATE_SETTINGS':
      chrome.storage.sync.set(message.settings, () => {
        // If speed/pitch/volume changed mid-read, it takes effect on next chunk
        sendResponse({ success: true });
      });
      return true; // async response

    // --- Session 5: AI Context & Key Management ---

    case 'SET_READING_CONTEXT':
      readingContext = message.text || '';
      // Persist to session storage (survives service worker restarts)
      try { chrome.storage.session.set({ readingContext }); } catch (e) { /* fallback: memory only */ }
      // Relay to side panel
      chrome.runtime.sendMessage({
        type: 'READING_CONTEXT_UPDATE',
        text: readingContext,
      }).catch(() => {}); // Side panel may not be open
      sendResponse({ success: true });
      break;

    case 'GET_READING_CONTEXT':
      sendResponse({ text: readingContext });
      break;

    case 'SET_AI_KEY':
      // Memory-only storage — never persisted
      claudeApiKey = message.key || '';
      // Notify side panel
      chrome.runtime.sendMessage({
        type: 'AI_KEY_UPDATE',
        key: claudeApiKey,
      }).catch(() => {});
      sendResponse({ success: true });
      break;

    case 'GET_AI_KEY':
      sendResponse({ key: claudeApiKey });
      break;

    case 'OPEN_PDF_READER':
      if (message.url) {
        const readerUrl = chrome.runtime.getURL('pdf-reader.html') + '?url=' + encodeURIComponent(message.url);
        chrome.tabs.create({ url: readerUrl });
      }
      sendResponse({ success: true });
      break;

    case 'CLEAR_AI_KEY':
      claudeApiKey = '';
      chrome.runtime.sendMessage({
        type: 'AI_KEY_UPDATE',
        key: '',
      }).catch(() => {});
      sendResponse({ success: true });
      break;

    default:
      sendResponse({ error: 'Unknown message type' });
  }

  return false;
});

// ============================================================
// Keep-alive port connection (prevents 30s service worker timeout)
// ============================================================
chrome.runtime.onConnect.addListener((port) => {
  if (port.name === 'pagespeak-keepalive') {
    const tabId = port.sender?.tab?.id;
    if (tabId !== undefined && tabId !== null) {
      keepAlivePorts.set(tabId, port);
      port.onDisconnect.addListener(() => {
        keepAlivePorts.delete(tabId);
      });
    }
  }
});

// ============================================================
// TTS Engine — Smart Sentence Chunking
// ============================================================

/**
 * Split text into sentence-sized chunks for smooth TTS playback.
 * Handles abbreviations (Mr., Dr., etc.) and avoids splitting on them.
 */
function chunkText(text) {
  if (!text || !text.trim()) return [];

  // Normalize whitespace
  const normalized = text.replace(/\s+/g, ' ').trim();

  // Split on sentence boundaries but preserve the delimiter
  // Handles: periods, exclamation marks, question marks, colons, semicolons
  // Avoids splitting on common abbreviations
  const abbreviations = /(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|Ave|Blvd|etc|vs|e\.g|i\.e|a\.m|p\.m)\./gi;

  // Replace abbreviation periods with placeholder
  let processed = normalized.replace(abbreviations, (match) =>
    match.replace(/\./g, '\u0000')
  );

  // Split on sentence-ending punctuation followed by a space or end of string
  const rawChunks = processed.split(/(?<=[.!?])\s+/);

  // Restore abbreviation periods and filter empty chunks
  const chunks = rawChunks
    .map((chunk) => chunk.replace(/\u0000/g, '.').trim())
    .filter((chunk) => chunk.length > 0);

  // Merge very short chunks (under 20 chars) with the next chunk
  const merged = [];
  let buffer = '';

  for (const chunk of chunks) {
    if (buffer) {
      buffer += ' ' + chunk;
      if (buffer.length >= 20) {
        merged.push(buffer);
        buffer = '';
      }
    } else if (chunk.length < 20 && merged.length > 0) {
      // Merge short chunk with previous
      merged[merged.length - 1] += ' ' + chunk;
    } else if (chunk.length < 20) {
      buffer = chunk;
    } else {
      merged.push(chunk);
    }
  }

  if (buffer) {
    if (merged.length > 0) {
      merged[merged.length - 1] += ' ' + buffer;
    } else {
      merged.push(buffer);
    }
  }

  return merged;
}

/**
 * Start reading text aloud with sentence chunking.
 */
async function startReading(text, tabId) {
  // Stop any current reading
  stopReading();

  const chunks = chunkText(text);
  if (chunks.length === 0) return;

  // Track reading start time for stats
  readingStartTime = Date.now();

  // Store reading context for side panel (memory + session storage)
  readingContext = text;
  try { chrome.storage.session.set({ readingContext }); } catch (e) { /* fallback: memory only */ }
  chrome.runtime.sendMessage({
    type: 'READING_CONTEXT_UPDATE',
    text: readingContext,
  }).catch(() => {});

  const settings = await chrome.storage.sync.get(['voiceName', 'speed', 'pitch', 'volume']);

  ttsState = {
    isReading: true,
    isPaused: false,
    chunks,
    currentChunkIndex: 0,
    currentText: text,
    tabId,
  };

  // Notify content script that reading has started (include chunks for word tracking)
  if (tabId) {
    chrome.tabs.sendMessage(tabId, {
      type: 'READING_STARTED',
      text,
      chunks,
      totalChunks: chunks.length,
    }).catch(() => {}); // Tab might not have content script
  }

  speakNextChunk(settings);
}

/**
 * Speak the next chunk in the queue.
 */
function speakNextChunk(settings) {
  if (!ttsState.isReading || ttsState.currentChunkIndex >= ttsState.chunks.length) {
    // Reading complete
    finishReading();
    return;
  }

  const chunk = ttsState.chunks[ttsState.currentChunkIndex];
  const options = {
    rate: settings?.speed || 1.0,
    pitch: settings?.pitch || 1.0,
    volume: settings?.volume || 1.0,
    onEvent: (event) => {
      handleTtsEvent(event, settings);
    },
  };

  // Use selected voice if available
  if (settings?.voiceName) {
    options.voiceName = settings.voiceName;
  }

  chrome.tts.speak(chunk, options);
}

/**
 * Handle TTS events (word boundaries, end of chunk, errors).
 */
function handleTtsEvent(event, settings) {
  if (!ttsState.isReading) return;

  switch (event.type) {
    case 'word':
      // Send word boundary event to content script for highlighting
      if (ttsState.tabId) {
        chrome.tabs.sendMessage(ttsState.tabId, {
          type: 'WORD_BOUNDARY',
          charIndex: event.charIndex,
          charLength: event.length || 0,
          chunkIndex: ttsState.currentChunkIndex,
        }).catch(() => {});
      }
      break;

    case 'end':
      // Move to next chunk
      ttsState.currentChunkIndex++;

      if (ttsState.tabId) {
        const nextChunkText = ttsState.currentChunkIndex < ttsState.chunks.length
          ? ttsState.chunks[ttsState.currentChunkIndex]
          : '';
        chrome.tabs.sendMessage(ttsState.tabId, {
          type: 'CHUNK_COMPLETE',
          chunkIndex: ttsState.currentChunkIndex - 1,
          totalChunks: ttsState.chunks.length,
          nextChunkText,
        }).catch(() => {});
      }

      speakNextChunk(settings);
      break;

    case 'error':
      console.error('PageSpeak TTS error:', event.errorMessage);
      finishReading();
      break;

    case 'cancelled':
      // Do nothing — cancellation is intentional
      break;
  }
}

/**
 * Stop reading entirely.
 */
function stopReading() {
  chrome.tts.stop();
  const tabId = ttsState.tabId;

  ttsState = {
    isReading: false,
    isPaused: false,
    chunks: [],
    currentChunkIndex: 0,
    currentText: '',
    tabId: null,
  };

  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'READING_STOPPED' }).catch(() => {});
  }
}

/**
 * Pause reading.
 */
function pauseReading() {
  if (ttsState.isReading && !ttsState.isPaused) {
    chrome.tts.pause();
    ttsState.isPaused = true;

    if (ttsState.tabId) {
      chrome.tabs.sendMessage(ttsState.tabId, { type: 'READING_PAUSED' }).catch(() => {});
    }
  }
}

/**
 * Resume reading.
 */
function resumeReading() {
  if (ttsState.isReading && ttsState.isPaused) {
    chrome.tts.resume();
    ttsState.isPaused = false;

    if (ttsState.tabId) {
      chrome.tabs.sendMessage(ttsState.tabId, { type: 'READING_RESUMED' }).catch(() => {});
    }
  }
}

/**
 * Toggle pause/resume. If not reading, do nothing.
 */
function toggleReading() {
  if (!ttsState.isReading) return;

  if (ttsState.isPaused) {
    resumeReading();
  } else {
    pauseReading();
  }
}

/**
 * Called when all chunks have been read.
 */
function finishReading() {
  const tabId = ttsState.tabId;

  // Update reading stats
  updateReadingStats(ttsState.currentText);

  ttsState = {
    isReading: false,
    isPaused: false,
    chunks: [],
    currentChunkIndex: 0,
    currentText: '',
    tabId: null,
  };

  if (tabId) {
    chrome.tabs.sendMessage(tabId, { type: 'READING_COMPLETE' }).catch(() => {});
  }
}

/**
 * Update reading statistics in chrome.storage.local.
 */
function updateReadingStats(text) {
  if (!text || !readingStartTime) return;

  const elapsed = Date.now() - readingStartTime;
  const wordCount = text.split(/\s+/).filter((w) => w.length > 0).length;
  readingStartTime = 0;

  chrome.storage.local.get('readingStats', (data) => {
    const stats = data.readingStats || { wordsRead: 0, timeMs: 0, sessions: 0 };
    stats.wordsRead += wordCount;
    stats.timeMs += elapsed;
    stats.sessions += 1;
    chrome.storage.local.set({ readingStats: stats });
  });
}
