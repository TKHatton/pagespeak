# PageSpeak

**Dyslexia-first text-to-speech Chrome extension with AI-powered comprehension.**

PageSpeak reads any webpage or PDF aloud using your computer's built-in voices — no subscription, no account, no data collection. Highlight text and press play, or let it read an entire page for you. Word-by-word tracking follows along as it reads, a focus lens magnifies the current sentence, and an AI sidekick helps you understand what you just heard.

Built for people with dyslexia. Useful for everyone.

---

## Features

### Reading
- **Highlight and read** — Select any text, click the floating speaker button, and listen
- **Read entire page** — One click reads the main content of any webpage
- **Read PDFs** — Open any PDF in PageSpeak's built-in reader with full TTS support
- **Keyboard shortcuts** — `Alt+S` to read, `Alt+P` to pause/resume
- **Voice selection** — Choose from all voices installed on your system
- **Speed, pitch, and volume controls** — Fine-tune your listening experience
- **Smart sentence chunking** — Long text never freezes or cuts off

### Visual Tracking
- **Word-by-word highlighting** — Each word lights up in sync with the voice
- **Focus lens** — Current sentence displayed in large text at the top of the screen
- **Auto-scroll** — Page scrolls to keep up with the reading position
- **Distraction dimming** — Everything except the current paragraph fades to help you focus
- **Reading ruler** — A line guide follows your cursor to help track which line you're reading
- **Customizable highlight colors** — Choose from 6 presets optimized for readability
- **Color overlay** — Apply a tinted overlay to reduce visual stress

### Accessibility
- **3 dyslexia-friendly fonts** — OpenDyslexic, Atkinson Hyperlegible, and Lexend
- **Adjustable letter spacing** — Widen letter spacing (strongest research-backed dyslexia aid)
- **Adjustable line spacing** — 1.0x to 2.5x line height
- **Keyboard-navigable UI** — Full keyboard and screen reader support

### AI Comprehension Sidekick
- **Summarize** — Get a quick summary of what you just read
- **Explain simply** — Break down complex text into plain language
- **Simplify** — Rewrite text using simpler vocabulary and shorter sentences
- **Ask questions** — Chat about the content without leaving the page
- **Persona lenses** — "The Author's View," "Devil's Advocate," "Study Notes," "Key Vocabulary," and more
- **Custom lenses** — Create your own prompt templates

### Settings & Data
- **Tabbed settings dashboard** — Reading, Appearance, AI, and About tabs
- **Reading statistics** — Track words read, time spent, sessions, and average WPM
- **Export/Import settings** — Back up and restore your configuration as JSON
- **First-run onboarding** — Welcome page with getting-started guide

## Privacy Tiers

PageSpeak lets you choose how much (or how little) data leaves your computer.

| Tier | AI Features | Network Activity | Cost |
|------|------------|-----------------|------|
| **Offline** | None | Zero. Nothing leaves your machine. | Free |
| **Local AI** | Ollama (runs on your computer) | Localhost only. Nothing goes to the internet. | Free |
| **Cloud AI** | Claude API | Encrypted HTTPS to Anthropic only. | Pay-per-use |

The core reading experience — TTS, word tracking, focus lens, PDF reader, dyslexia toolkit — is always **free and fully offline**.

## Security

PageSpeak is built with 8 layers of security:

1. **Strict CSP** — `script-src 'self'; object-src 'none'`. No eval, no inline scripts.
2. **Trusted Types** — All DOM manipulation via createElement/textContent. No innerHTML with user content.
3. **Message validation** — Every message verified by sender ID. No window.postMessage.
4. **Input sanitization** — HTML tags stripped from all page text before processing.
5. **Prompt delimiters** — AI text wrapped in markers. System prompt instructs AI to never follow instructions inside user text.
6. **Input length cap** — 10,000 character limit on text sent to AI.
7. **Output sanitizer** — Allowlist-only HTML sanitizer for AI responses. Safe textContent fallback.
8. **Rate limiter** — 10 AI requests per minute maximum.

Additional protections:
- All code bundled in the extension. No remote scripts, no CDNs.
- Shadow DOM isolation (closed mode) on all injected UI.
- API keys stored in memory only — never saved to disk, cleared on browser restart.
- Ollama connections restricted to localhost/127.0.0.1 only.
- PDF URLs validated (only http, https, file, blob protocols).
- Error boundaries on every feature — one failure cannot crash another.
- Open source. Read every line.

## Installation

### From Chrome Web Store
*Coming soon.*

### From Source (Developer Mode)
```bash
git clone https://github.com/TKHatton/pagespeak.git
cd pagespeak
```
1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `pagespeak` directory

## Project Structure

```
pagespeak/
├── manifest.json              # Extension configuration
├── service-worker.js          # TTS engine, messaging, shortcuts
├── content.js                 # Page interaction, floating UI, tracking
├── content.css                # Injected styles
├── popup.html                 # Tabbed settings dashboard
├── popup.js
├── popup.css
├── sidepanel.html             # AI comprehension chat
├── sidepanel.js
├── sidepanel.css
├── pdf-reader.html            # PDF text extraction + reading
├── welcome.html               # First-run onboarding
├── lib/
│   ├── text-extractor.js      # Page content extraction
│   ├── sanitizer.js           # HTML sanitizer for AI responses
│   ├── pdf.min.js             # Mozilla pdf.js (BSD license)
│   └── pdf.worker.min.js      # pdf.js worker thread
├── fonts/
│   ├── OpenDyslexic-Regular.woff2
│   ├── AtkinsonHyperlegible-Regular.woff2
│   └── Lexend-Regular.woff2
├── icons/
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── PRIVACY-POLICY.md
├── SESSION-STATE.md
├── LICENSE
└── README.md
```

## Development

PageSpeak is built with vanilla JavaScript — no frameworks, no build step, no runtime dependencies. Clone the repo, load it in Chrome, and start developing.

### Requirements
- Chrome 120 or later
- For Local AI (Tier 2): [Ollama](https://ollama.ai) running locally
- For Cloud AI (Tier 3): A [Claude API key](https://console.anthropic.com)

## Contributing

Contributions are welcome. Please read the code of conduct and contribution guidelines before submitting a pull request.

If you find a security vulnerability, please report it privately rather than opening a public issue.

## License

MIT License. See [LICENSE](LICENSE) for details.

## Acknowledgments

- [OpenDyslexic](https://opendyslexic.org) font by Abelardo Gonzalez
- [Atkinson Hyperlegible](https://brailleinstitute.org/freefont/) font by Braille Institute
- [Lexend](https://www.lexend.com/) font by Bonnie Shaver-Troup and Thomas Jockin
- [pdf.js](https://mozilla.github.io/pdf.js/) by Mozilla (BSD license)
- Built with the [Chrome Extensions API](https://developer.chrome.com/docs/extensions)
- AI comprehension powered by [Ollama](https://ollama.ai) and [Claude](https://anthropic.com)
