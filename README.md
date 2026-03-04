# 🎨 Gemini Image Downloader

A desktop automation tool that pulls image prompts from OneNote, sends scripts to ChatGPT for prompt generation, and feeds prompts to Gemini AI for image creation and download.

---

## 📦 Version History

### v1.1.0 — 2026-03-04
**Build:** `Gemini Image Downloader Setup 1.1.0.exe` (491 MB)

#### 🛠 ChatGPT Automation Fixes
- **Fixed scripts not sending to ChatGPT** — root cause: `DOMParser` unavailable in Node.js. Added server-side `extractScriptTextFromHTML()` using regex, runs in the Electron main process instead of renderer.
- **Fixed base prompt generating unwanted prompts** — all base prompts now append a strict constraint: *"Just reply OK — do NOT generate prompts yet."* so ChatGPT only acknowledges before scripts are fed.
- **Added DB content fallback** — if a page's script content is missing/empty at automation time, it now falls back to fetching raw HTML from SQLite and extracts text server-side.
- **Added `isSkipped` flag support** — pages explicitly marked as skipped in the UI are now correctly ignored during full batch runs.
- **CDP Input.insertText** — replaced clipboard-hijack Ctrl+V approach with Chrome DevTools Protocol direct text injection, so user clipboard is never touched during automation.
- **Faster wait times** — reduced base cooldowns: stop-button timeout 180s→90s, send-button active check 10s→30s, inter-prompt cooldown 3s→2s.

#### 🤖 Gemini Flow Improvements
- **Incremental image saving** — images now saved immediately after each prompt generation instead of a separate Phase 2 loop at the end.
- **Checkpoint/resume** — if a batch crashes, Gemini resumes from last saved checkpoint index, not from the beginning.
- **`imageCountBefore` guard** — prevents fallback logic from stealing the previous prompt's image on a failed generation.
- **Stuck send-button recovery** — detects when Gemini leaves send button disabled after image generation; saves the image anyway and reloads the page before the next prompt.
- **Gemini rephrase on refusal** — if a prompt is refused by content policy on attempt 1, automatically sends a rephrased safe-news version and retries.
- **Fixed false-positive error phrases** — removed `"content policy"`, `"safety guidelines"`, `"prohibited"` from the refusal detection list (they appear in normal news-context Gemini responses and were causing incorrect skip behavior).
- **Rate limit detection** — added detection for daily limit phrases: `"you've reached your image generation limit"`, `"try again tomorrow"`, etc.
- **Gemini ready-wait** — replaced hardcoded `await page.waitForTimeout(10000)` Gemini init wait with a dynamic `waitForFunction` that checks editor + send button are active.
- **Filenames include prompt ID** — `${safeFilename}_${prompt.id}.jpg` prevents collisions between prompts with similar text.

#### 🔄 Background Sync System (New)
- **`background-cache-pages`** IPC — on section open, compares remote OneNote timestamps vs local DB; only downloads pages that changed.
- **`background-cache-all-sections`** IPC — on app startup, queues ALL known sections for timestamp-diff sync automatically.
- **Rate-limit-safe queue** — `bgSyncQueue` ensures only one section syncs at a time with a 500ms delay between pages.
- **Live sync badges** — `PageList` shows animated "Caching…" badge per page while background sync is active.
- **Sidebar sync counter** — sidebar sync button shows `done/total` progress during background caching.

#### 🎨 Icon & Branding
- **New branded app icon** — AI-generated G+arrow+lightning logo, violet-to-cyan gradient on dark background.
- **ICO format** — proper multi-size ICO (16/32/48/128/256px) generated via sharp.
- **`electron-main.js` wired** — `icon: path.join(__dirname, 'build', 'icon.ico')` added to BrowserWindow.

---

### v1.0.0 — 2026-02-27
**Build:** `Gemini Image Downloader Setup 1.0.0.exe`

- Initial release
- OneNote OAuth + section browsing
- ChatGPT batch prompt generation
- Gemini image generation + download
- SQLite local database for prompts and page content
- Local page caching with background sync
- BatchControlPanel (Pause / Resume / Stop / Retry Gemini)
- PageList content badges and prompt counts
- Section Group one-click batch run

---

## 🏗 Build Instructions

```bash
# Development
npm run dev

# Build installable (Windows)
npm run dist:win
# → Output: electron-dist/Gemini Image Downloader Setup X.X.X.exe

# Rebuild native modules (after node/electron upgrade)
npm run rebuild
```

## 🗂 Project Structure

```
electron-main.js        — Electron main process, all IPC handlers
preload.js              — Context bridge (renderer ↔ main)
automation-runner.js    — ChatGPT + Gemini Playwright automation
electron/
  local-database.js     — SQLite DB (notebooks, pages, prompts, settings)
  local-store.js        — File-system content cache
  onenote-service.js    — Microsoft Graph / OneNote API
src/
  App.jsx               — Root app, state, routing
  components/
    Sidebar/            — Notebook tree navigation
    PageList/           — Page list with badges + prompt counts
    BatchControlPanel/  — Pause / Stop / Retry controls
  services/electron.js  — IPC bridge wrapper for renderer
build/
  icon.svg              — Source SVG icon
  icon.ico              — Windows multi-size ICO (used by installer)
  icon.png              — 512×512 PNG (Linux / electron-builder)
```

---

## 📝 Build Checklist (Before Each Release)

- [ ] Bump `version` in `package.json`
- [ ] Update `README.md` changelog section above
- [ ] Run `node scripts/convert-icon.js` if icon changed
- [ ] `npm run dist:win`
- [ ] `git add -A && git commit -m "release: vX.X.X" && git push`
