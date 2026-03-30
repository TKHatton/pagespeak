# PageSpeak v1.1 — Next Session Prompt

**Copy everything below and paste it into a new Claude conversation to continue building PageSpeak.**

---

## CONTEXT: What PageSpeak Is

PageSpeak is a dyslexia-first text-to-speech Chrome extension I built. It's live on my machine and working. The full source code is at:

```
C:\Users\ltken\OneDrive\Documents\GitHub\pagespeak
```

GitHub repo: `https://github.com/TKHatton/pagespeak.git`

### What it does (v1.0.0, complete and working):
- **TTS reading** — highlight text on any webpage, click the floating speaker button or press Alt+S, and it reads aloud using built-in system voices. Smart sentence chunking so long text never freezes.
- **Floating play button** — appears next to your text selection in a closed Shadow DOM. Play/pause/stop/speed controls. Works on SPAs (claude.ai, ChatGPT) using selectionchange + capture-phase events.
- **Word-by-word tracking** — each word highlights in sync with the voice. Falls back to sentence-level if the voice doesn't support word boundary events.
- **Focus lens** — fixed bar at top of screen showing the current sentence in large text.
- **Distraction dimming** — dims everything except what's being read.
- **Reading ruler** — horizontal line guide following your cursor.
- **3 dyslexia fonts** — OpenDyslexic, Atkinson Hyperlegible, Lexend (all bundled as .woff2).
- **Letter spacing + line spacing** — adjustable, letter spacing has the strongest dyslexia research backing.
- **Color overlay** — tinted full-page overlay for visual stress reduction.
- **AI comprehension sidekick** — Chrome side panel with 3 privacy tiers:
  - Tier 1 (Off): reading only, zero network
  - Tier 2 (Ollama): local AI at localhost, nothing goes to internet
  - Tier 3 (Claude API): cloud AI via api.anthropic.com, streaming
- **Quick actions**: Summarize, Explain Simply, Simplify This, Main Point, Key Terms
- **5 persona lenses** + custom lens creation (The Author's View, Explain to a 10-year-old, Devil's Advocate, Study Notes, Key Vocabulary)
- **PDF reading** — auto-detects PDFs, opens in PageSpeak Reader using Mozilla pdf.js (BSD license), extracts text for TTS.
- **Tabbed settings** — Reading, Look, AI, About tabs. Export/import settings as JSON.
- **Reading statistics** — words read, time, sessions, average WPM.
- **8 security layers** — strict CSP, trusted types, message origin validation, input sanitization, prompt delimiters, input length cap, output sanitizer, rate limiter.
- **Welcome page** — first-run onboarding with feature overview and limitations.
- **Privacy policy** — Chrome Web Store ready.

### Tech stack:
- Vanilla JavaScript, no frameworks, no build step, no npm dependencies
- Chrome Extensions Manifest V3
- Shadow DOM (closed mode) for all injected page UI
- Only external library: pdf.js by Mozilla (BSD license, bundled)
- Total bundle size: 2.1MB

### Architecture:
- `manifest.json` — MV3 config, strict CSP (`script-src 'self'; object-src 'none'`), 7 permissions (includes `identity`)
- `service-worker.js` — TTS engine, message broker, rate limiter, stats, AI key store (memory-only), Auth0 message handlers
- `auth-config.js` — Auth0 domain/clientId config (PLACEHOLDER — needs user's values)
- `auth.js` — Auth0 PKCE login/logout/refresh, token management, session restore
- `content.js` — floating UI, word tracking, focus lens, ruler, dimming, font/spacing, selection detection
- `popup.html/js/css` — tabbed settings dashboard with login/account section in AI tab
- `sidepanel.html/js/css` — AI chat with streaming + persona lenses
- `pdf-reader.html` — PDF text extraction + reading UI
- `lib/text-extractor.js` — Readability-style page content extractor
- `lib/sanitizer.js` — allowlist-only HTML sanitizer for AI responses
- `lib/pdf.min.js` + `lib/pdf.worker.min.js` — Mozilla pdf.js
- `landing/index.html` — public marketing page (deployed on Netlify)

### Key files to read first:
1. `SESSION-STATE.md` — comprehensive build log with every decision, fix, and rationale
2. `manifest.json` — permissions, commands, content scripts config
3. `README.md` — feature overview and project structure

---

## WHAT DOESN'T WORK YET (Known Limitations)

These are the gaps I need fixed:

1. **Google Docs** — uses custom canvas rendering, not standard DOM text nodes. The floating button doesn't position correctly and word tracking doesn't work. TTS may partially work via Alt+S if text is selected.

2. **Microsoft Word Online / Office 365** — same problem as Google Docs. Custom canvas renderer. Essential for students and professionals.

3. **Scanned PDFs without text layers** — the PDF reader only extracts existing text layers. Scanned documents (images of text) need OCR. I want Tesseract.js integrated so PageSpeak can read EVERYTHING on screen.

4. **Voice quality** — system voices (Windows SAPI) sound robotic and bad. Not sellable. Need cloud voice integration (ElevenLabs, Play.ht, Google Cloud TTS, or Azure Neural Voices) as a premium option.

5. **Kindle Cloud Reader** — Amazon uses obfuscated font rendering. Likely impossible but worth investigating.

6. **Claude Desktop app** — Electron app, Chrome extensions don't run there. Not solvable with this extension.

---

## WHAT WAS COMPLETED IN SESSION 8

- **Landing page** — DONE, deployed to Netlify, at `landing/index.html`
- **Auth0 PKCE authentication** — DONE, `auth.js` + `auth-config.js` created, service worker + popup wired up
- **Auth0 is NOT YET CONFIGURED** — user needs to:
  1. Create SPA in Auth0 Dashboard
  2. Set callback URL to the redirect URL logged in console
  3. Fill in `auth-config.js` with domain + clientId

## WHAT I NEED BUILT IN THIS SESSION

### Priority 1: Configure Auth0 + Test Login (IMMEDIATE)
Auth0 code is implemented but the Auth0 dashboard needs setup. Once configured:
- Test login/logout flow
- Verify session restore on service worker wake
- Fix any issues that arise

### Priority 2: Stripe Payments Integration (HIGH)
Set up the $8/month subscription with 7-day free trial:
- **Netlify Functions backend** (same repo as landing page):
  - `netlify/functions/create-checkout.js` — creates Stripe Checkout sessions
  - `netlify/functions/stripe-webhook.js` — receives subscription events
  - Stores subscription status on Auth0 user profile (via Auth0 Management API)
- **Extension changes**:
  - `getAuthState()` returns subscription status from Auth0 profile
  - Feature gating: lock AI features after trial expires
  - "Subscribe" button in popup when trial expired
- **Landing page**:
  - Connect CTA buttons to Stripe Checkout
  - "Start Your Free Trial" → creates checkout session → redirects to Stripe

### Priority 3: Premium Voice Integration (HIGH)
System voices aren't good enough to sell. Research and integrate cloud voice provider:
- **ElevenLabs**, **Play.ht**, **Google Cloud TTS**, **Azure Neural Voices**, or **LiveKit** (free)
- Streaming audio playback, word tracking compatibility, graceful fallback

### Priority 4: Google Docs + Word Online Support (HIGH)
Essential for students and professionals with dyslexia:
- Explore accessibility tree, clipboard-based extraction, or APIs
- At minimum: make Alt+S + TTS work on selected text

### Priority 5: OCR for Scanned PDFs (MEDIUM)
Integrate Tesseract.js for PDFs without text layers:
- Client-side only, progress indicator, cached results
- Bundle size: ~6MB total, may need lazy-loading

---

## SECURITY REQUIREMENTS

I am extremely security-focused. The user wants "protections on top of protections." For any new feature:

1. **No new permissions unless absolutely necessary** — justify every permission addition
2. **No external code loading** — everything bundled locally
3. **All user text is untrusted** — sanitize before processing, never innerHTML with user content
4. **OCR runs client-side only** — Tesseract.js must not phone home
5. **Premium voice APIs** — text is sent encrypted (HTTPS only), disclosed in privacy policy, user must explicitly opt in
6. **Landing page** — no tracking scripts, no analytics, no cookies. Pure static HTML.
7. **Update SESSION-STATE.md** after completing work with all changes, decisions, and rationale

## BUILD APPROACH

Follow the same disciplined process used for v1.0.0:
1. Read the codebase first — understand what exists before changing anything
2. Plan before implementing — present approach for approval before writing code
3. Security review every change
4. Test on claude.ai, ChatGPT, Wikipedia, and regular websites after changes
5. Update SESSION-STATE.md with everything done
6. Commit and push to main when complete

## IMPORTANT CONTEXT ABOUT ME

- I have dyslexia — I built this tool because I need it
- I'm security-focused and want multiple layers of protection
- I prefer being asked before major decisions are made
- I want to understand WHY decisions are made, not just what was done
- I plan to sell this on the Chrome Web Store — it needs to be professional quality
- I currently use another TTS reader but want to cancel that subscription once PageSpeak can replace it
- The things I read most: Claude responses (claude.ai), documents (Google Docs, Word), PDFs, and web articles
- I need this tool to work everywhere I read, not just on simple webpages
