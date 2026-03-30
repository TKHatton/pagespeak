'use strict';

// ============================================================
// PageSpeak Popup — Tabbed Settings Dashboard
// ============================================================

// --- Reading Tab ---
const voiceSelect = document.getElementById('voice-select');
const speedSlider = document.getElementById('speed-slider');
const speedValue = document.getElementById('speed-value');
const pitchSlider = document.getElementById('pitch-slider');
const pitchValue = document.getElementById('pitch-value');
const volumeSlider = document.getElementById('volume-slider');
const volumeValue = document.getElementById('volume-value');
const readingStatus = document.getElementById('reading-status');
const statusText = document.getElementById('status-text');
const btnPause = document.getElementById('btn-pause');
const btnResume = document.getElementById('btn-resume');
const btnStop = document.getElementById('btn-stop');

// --- Appearance Tab ---
const trackingToggle = document.getElementById('tracking-toggle');
const colorPicker = document.getElementById('color-picker');
const focusLensToggle = document.getElementById('focus-lens-toggle');
const lensSizeSelect = document.getElementById('lens-size-select');
const dimmingToggle = document.getElementById('dimming-toggle');
const rulerToggle = document.getElementById('ruler-toggle');
const overlayToggle = document.getElementById('overlay-toggle');
const overlayColorPicker = document.getElementById('overlay-color-picker');
const fontSelect = document.getElementById('font-select');
const lineSpacingSelect = document.getElementById('line-spacing-select');
const letterSpacingSelect = document.getElementById('letter-spacing-select');

// --- AI Tab ---
const aiTierSelect = document.getElementById('ai-tier-select');
const ollamaSection = document.getElementById('ollama-section');
const ollamaUrlInput = document.getElementById('ollama-url');
const claudeSection = document.getElementById('claude-section');
const claudeKeyInput = document.getElementById('claude-key');
const lensList = document.getElementById('lens-list');
const btnAddLens = document.getElementById('btn-add-lens');
const lensForm = document.getElementById('lens-form');
const lensNameInput = document.getElementById('lens-name-input');
const lensPromptInput = document.getElementById('lens-prompt-input');
const btnSaveLens = document.getElementById('btn-save-lens');
const btnCancelLens = document.getElementById('btn-cancel-lens');

// --- Account / Auth ---
const authLoggedOut = document.getElementById('auth-logged-out');
const authLoggedIn = document.getElementById('auth-logged-in');
const authAvatar = document.getElementById('auth-avatar');
const authName = document.getElementById('auth-name');
const authEmail = document.getElementById('auth-email');
const subBadge = document.getElementById('sub-badge');
const btnLogin = document.getElementById('btn-login');
const btnLogout = document.getElementById('btn-logout');

// --- About Tab ---
const btnExport = document.getElementById('btn-export');
const btnImport = document.getElementById('btn-import');
const importFile = document.getElementById('import-file');
const btnResetDefaults = document.getElementById('btn-reset-defaults');
const btnResetStats = document.getElementById('btn-reset-stats');

// --- Built-in Persona Lenses ---
const BUILTIN_LENSES = [
  { id: 'author', name: "The Author's View", prompt: 'Respond as if you are the author of this text. Explain the key points from the author\'s perspective and intent.', builtin: true },
  { id: 'child', name: 'Explain to a 10-year-old', prompt: 'Explain this text as if you are talking to a curious 10-year-old. Use simple words, short sentences, and relatable examples.', builtin: true },
  { id: 'devil', name: "Devil's Advocate", prompt: 'Challenge the claims in this text. What counterarguments exist? What assumptions does the author make? Be respectful but critical.', builtin: true },
  { id: 'study', name: 'Study Notes', prompt: 'Create concise study notes from this text. Include key facts, definitions, and important concepts in a structured format with bullet points.', builtin: true },
  { id: 'vocab', name: 'Key Vocabulary', prompt: 'Identify and define all important vocabulary words in this text. List each word with a simple, clear definition and an example of how it is used.', builtin: true },
];

let customLenses = [];
let editingLensId = null;

// ============================================================
// Tab Navigation
// ============================================================

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach((b) => {
      b.classList.remove('active');
      b.setAttribute('aria-selected', 'false');
    });
    btn.classList.add('active');
    btn.setAttribute('aria-selected', 'true');

    // Show corresponding panel
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    const panel = document.getElementById('tab-' + btn.dataset.tab);
    if (panel) panel.classList.add('active');
  });
});

// ============================================================
// Initialize
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
  await loadVoices();
  await loadSettings();
  await loadStats();
  await updateReadingStatus();
  attachListeners();
  loadAuthState();
});

// ============================================================
// Load Voices
// ============================================================
async function loadVoices() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_VOICES' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.voices) { resolve(); return; }
      const voices = response.voices;
      voices.sort((a, b) => (a.voiceName || '').localeCompare(b.voiceName || ''));
      while (voiceSelect.options.length > 1) voiceSelect.remove(1);
      for (const voice of voices) {
        const option = document.createElement('option');
        option.value = voice.voiceName;
        option.textContent = voice.voiceName + (voice.lang ? ` (${voice.lang})` : '');
        voiceSelect.appendChild(option);
      }
      resolve();
    });
  });
}

// ============================================================
// Load Settings
// ============================================================
async function loadSettings() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (response) => {
      if (chrome.runtime.lastError || !response || !response.settings) { resolve(); return; }
      const s = response.settings;

      // Reading
      if (s.voiceName) voiceSelect.value = s.voiceName;
      if (s.speed !== undefined) { speedSlider.value = s.speed; speedValue.textContent = s.speed.toFixed(1) + 'x'; }
      if (s.pitch !== undefined) { pitchSlider.value = s.pitch; pitchValue.textContent = s.pitch.toFixed(1); }
      if (s.volume !== undefined) { volumeSlider.value = s.volume; volumeValue.textContent = Math.round(s.volume * 100) + '%'; }

      // Appearance
      if (s.highlightEnabled !== undefined) trackingToggle.checked = s.highlightEnabled;
      if (s.highlightColor) setActiveColor(s.highlightColor, colorPicker);
      if (s.focusLensEnabled !== undefined) focusLensToggle.checked = s.focusLensEnabled;
      if (s.focusLensFontSize) lensSizeSelect.value = s.focusLensFontSize;
      if (s.dimmingEnabled !== undefined) dimmingToggle.checked = s.dimmingEnabled;
      if (s.readingRulerEnabled !== undefined) rulerToggle.checked = s.readingRulerEnabled;
      if (s.colorOverlayEnabled !== undefined) overlayToggle.checked = s.colorOverlayEnabled;
      if (s.colorOverlayColor) setActiveColor(s.colorOverlayColor, overlayColorPicker);
      if (s.fontFamily) fontSelect.value = s.fontFamily;
      if (s.lineSpacing) lineSpacingSelect.value = s.lineSpacing;
      if (s.letterSpacing) letterSpacingSelect.value = s.letterSpacing;

      // AI
      if (s.aiTier) { aiTierSelect.value = s.aiTier; updateAITierUI(s.aiTier); }
      if (s.ollamaUrl) ollamaUrlInput.value = s.ollamaUrl;
      chrome.runtime.sendMessage({ type: 'GET_AI_KEY' }, (resp) => {
        if (resp && resp.key) claudeKeyInput.value = '••••••••';
      });

      // Custom Lenses
      if (s.customLenses) customLenses = s.customLenses;
      renderLenses();

      resolve();
    });
  });
}

// ============================================================
// Reading Status
// ============================================================
async function updateReadingStatus() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'GET_TTS_STATE' }, (response) => {
      if (chrome.runtime.lastError || !response) { resolve(); return; }
      if (response.isReading) {
        readingStatus.classList.remove('hidden');
        if (response.isPaused) {
          statusText.textContent = 'Paused';
          btnPause.classList.add('hidden');
          btnResume.classList.remove('hidden');
        } else {
          statusText.textContent = 'Reading...';
          btnPause.classList.remove('hidden');
          btnResume.classList.add('hidden');
        }
      } else {
        readingStatus.classList.add('hidden');
      }
      resolve();
    });
  });
}

// ============================================================
// Stats
// ============================================================
async function loadStats() {
  return new Promise((resolve) => {
    chrome.storage.local.get('readingStats', (data) => {
      const stats = data.readingStats || { wordsRead: 0, timeMs: 0, sessions: 0 };
      document.getElementById('stat-words').textContent = stats.wordsRead.toLocaleString();
      document.getElementById('stat-sessions').textContent = stats.sessions;

      const mins = Math.round(stats.timeMs / 60000);
      if (mins < 60) {
        document.getElementById('stat-time').textContent = mins + 'm';
      } else {
        document.getElementById('stat-time').textContent = Math.floor(mins / 60) + 'h ' + (mins % 60) + 'm';
      }

      if (stats.wordsRead > 0 && stats.timeMs > 0) {
        const wpm = Math.round(stats.wordsRead / (stats.timeMs / 60000));
        document.getElementById('stat-speed').textContent = wpm;
      } else {
        document.getElementById('stat-speed').textContent = '--';
      }

      resolve();
    });
  });
}

// ============================================================
// Persona Lenses
// ============================================================
function renderLenses() {
  lensList.textContent = '';

  // Built-in lenses
  for (const lens of BUILTIN_LENSES) {
    const el = createLensItem(lens, true);
    lensList.appendChild(el);
  }

  // Custom lenses
  for (const lens of customLenses) {
    const el = createLensItem(lens, false);
    lensList.appendChild(el);
  }
}

function createLensItem(lens, isBuiltin) {
  const item = document.createElement('div');
  item.className = 'lens-item';

  const name = document.createElement('span');
  name.className = 'lens-item-name';
  name.textContent = lens.name;
  item.appendChild(name);

  if (isBuiltin) {
    const badge = document.createElement('span');
    badge.className = 'lens-item-builtin';
    badge.textContent = 'built-in';
    item.appendChild(badge);
  } else {
    const actions = document.createElement('div');
    actions.className = 'lens-item-actions';

    const delBtn = document.createElement('button');
    delBtn.className = 'lens-del-btn';
    delBtn.textContent = '\u00D7';
    delBtn.title = 'Delete lens';
    delBtn.setAttribute('aria-label', 'Delete ' + lens.name);
    delBtn.addEventListener('click', () => deleteLens(lens.id));
    actions.appendChild(delBtn);

    item.appendChild(actions);
  }

  return item;
}

function deleteLens(id) {
  customLenses = customLenses.filter((l) => l.id !== id);
  saveSetting('customLenses', customLenses);
  renderLenses();
}

function saveLens() {
  const name = lensNameInput.value.trim();
  const prompt = lensPromptInput.value.trim();
  if (!name || !prompt) return;

  // Sanitize: strip any HTML from the prompt
  const cleanPrompt = prompt.replace(/<[^>]*>/g, '').trim();

  if (!cleanPrompt) {
    alert('Prompt cannot be empty after removing HTML tags.');
    return;
  }

  const lens = {
    id: 'custom-' + Date.now(),
    name: name.substring(0, 40),
    prompt: cleanPrompt.substring(0, 500),
  };

  customLenses.push(lens);
  saveSetting('customLenses', customLenses);
  renderLenses();

  lensNameInput.value = '';
  lensPromptInput.value = '';
  lensForm.classList.add('hidden');
}

// ============================================================
// Export / Import Settings
// ============================================================
function exportSettings() {
  chrome.storage.sync.get(null, (settings) => {
    // Remove API key (never export)
    const exportData = { ...settings };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const a = document.createElement('a');
    a.href = url;
    a.download = 'pagespeak-settings.json';
    a.click();

    URL.revokeObjectURL(url);
  });
}

function importSettings(file) {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target.result);
      // Validate it looks like settings
      if (!data || typeof data !== 'object' || !data.settingsVersion) {
        alert('Invalid settings file.');
        return;
      }
      chrome.storage.sync.set(data, () => {
        if (chrome.runtime.lastError) {
          alert('Failed to import settings: ' + chrome.runtime.lastError.message);
          return;
        }
        location.reload();
      });
    } catch (err) {
      alert('Could not read settings file.');
    }
  };
  reader.readAsText(file);
}

// ============================================================
// Event Listeners
// ============================================================
function attachListeners() {
  // --- Reading ---
  voiceSelect.addEventListener('change', () => saveSetting('voiceName', voiceSelect.value));
  speedSlider.addEventListener('input', () => { speedValue.textContent = parseFloat(speedSlider.value).toFixed(1) + 'x'; saveSetting('speed', parseFloat(speedSlider.value)); });
  pitchSlider.addEventListener('input', () => { pitchValue.textContent = parseFloat(pitchSlider.value).toFixed(1); saveSetting('pitch', parseFloat(pitchSlider.value)); });
  volumeSlider.addEventListener('input', () => { volumeValue.textContent = Math.round(parseFloat(volumeSlider.value) * 100) + '%'; saveSetting('volume', parseFloat(volumeSlider.value)); });

  btnPause.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'PAUSE_READING' }); statusText.textContent = 'Paused'; btnPause.classList.add('hidden'); btnResume.classList.remove('hidden'); });
  btnResume.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'RESUME_READING' }); statusText.textContent = 'Reading...'; btnResume.classList.add('hidden'); btnPause.classList.remove('hidden'); });
  btnStop.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'STOP_READING' }); readingStatus.classList.add('hidden'); });

  // --- Appearance ---
  trackingToggle.addEventListener('change', () => saveSetting('highlightEnabled', trackingToggle.checked));
  colorPicker.addEventListener('click', (e) => { const s = e.target.closest('.color-swatch'); if (!s) return; setActiveColor(s.dataset.color, colorPicker); saveSetting('highlightColor', s.dataset.color); });
  focusLensToggle.addEventListener('change', () => saveSetting('focusLensEnabled', focusLensToggle.checked));
  lensSizeSelect.addEventListener('change', () => saveSetting('focusLensFontSize', lensSizeSelect.value));
  dimmingToggle.addEventListener('change', () => saveSetting('dimmingEnabled', dimmingToggle.checked));
  rulerToggle.addEventListener('change', () => saveSetting('readingRulerEnabled', rulerToggle.checked));
  overlayToggle.addEventListener('change', () => saveSetting('colorOverlayEnabled', overlayToggle.checked));
  overlayColorPicker.addEventListener('click', (e) => { const s = e.target.closest('.color-swatch'); if (!s) return; setActiveColor(s.dataset.color, overlayColorPicker); saveSetting('colorOverlayColor', s.dataset.color); });
  fontSelect.addEventListener('change', () => saveSetting('fontFamily', fontSelect.value));
  lineSpacingSelect.addEventListener('change', () => saveSetting('lineSpacing', parseFloat(lineSpacingSelect.value)));
  letterSpacingSelect.addEventListener('change', () => saveSetting('letterSpacing', letterSpacingSelect.value));

  // --- AI ---
  aiTierSelect.addEventListener('change', () => { saveSetting('aiTier', aiTierSelect.value); updateAITierUI(aiTierSelect.value); });
  ollamaUrlInput.addEventListener('change', () => {
    const url = ollamaUrlInput.value.trim();
    try {
      const parsed = new URL(url);
      if (parsed.hostname !== 'localhost' && parsed.hostname !== '127.0.0.1') {
        alert('Ollama URL must be localhost or 127.0.0.1 for security.');
        ollamaUrlInput.value = 'http://localhost:11434';
        return;
      }
    } catch (e) {
      alert('Invalid URL format.');
      ollamaUrlInput.value = 'http://localhost:11434';
      return;
    }
    saveSetting('ollamaUrl', url);
  });
  claudeKeyInput.addEventListener('change', () => {
    const key = claudeKeyInput.value.trim();
    if (key && !key.startsWith('••')) {
      chrome.runtime.sendMessage({ type: 'SET_AI_KEY', key });
      claudeKeyInput.value = '••••••••';
    }
  });

  // --- Persona Lenses ---
  btnAddLens.addEventListener('click', () => { lensForm.classList.remove('hidden'); lensNameInput.focus(); });
  btnCancelLens.addEventListener('click', () => { lensForm.classList.add('hidden'); lensNameInput.value = ''; lensPromptInput.value = ''; });
  btnSaveLens.addEventListener('click', saveLens);

  // --- About ---
  btnExport.addEventListener('click', exportSettings);
  btnImport.addEventListener('click', () => importFile.click());
  importFile.addEventListener('change', (e) => { if (e.target.files[0]) importSettings(e.target.files[0]); });
  btnResetStats.addEventListener('click', () => {
    chrome.storage.local.set({ readingStats: { wordsRead: 0, timeMs: 0, sessions: 0 } }, loadStats);
  });
  btnResetDefaults.addEventListener('click', () => {
    if (confirm('Reset all settings to defaults? This will also clear your API key.')) {
      chrome.runtime.sendMessage({ type: 'CLEAR_AI_KEY' });
      chrome.storage.sync.clear(() => {
        chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: {} }); // trigger onInstalled defaults
        location.reload();
      });
    }
  });
}

// ============================================================
// Helpers
// ============================================================

function saveSetting(key, value) {
  const update = {};
  update[key] = value;
  chrome.runtime.sendMessage({ type: 'UPDATE_SETTINGS', settings: update });
}

function setActiveColor(color, container) {
  const swatches = container.querySelectorAll('.color-swatch');
  for (const s of swatches) {
    s.classList.toggle('active', s.dataset.color === color);
  }
}

function updateAITierUI(tier) {
  ollamaSection.style.display = tier === 'local' ? 'block' : 'none';
  claudeSection.style.display = tier === 'cloud' ? 'block' : 'none';
}

// ============================================================
// Auth0 Authentication
// ============================================================

function loadAuthState() {
  chrome.runtime.sendMessage({ type: 'AUTH_GET_STATE' }, (response) => {
    if (chrome.runtime.lastError || !response) return;
    updateAuthUI(response);
  });
}

function updateAuthUI(state) {
  if (state.isAuthenticated && state.user) {
    authLoggedOut.classList.add('hidden');
    authLoggedIn.classList.remove('hidden');

    authName.textContent = state.user.name || 'User';
    authEmail.textContent = state.user.email || '';

    // Avatar: use profile picture or first letter fallback
    if (state.user.picture) {
      authAvatar.style.backgroundImage = 'url(' + state.user.picture + ')';
      authAvatar.textContent = '';
    } else {
      authAvatar.style.backgroundImage = '';
      authAvatar.textContent = (state.user.name || 'U')[0].toUpperCase();
    }

    // Subscription badge (placeholder for Stripe integration)
    if (state.subscription && state.subscription.status === 'active') {
      subBadge.textContent = 'Pro';
      subBadge.className = 'sub-badge sub-active';
    } else {
      subBadge.textContent = '7-Day Trial';
      subBadge.className = 'sub-badge sub-trial';
    }
  } else {
    authLoggedOut.classList.remove('hidden');
    authLoggedIn.classList.add('hidden');
  }
}

// Login button
btnLogin.addEventListener('click', () => {
  btnLogin.disabled = true;
  btnLogin.textContent = 'Opening login...';

  chrome.runtime.sendMessage({ type: 'AUTH_LOGIN' }, (response) => {
    btnLogin.disabled = false;
    btnLogin.textContent = 'Log In / Sign Up';

    if (chrome.runtime.lastError) {
      console.warn('Login error:', chrome.runtime.lastError);
      return;
    }

    if (response && response.success) {
      loadAuthState();
    } else if (response && response.error) {
      console.warn('Login failed:', response.error);
    }
  });
});

// Logout button
btnLogout.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'AUTH_LOGOUT' }, () => {
    loadAuthState();
  });
});
