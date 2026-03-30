# PageSpeak Privacy Policy

**Last updated:** March 2026

PageSpeak is a dyslexia-first text-to-speech Chrome extension. We take your privacy seriously. This policy explains what data PageSpeak collects, how it is used, and where it goes.

## Three Privacy Tiers

PageSpeak operates in three tiers. You choose your tier in settings.

### Tier 1: Offline (Default)
- **Data collected:** None.
- **Network activity:** Zero. Nothing leaves your computer.
- **How it works:** Text-to-speech uses your browser's built-in voices. All processing happens locally on your machine.

### Tier 2: Local AI (Ollama)
- **Data collected:** The text you select for AI analysis.
- **Network activity:** Text is sent to Ollama running on your own computer (localhost only). Nothing goes to the internet.
- **How it works:** Your selected text is sent to a local AI model via HTTP on localhost. The text never leaves your machine.

### Tier 3: Cloud AI (Claude)
- **Data collected:** The text you select for AI analysis.
- **Network activity:** Text is sent to Anthropic's Claude API (`api.anthropic.com`) via encrypted HTTPS.
- **How it works:** Your selected text is sent to Anthropic's servers for AI processing. Anthropic's privacy policy governs how they handle this data. See: https://www.anthropic.com/privacy

## What We Store

### Locally on Your Computer
- **Reading preferences:** Voice selection, speed, pitch, volume, highlight color, font choice, and other settings. Stored in Chrome's `chrome.storage.sync` (syncs across your Chrome devices if you are signed into Chrome).
- **Reading statistics:** Words read, time spent, and session count. Stored in `chrome.storage.local` (local to this device only).
- **Custom persona lenses:** Custom AI prompt templates you create. Stored in `chrome.storage.sync`.

### Not Stored Anywhere
- **Claude API key:** If you use Cloud AI (Tier 3), your API key is held in browser memory only during your session. It is never saved to disk, never included in settings exports, and is cleared when Chrome restarts.
- **The text you read:** PageSpeak does not store, log, or transmit the text on web pages unless you explicitly use the AI sidekick features (Tier 2 or Tier 3).
- **Browsing history:** PageSpeak does not track which websites you visit.

## What We Do NOT Do

- We do not collect analytics or telemetry.
- We do not use tracking pixels, cookies, or fingerprinting.
- We do not sell, share, or transmit any user data to third parties (except Anthropic's Claude API in Tier 3, at your explicit request).
- We do not store your reading history.
- We do not run any code from external servers. All JavaScript is bundled in the extension package.

## Permissions Explained

| Permission | Why We Need It |
|-----------|----------------|
| `activeTab` | To read the text you select on the current page |
| `tts` | To read text aloud using your browser's built-in voices |
| `storage` | To save your preferences (voice, speed, colors, etc.) |
| `sidePanel` | To display the AI comprehension sidekick panel |
| `contextMenus` | To add "Read Aloud with PageSpeak" to the right-click menu |
| `scripting` | To inject the content script into pages opened before installation |

## Third-Party Services

- **Anthropic Claude API** (Tier 3 only): When you enable Cloud AI and submit text for analysis, that text is sent to Anthropic's servers. See Anthropic's privacy policy at https://www.anthropic.com/privacy
- **Ollama** (Tier 2 only): Text is sent to an Ollama instance running on your own computer. No third-party servers are involved.

## Data Retention

- Settings persist until you uninstall the extension or click "Reset to Defaults."
- Reading statistics persist until you click "Reset Stats" or uninstall the extension.
- API keys are cleared when Chrome restarts.
- We do not retain any data on external servers.

## Children's Privacy

PageSpeak does not knowingly collect personal information from children under 13. The extension processes text selected by the user and does not require account creation.

## Changes to This Policy

If we update this privacy policy, we will include the updated policy in the next extension version. The "Last updated" date at the top will reflect the change.

## Contact

If you have questions about this privacy policy, please open an issue at: https://github.com/TKHatton/pagespeak/issues
