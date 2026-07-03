# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — Vite dev server on port 5173 (also defined as `qari` in `.claude/launch.json` for preview tooling)
- `npm run build` — production build; use this as the pass/fail check, there are no tests or linter

## Code style

Plain JSX (no TypeScript), no semicolons, single quotes, 2-space indent. Quiet, lowercase UI copy. The project path contains non-ASCII characters (`Qāriʾ`) — quote it in shell commands.

## What this app is

Qāriʾ is an **offline-first Quran reading and memorization app**. All Quran text ships in `public/quran.json`, parsed from the official KFGQPC UthmanicHafs **v22** document so its encoding exactly matches the bundled font `public/fonts/UthmanicHafs_V22.ttf`.

**Encoding rule (critical):** external Uthmani text (quran.com, Tarteel API) uses different diacritic codepoints (e.g. U+06DF vs U+0652) that the v22 font cannot shape — it renders dotted circles. Never render Arabic fetched from outside; always resolve to our own words via `getSurah()` (see `enrichMutash` in `Reader.jsx` for the pattern).

## Architecture

- `src/App.jsx` — view state ↔ URL (`/home`, `/cards`, `/mushaf?ayah=S:A`) via pushState/popstate; owns `theme`. Passes `nav={view}` to Reader — Reader's re-jump effect keys on this **object identity**, not `[surah, ayah]` primitives, so repeat jumps to the same target still fire.
- `src/Reader.jsx` (~1400 lines) — the heart; everything below lives here.
- `src/Flashcards.jsx` + `src/srs.js` — memorization cards, simplified SM-2. Has its own `.reader-bar` (the mushaf view itself has no top bar, only fixed floating icons).
- `src/CommandBar.jsx` — ⌘K palette (surah/ayah/page jumps).
- `src/quran.js` — text access (`getSurah`, cached fetch of `quran.json`); `src/surah-names.js`.
- `src/recite.js` + `src/tilawa/` + `public/tilawa/` — on-device ASR (onnxruntime-web) that follows the user's recitation and scrolls the mushaf (`word_progress` / `verse_match` messages).
- `src/mutashabihat.js` — similar-phrase (mutashābihāt) lookups from the Tarteel MCP endpoint, cached 30 days in localStorage.
- `src/nav-data.json` — the 604 madani pages: `pages[p-1] = { surah, ayah, p }` (first ayah of each page).
- `src/store.js` — `load`/`save` over localStorage with the `qari.` prefix. Keys: `highlights`, `cards`, `lastRead`, `recent`, `theme`, `fontSize`, `mutash.S:A`. **localStorage holds the user's real data — snapshot and restore it if a test mutates it.**

## Reader.jsx internals (read this before touching it)

- **Rendering:** each word is `<span class="w" data-line data-key="S:A:i">`; ayah numbers are `<span class="marker" data-marker="S:A">`. Contiguous mutashābihāt words are wrapped in `<span class="mut-run">` (one continuous dotted underline) — `data-key` selectors still reach the words inside.
- **Infinite scroll, both directions:** sentinels + IntersectionObservers. Upward prepends are scroll-compensated via `prependFixRef` (document coords) in a `useLayoutEffect`. `loadPrev` is suppressed while `jumpingRef` is set — a compensating `scrollBy` cancels an in-flight smooth scroll.
- **Focus band:** `computeLines()` buckets `[data-line]` elements into visual lines (`linesRef`); `applyBand()` dims lines outside the middle 15–85% of the viewport (`.dim`). Anything that reflows layout (font size, content changes) must re-run these in a rAF. The recompute effect depends on `mutashData` because words **remount** into `.mut-run` wrappers when twin data arrives — stale `linesRef` refs would never dim again.
- **Jumps:** `jumpTo(s, a)` has a warm path (target surah mounted → smooth scroll, `jumpingRef` guards prepends, `scrollend`/3s timeout calls `endJump`) and a cold path (reset `surahs`, initial-jump effect scrolls instantly). The golden locate-flash fires **on arrival** via `pendingFlashRef`, consumed exactly once by `endJump` or the initial-jump effect — never call `flashAyah` around a jump yourself.
- **Highlights (mistake marks):** `highlights` = `{ 'S:A:i': 're'|'or'|'pu' }`, word-level, created by drag-selecting words → floating color menu. Red = word slip, orange = tajwīd, purple = mutashābihah. The marks drawer groups them into per-ayah entries with contiguous `runs`.
- **Modes disable each other** with ref-mirror guards (see `cardSelRef`): flashcard picking, drag-selection, etc. check the active mode before acting.
- **Escape layering protocol:** every Escape handler first checks `e.defaultPrevented`, and calls `e.preventDefault()` when it consumes the key — one Escape closes exactly one layer. Follow it for any new overlay.
- **Fixed chrome z-index map:** page pip 20, top icons / ctx-pill / prefs 30, drawers 40.

## Theming

Flexoki variables in `styles.css`: `--bg --bg-2 --ui --ui-2 --ui-3 --tx --tx-2 --tx-3` plus accents `--re --or --ye --gr --bl --pu`; dark mode overrides under `[data-theme='dark']`. Derive tints with `color-mix(in srgb, var(--accent) N%, var(--bg))` rather than new hex values. Mushaf font size flows through the `--mushaf-size` inline variable on `.reader`.

## Verifying in the preview browser

The preview tab is often occluded: rAF and timers throttle to ~1s, so never assert on wall-clock timing — check element/class state instead. After editing source, do a full reload before judging errors (HMR intermediate states throw spurious hook errors). `location.assign` inside a `preview_eval` kills the eval — wrap it in `setTimeout(..., 50)` and poll from a new eval.
