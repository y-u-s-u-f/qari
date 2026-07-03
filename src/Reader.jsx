import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getSurah, toArabicDigits } from './quran'
import { getReciter } from './recite'
import { load, save } from './store'
import { fetchMutashabihat, fetchPhraseMutashabihat } from './mutashabihat'
import navData from './nav-data.json'

// Mistake mark colors: red (word slip) · orange (tajwīd) · purple (mutashābihah)
const COLORS = ['re', 'or', 'pu']

// Floating highlight menu footprint (matches .hl-menu CSS) for clamp/flip math
const MENU_W = 183
const MENU_H = 44

// Ornaments that are words in our v22 tokenization but not in tilawa's
const ORNAMENTS = new Set(['۞', '۩'])

// 'S:A' of each mushaf page's first ayah → page number, for inline page separators
const PAGE_STARTS = new Map(navData.pages.map((e) => [`${e.surah}:${e.ayah}`, e.p]))

// surah numbers wrap around: 114 follows 1 going up, 1 follows 114 going down
const wrapSurah = (n) => ((n - 1 + 114) % 114) + 1

const PALETTES = [
  ['flexoki', 'Flexoki'],
  ['ayu', 'Ayu'],
  ['catppuccin', 'Catppuccin'],
  ['everforest', 'Everforest'],
  ['gruvbox', 'Gruvbox'],
  ['nord', 'Nord'],
  ['rose-pine', 'Rosé Pine'],
]

export default function Reader({ surah, ayah, nav, goHome, theme, setTheme, palette, setPalette }) {
  const [surahs, setSurahs] = useState([])
  const [highlights, setHighlights] = useState(() => load('highlights', {}))
  const [cards, setCards] = useState(() => load('cards', []))
  const [recite, setRecite] = useState({ status: 'idle', percent: 0, message: '' })
  const [mutashData, setMutashData] = useState({}) // 'S:A' → { wordSet, phrases } for ambient underlines
  const [mutPop, setMutPop] = useState(null) // anchored popover: { surah, ayah, start, end, left, top, above, status }
  const [pending, setPending] = useState(null) // { surah, ayah, start, end } awaiting a color choice
  const [menu, setMenu] = useState(null) // { left, top, below } document coords for the floating menu
  const [pip, setPip] = useState(null) // current mushaf page, shown in the corner pill
  const [pipEdit, setPipEdit] = useState(false) // pip turned into a page-jump input
  const [pipScrub, setPipScrub] = useState(null) // page being scrubbed by dragging the pip, or null
  const [marks, setMarks] = useState(null) // { filter, idx } | null — marked-verses drawer
  const [marksData, setMarksData] = useState([]) // [{ surah, ayah, name, words, runs }]
  const [test, setTest] = useState(null) // { queue, idx, reveal } — mistake self-test over the marks list
  const [cardSel, setCardSel] = useState(null) // { surah, ayah } — picking a flashcard's visible part
  const [cue, setCue] = useState(null) // { surah, ayah, end, left, top, below } — card cue preview + menu
  const [flash, setFlash] = useState(null) // 'S:A' tinted for a moment after a jump, to locate it
  const [fontSize, setFontSize] = useState(() => load('fontSize', 32)) // mushaf text size, px
  const [prefs, setPrefs] = useState(false) // Aa display-settings popover
  const [takrar, setTakrar] = useState(null) // { count, target } — repetition counter, ephemeral
  const [veil, setVeil] = useState(null) // { surah, ayah, word } — free-recite frontier, ephemeral
  const takrarTimer = useRef(null)
  const prefsRef = useRef(null)
  const flashTimer = useRef(null)
  const pipEditRef = useRef(false)
  const pipDragRef = useRef(null) // { x, page, scrub, to } while the pip is held
  const pipSuppressRef = useRef(false)
  const cardSelRef = useRef(null)
  const testRef = useRef(null)
  const veilRef = useRef(null)
  const cueMenuRef = useRef(null)
  const mutPopRef = useRef(null)
  const menuRef = useRef(null)
  const dragRef = useRef(null) // { surah, ayah, start, end } while dragging
  const suppressClickRef = useRef(false)
  const containerRef = useRef(null)
  const linesRef = useRef([])
  const surahsRef = useRef([])
  const nextRef = useRef(surah)
  const prevRef = useRef(wrapSurah(surah - 1))
  const loadingRef = useRef(false)
  const loadingPrevRef = useRef(false)
  const prependFixRef = useRef(null) // { num, top } anchor for scroll compensation
  const targetRef = useRef({ surah, ayah })
  const didInitialScroll = useRef(false)
  const saveTimer = useRef(null)
  const sentinelRef = useRef(null)
  const topSentinelRef = useRef(null)
  const lastScrollRef = useRef(0)
  const mountedRef = useRef(false)
  const jumpingRef = useRef(false) // a smooth jump is animating — hold off prepends
  const jumpTimer = useRef(null)
  const pendingFlashRef = useRef(null) // flash target deferred until the jump lands

  surahsRef.current = surahs

  const allLoaded = () => surahsRef.current.length >= 114

  const loadNext = async () => {
    if (loadingRef.current || allLoaded() || surahsRef.current.some((x) => x.number === nextRef.current)) return
    loadingRef.current = true
    try {
      const s = await getSurah(nextRef.current)
      nextRef.current = wrapSurah(nextRef.current + 1)
      setSurahs((prev) => [...prev, s])
    } finally {
      loadingRef.current = false
    }
  }

  const loadPrev = async () => {
    if (jumpingRef.current) return // prepend compensation would cancel the jump animation
    if (loadingPrevRef.current || allLoaded() || surahsRef.current.some((x) => x.number === prevRef.current)) return
    const first = surahsRef.current[0]
    if (!first) return // nothing rendered yet — the initial loadNext anchors the view
    loadingPrevRef.current = true
    try {
      const s = await getSurah(prevRef.current)
      prevRef.current = wrapSurah(prevRef.current - 1)
      const sec = containerRef.current?.querySelector(`section[data-surah="${first.number}"]`)
      // document coords, not viewport: immune to scrolls that land between here and the commit
      if (sec) prependFixRef.current = { num: first.number, top: sec.getBoundingClientRect().top + window.scrollY }
      setSurahs((prev) => [s, ...prev])
    } finally {
      loadingPrevRef.current = false
    }
  }

  // keep the view still when content is prepended: restore the old first
  // surah's on-screen position before the browser paints
  useLayoutEffect(() => {
    const fix = prependFixRef.current
    if (!fix) return
    prependFixRef.current = null
    const sec = containerRef.current?.querySelector(`section[data-surah="${fix.num}"]`)
    if (sec) window.scrollBy(0, sec.getBoundingClientRect().top + window.scrollY - fix.top)
  }, [surahs])

  const computeLines = () => {
    const root = containerRef.current
    if (!root) return
    const els = root.querySelectorAll('[data-line]')
    const items = []
    for (const el of els) {
      items.push({ el, top: el.getBoundingClientRect().top + window.scrollY })
    }
    items.sort((a, b) => a.top - b.top)
    const lines = []
    for (const it of items) {
      const line = lines[lines.length - 1]
      // Elements within 40px vertically share a rendered line (line-height ≈ 80px)
      if (line && it.top - line.top < 40) line.els.push(it.el)
      else lines.push({ top: it.top, els: [it.el], ink: null })
    }
    linesRef.current = lines
  }

  const applyBand = () => {
    const vh = window.innerHeight
    const bandTop = window.scrollY + vh * 0.15
    const bandBot = window.scrollY + vh * 0.85
    for (const line of linesRef.current) {
      const ink = line.top >= bandTop && line.top <= bandBot
      if (ink !== line.ink) {
        line.ink = ink
        for (const el of line.els) el.classList.toggle('dim', !ink)
      }
    }
  }

  // Madani mushaf page for (surah, ayah): last page whose first ayah <= it, in reading order
  const pageOf = (s, a) => {
    const pages = navData.pages
    let lo = 0
    let hi = pages.length - 1
    let page = 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const e = pages[mid]
      if (e.surah < s || (e.surah === s && e.ayah <= a)) {
        page = e.p
        lo = mid + 1
      } else {
        hi = mid - 1
      }
    }
    return page
  }

  const updatePip = () => {
    const ink = linesRef.current.filter((l) => l.ink)
    const midInk = ink[Math.floor(ink.length / 2)]
    const keyed = midInk?.els.find((el) => el.dataset.key)
    if (!keyed) return
    const [s, a] = keyed.dataset.key.split(':').map(Number)
    const page = pageOf(s, a)
    setPip((p) => (p === page ? p : page))
  }

  const startPipEdit = () => {
    pipEditRef.current = true
    setPipEdit(true)
  }

  const endPipEdit = (page) => {
    pipEditRef.current = false
    setPipEdit(false)
    if (page >= 1 && page <= 604) {
      const e = navData.pages[page - 1]
      jumpTo(e.surah, e.ayah)
    }
  }

  // Hold-and-drag the pip vertically to scrub pages — down is forward (like
  // scrolling), fine near the start then accelerating so 1–604 fits on screen.
  const pipPointerDown = (e) => {
    if (pipEditRef.current) return
    pipDragRef.current = { y: e.clientY, page: pip, scrub: false, to: pip }
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {}
  }

  const pipPointerMove = (e) => {
    const d = pipDragRef.current
    if (!d) return
    const dy = e.clientY - d.y
    if (!d.scrub && Math.abs(dy) <= 4) return
    d.scrub = true
    const steps = Math.abs(dy) / 12
    const delta = Math.sign(dy) * Math.floor(steps + (steps > 12 ? (steps - 12) ** 1.7 : 0))
    d.to = Math.max(1, Math.min(604, d.page + delta))
    setPipScrub(d.to)
  }

  const pipPointerUp = () => {
    const d = pipDragRef.current
    pipDragRef.current = null
    if (!d?.scrub) return
    pipSuppressRef.current = true // swallow the click so pip-edit doesn't open
    setPipScrub(null)
    const e2 = navData.pages[d.to - 1]
    jumpTo(e2.surah, e2.ayah)
  }

  const savePosition = () => {
    // save the middle of the focus band — a reload centers this ayah again
    const ink = linesRef.current.filter((l) => l.ink)
    const midInk = ink[Math.floor(ink.length / 2)]
    const keyed = midInk?.els.find((el) => el.dataset.key)
    if (!keyed) return
    const [s, a] = keyed.dataset.key.split(':').map(Number)
    save('lastRead', { surah: s, ayah: a })
    if (window.location.pathname === '/mushaf') {
      window.history.replaceState(null, '', `/mushaf?ayah=${s}:${a}`)
    }
    const recent = load('recent', []).filter((n) => n !== s)
    recent.unshift(s)
    save('recent', recent.slice(0, 8))
  }

  // brief golden tint on the target ayah so the eye finds it after a jump
  const flashAyah = (s, a) => {
    clearTimeout(flashTimer.current)
    setFlash(null) // drop the class first so re-jumping the same ayah restarts the animation
    requestAnimationFrame(() => setFlash(`${s}:${a}`))
    flashTimer.current = setTimeout(() => setFlash(null), 2600)
  }

  // smooth jump finished (scrollend, or the safety timeout): allow prepends
  // again and drain the top sentinel for the ones deferred mid-animation
  const endJump = () => {
    if (!jumpingRef.current) return
    jumpingRef.current = false
    clearTimeout(jumpTimer.current)
    if (pendingFlashRef.current) {
      const { surah: fs, ayah: fa } = pendingFlashRef.current
      pendingFlashRef.current = null
      flashAyah(fs, fa)
    }
    const rt = topSentinelRef.current?.getBoundingClientRect()
    if (rt && rt.bottom > -1200) loadPrev()
  }

  const jumpTo = (s, a) => {
    targetRef.current = { surah: s, ayah: a }
    didInitialScroll.current = false
    if (surahsRef.current.some((x) => x.number === s)) {
      didInitialScroll.current = true
      const el = containerRef.current?.querySelector(`[data-key^="${s}:${a}:"]`)
      const r = el?.getBoundingClientRect()
      const want = r ? window.scrollY + r.top + r.height / 2 - window.innerHeight / 2 : window.scrollY
      const maxY = document.documentElement.scrollHeight - window.innerHeight
      const move = Math.min(Math.max(want, 0), maxY) - window.scrollY
      if (Math.abs(move) < 4) {
        // already at the target — no scroll means no scrollend, so flash now
        pendingFlashRef.current = null
        flashAyah(s, a)
        el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        return
      }
      pendingFlashRef.current = { surah: s, ayah: a }
      jumpingRef.current = true
      clearTimeout(jumpTimer.current)
      jumpTimer.current = setTimeout(endJump, 3000)
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    } else {
      pendingFlashRef.current = { surah: s, ayah: a }
      jumpingRef.current = false
      clearTimeout(jumpTimer.current)
      nextRef.current = s
      prevRef.current = wrapSurah(s - 1)
      prependFixRef.current = null
      linesRef.current = []
      setSurahs([])
      loadNext()
    }
  }

  // ——— Recitation following (tilawa engine) ———
  const handleWordProgress = (msg) => {
    const { surah: s, ayah: a, matched_indices } = msg
    const surahObj = surahsRef.current.find((x) => x.number === s)
    if (!surahObj) {
      jumpTo(s, a)
      return
    }
    const words = surahObj.ayahs[a - 1]?.words ?? []
    // map tilawa word indices → our indices (ours include standalone ornaments)
    const real = []
    words.forEach((w, i) => {
      if (!ORNAMENTS.has(w)) real.push(i)
    })
    const mapped = matched_indices.map((i) => real[i]).filter((i) => i != null)
    if (!mapped.length) return

    const liveKey = `${s}:${a}:${mapped[mapped.length - 1]}`
    const liveEl = containerRef.current?.querySelector(`[data-key="${liveKey}"]`)
    if (liveEl) {
      const top = liveEl.getBoundingClientRect().top
      const now = Date.now()
      if ((top < window.innerHeight * 0.2 || top > window.innerHeight * 0.72) && now - lastScrollRef.current > 900) {
        lastScrollRef.current = now
        liveEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
    save('lastRead', { surah: s, ayah: a })
  }

  useEffect(() => {
    const reciter = getReciter()
    const unsub = reciter.subscribe((msg) => {
      if (msg.type === 'status') {
        setRecite({ status: msg.status, percent: msg.percent, message: msg.message })
      } else if (msg.type === 'word_progress') {
        handleWordProgress(msg)
      } else if (msg.type === 'verse_match') {
        const inView = surahsRef.current.some((x) => x.number === msg.surah)
        if (!inView) jumpTo(msg.surah, msg.ayah)
      }
    })
    return () => {
      unsub()
      reciter.stop()
    }
  }, [])

  const toggleRecite = () => {
    const reciter = getReciter()
    if (recite.status === 'listening') {
      reciter.stop()
    } else {
      reciter.start().catch((err) => setRecite({ status: 'error', message: err.message }))
    }
  }

  // Initial load
  useEffect(() => {
    loadNext()
  }, [])

  // Infinite scroll, both directions
  useEffect(() => {
    const io = new IntersectionObserver((entries) => entries[0].isIntersecting && loadNext(), {
      rootMargin: '1200px',
    })
    if (sentinelRef.current) io.observe(sentinelRef.current)
    const ioTop = new IntersectionObserver((entries) => entries[0].isIntersecting && loadPrev(), {
      rootMargin: '1200px',
    })
    if (topSentinelRef.current) ioTop.observe(topSentinelRef.current)
    return () => {
      io.disconnect()
      ioTop.disconnect()
    }
  }, [])

  // Recompute lines whenever content re-renders, and once webfonts finish loading
  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      computeLines()
      applyBand()
      // the observers only fire on enter/leave — short surahs can leave a
      // sentinel inside its margin with no transition, so keep draining here
      const r = sentinelRef.current?.getBoundingClientRect()
      if (r && r.top < window.innerHeight + 1200) loadNext()
      const rt = topSentinelRef.current?.getBoundingClientRect()
      if (rt && rt.bottom > -1200) loadPrev()
    })
    document.fonts.ready.then(() => {
      computeLines()
      applyBand()
    })
    return () => cancelAnimationFrame(raf)
    // mutashData matters: words remount into .mut-run wrappers when twin data
    // arrives, and stale linesRef refs would never receive .dim again
  }, [surahs, highlights, cards, mutashData])

  // Font size changes reflow every line — remeasure once the new size paints
  useEffect(() => {
    save('fontSize', fontSize)
    const raf = requestAnimationFrame(() => {
      computeLines()
      applyBand()
      updatePip()
    })
    return () => cancelAnimationFrame(raf)
  }, [fontSize])

  useEffect(() => {
    if (!prefs) return
    const onDown = (e) => {
      if (!prefsRef.current?.contains(e.target)) setPrefs(false)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault() // claim it so one Escape closes one layer
      setPrefs(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [prefs])

  // Vim-style j/k scrolling: tap advances one line, holding glides smoothly
  useEffect(() => {
    const held = new Set()
    let raf = null
    let last = 0
    let start = 0
    let pressScrolled = 0
    const lineHeight = () => {
      const l = linesRef.current
      return l.length > 1 ? l[1].top - l[0].top : 80
    }
    const step = (t) => {
      if (!held.size) {
        raf = null
        return
      }
      const dt = Math.min(48, t - last)
      last = t
      const dir = (held.has('j') ? 1 : 0) - (held.has('k') ? 1 : 0)
      const ramp = Math.min(1, (t - start) / 150) // brief ease-in; release stops instantly
      const dy = dir * 950 * ramp * (dt / 1000)
      pressScrolled += Math.abs(dy)
      window.scrollBy(0, dy)
      raf = requestAnimationFrame(step)
    }
    const isTyping = (e) =>
      e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable
    const onDown = (e) => {
      if ((e.key !== 'j' && e.key !== 'k') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.defaultPrevented || isTyping(e) || held.has(e.key)) return
      if (!held.size) {
        start = performance.now()
        last = start
        pressScrolled = 0
      }
      held.add(e.key)
      if (!raf) raf = requestAnimationFrame(step)
    }
    const onUp = (e) => {
      if (!held.delete(e.key)) return
      // a quick tap glides the rest of one full line, like vim's j/k
      if (!held.size && performance.now() - start < 200) {
        const dir = e.key === 'j' ? 1 : -1
        const rest = lineHeight() - pressScrolled
        if (rest > 0) window.scrollBy({ top: dir * rest, behavior: 'smooth' })
      }
    }
    const onBlur = () => held.clear()
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // Takrar repetition counter — 't' toggles it, 'l' counts up, 'h' counts down
  useEffect(() => {
    const isTyping = (e) =>
      e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable
    const onDown = (e) => {
      if ((e.key !== 't' && e.key !== 'h' && e.key !== 'l') || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.defaultPrevented || isTyping(e)) return
      if (e.key === 't') {
        setTakrar((t) => (t ? null : { count: 0, target: load('takrarTarget', 11) }))
      } else if (e.key === 'l') {
        setTakrar((t) => (t ? { ...t, count: t.count + 1 } : t))
      } else {
        setTakrar((t) => (t ? { ...t, count: Math.max(0, t.count - 1) } : t))
      }
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [])

  // Takrar auto-clear ~1.5s after the target is reached (also cleans up on t/unmount)
  useEffect(() => {
    clearTimeout(takrarTimer.current)
    if (takrar && takrar.count >= takrar.target)
      takrarTimer.current = setTimeout(() => setTakrar(null), 1500)
    return () => clearTimeout(takrarTimer.current)
  }, [takrar])

  // Scroll / resize handling
  useEffect(() => {
    let ticking = false
    const onScroll = () => {
      if (!ticking) {
        ticking = true
        requestAnimationFrame(() => {
          applyBand()
          updatePip()
          ticking = false
        })
      }
      clearTimeout(saveTimer.current)
      saveTimer.current = setTimeout(() => {
        savePosition()
        prefetchMutash()
      }, 600)
    }
    const onResize = () => {
      computeLines()
      applyBand()
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('scrollend', endJump)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll)
      window.removeEventListener('scrollend', endJump)
      window.removeEventListener('resize', onResize)
      clearTimeout(saveTimer.current)
      clearTimeout(jumpTimer.current)
    }
  }, [])

  // Jump to the requested ayah once the target surah is rendered and fonts are ready
  useEffect(() => {
    if (didInitialScroll.current || surahs.length === 0) return
    didInitialScroll.current = true
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => {
        const { surah: s, ayah: a } = targetRef.current
        const el = containerRef.current?.querySelector(`[data-key^="${s}:${a}:"]`)
        if (el) el.scrollIntoView({ block: 'center' })
        const wanted = pendingFlashRef.current // set by jumpTo only — plain reloads never flash
        pendingFlashRef.current = null
        if (el && wanted) flashAyah(wanted.surah, wanted.ayah)
        computeLines()
        applyBand()
        savePosition()
        updatePip()
        prefetchMutash()
      })
    })
  }, [surahs])

  // Navigate when App re-targets an already-mounted Reader (command bar, recite modal)
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true
      return
    }
    jumpTo(surah, ayah)
  }, [nav])

  // Position the floating color menu over a pending selection, in document
  // coordinates so it scrolls with the mushaf. Flips below when the selection
  // is too close to the viewport top.
  const openMenuFor = (sel) => {
    const root = containerRef.current
    const first = root?.querySelector(`[data-key="${sel.surah}:${sel.ayah}:${sel.start}"]`)
    const last = root?.querySelector(`[data-key="${sel.surah}:${sel.ayah}:${sel.end}"]`)
    if (!first || !last) return
    const ra = first.getBoundingClientRect()
    const rb = last.getBoundingClientRect()
    const top = Math.min(ra.top, rb.top)
    const bottom = Math.max(ra.bottom, rb.bottom)
    const cx = (Math.min(ra.left, rb.left) + Math.max(ra.right, rb.right)) / 2
    const clamped = Math.max(8 + MENU_W / 2, Math.min(window.innerWidth - 8 - MENU_W / 2, cx))
    const below = top - MENU_H - 10 < 0
    setMenu({
      left: clamped - MENU_W / 2 + window.scrollX,
      top: (below ? bottom + 10 : top - MENU_H - 10) + window.scrollY,
      below,
    })
  }

  const closeMenu = () => {
    setMenu(null)
    setPending(null)
  }

  const commitDrag = () => {
    const d = dragRef.current
    dragRef.current = null
    if (!d) return
    const lo = Math.min(d.start, d.end)
    const hi = Math.max(d.start, d.end)
    if (hi - lo < 1) {
      setPending(null) // collapsed drag — let the click handler decide, don't strand the pill
      return
    }
    suppressClickRef.current = true
    const sel = { surah: d.surah, ayah: d.ayah, start: lo, end: hi }
    setPending(sel)
    openMenuFor(sel)
  }

  useEffect(() => {
    const cancel = () => {
      if (!dragRef.current) return
      dragRef.current = null
      setPending(null)
    }
    window.addEventListener('pointerup', commitDrag)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', commitDrag)
      window.removeEventListener('pointercancel', cancel)
    }
  }, [])

  // Cancel a pending selection on outside pointerdown or Escape
  useEffect(() => {
    if (!menu) return
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)) closeMenu()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      closeMenu()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [menu])

  const applyColor = (color) => {
    const p = pending
    if (!p) return
    setHighlights((prev) => {
      const next = { ...prev }
      for (let i = p.start; i <= p.end; i++) next[`${p.surah}:${p.ayah}:${i}`] = color
      save('highlights', next)
      return next
    })
    closeMenu()
  }

  const removeRange = () => {
    const p = pending
    if (!p) return
    setHighlights((prev) => {
      const next = { ...prev }
      for (let i = p.start; i <= p.end; i++) delete next[`${p.surah}:${p.ayah}:${i}`]
      save('highlights', next)
      return next
    })
    closeMenu()
  }

  const markWord = (key) => {
    if (veilRef.current) {
      // free recite: tapping a veiled word moves the frontier just past it; revealed words are inert
      suppressClickRef.current = false
      const v = veilRef.current
      const [ws, wa, wi] = key.split(':').map(Number)
      if (afterFrontier(ws, wa, wi, v)) veilTo(ws, wa, wi + 1)
      return
    }
    if (testRef.current) {
      // testing: clicking a veiled word reveals one more; revealed words are inert
      suppressClickRef.current = false
      const t = testRef.current
      const item = t.queue[t.idx]
      const [ws, wa, wi] = key.split(':').map(Number)
      if (ws === item.surah && (wa === item.startAyah || wa === item.ayah)) {
        const flat = wa === item.ayah && item.startAyah !== item.ayah ? item.startLen + wi : wi
        if (flat >= t.reveal) revealWord()
      }
      return
    }
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }
    const [s, a, i] = key.split(':').map(Number)
    if (cardSelRef.current) {
      // picking the visible part of a flashcard: click the last shown word
      const cs = cardSelRef.current
      setCardSel(null)
      if (cs.surah === s && cs.ayah === a) {
        upsertCard(s, a, i)
        showCue(s, a, i)
      }
      return
    }
    const color = highlights[key]
    if (color) {
      // clicking any word of a highlight selects the whole contiguous same-color run
      let lo = i
      while (highlights[`${s}:${a}:${lo - 1}`] === color) lo--
      let hi = i
      while (highlights[`${s}:${a}:${hi + 1}`] === color) hi++
      const sel = { surah: s, ayah: a, start: lo, end: hi }
      setPending(sel)
      openMenuFor(sel)
    } else {
      const sel = { surah: s, ayah: a, start: i, end: i }
      setPending(sel)
      openMenuFor(sel)
    }
  }

  // create a card, or update the visible-part boundary of an existing one
  const upsertCard = (s, a, promptEnd) => {
    setCards((prev) => {
      const id = `${s}:${a}`
      const next = prev.some((c) => c.id === id)
        ? prev.map((c) => (c.id === id ? { ...c, promptEnd } : c))
        : [...prev, { id, surah: s, ayah: a, promptEnd, reps: 0, ease: 2.5, interval: 0, due: Date.now() }]
      save('cards', next)
      return next
    })
  }

  const removeCard = (s, a) => {
    setCards((prev) => {
      const next = prev.filter((c) => c.id !== `${s}:${a}`)
      save('cards', next)
      return next
    })
    setCue(null)
  }

  const isCarded = (s, a) => cards.some((c) => c.id === `${s}:${a}`)

  // show the card's cue (visible-part pills) + a small menu bubble on the ayah marker
  const showCue = (s, a, end) => {
    const el = containerRef.current?.querySelector(`[data-marker="${s}:${a}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    const below = r.top - 54 < 0
    setCue({
      surah: s,
      ayah: a,
      end,
      left: r.left + r.width / 2 + window.scrollX,
      top: (below ? r.bottom + 10 : r.top - 10) + window.scrollY,
      below,
    })
  }

  const markerClick = (s, a) => {
    if (testRef.current || veilRef.current) return
    setPending(null)
    setMenu(null)
    if (cardSelRef.current) {
      setCardSel(null)
      return
    }
    if (cue && cue.surah === s && cue.ayah === a) {
      setCue(null)
    } else if (isCarded(s, a)) {
      const c = cards.find((x) => x.id === `${s}:${a}`)
      showCue(s, a, c.promptEnd ?? 2)
    } else {
      setCue(null)
      setCardSel({ surah: s, ayah: a })
    }
  }

  cardSelRef.current = cardSel
  testRef.current = test
  veilRef.current = veil

  // cancel card-picking on Escape or a pointerdown outside the target ayah
  useEffect(() => {
    if (!cardSel) return
    const onDown = (e) => {
      const t = e.target
      const inAyah =
        t.dataset?.key?.startsWith(`${cardSel.surah}:${cardSel.ayah}:`) ||
        t.dataset?.marker === `${cardSel.surah}:${cardSel.ayah}`
      if (!inAyah) setCardSel(null)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      setCardSel(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [cardSel])

  // dismiss the cue on Escape or a pointerdown outside its menu (marker toggles it itself)
  useEffect(() => {
    if (!cue) return
    const onDown = (e) => {
      if (cueMenuRef.current?.contains(e.target)) return
      if (e.target.dataset?.marker === `${cue.surah}:${cue.ayah}`) return
      setCue(null)
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault()
      setCue(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [cue])

  // ——— Marked-verses drawer ———
  const markedCount = useMemo(() => new Set(Object.keys(highlights).map((k) => k.split(':', 2).join(':'))).size, [highlights])

  // ——— Inline marks navigator (left-edge chevrons) ———
  // unique marked ayahs in mushaf order, tinted by their first highlighted word
  const markedList = useMemo(() => {
    const byAyah = new Map()
    for (const [key, color] of Object.entries(highlights)) {
      const [s, a, i] = key.split(':').map(Number)
      const k = `${s}:${a}`
      const cur = byAyah.get(k)
      if (!cur || i < cur.i) byAyah.set(k, { surah: s, ayah: a, i, color })
    }
    return [...byAyah.values()].sort((x, y) => x.surah - y.surah || x.ayah - y.ayah)
  }, [highlights])

  // where the reader is right now: a pending jump target wins, else the middle
  // inked line of the focus band, else the last known target. The midInk read
  // takes the line's FIRST keyed word, which under-reads by one ayah when the
  // line opens with the previous ayah's tail — so while the navigator's last
  // target is still in the focus band, step from it instead (else "next" would
  // re-jump the same mark forever).
  const markNavRef = useRef(null)
  const readingPos = () => {
    if (pendingFlashRef.current) return pendingFlashRef.current
    const ink = linesRef.current.filter((l) => l.ink)
    const ln = markNavRef.current
    if (ln && ink.some((l) => l.els.some((el) => el.dataset.key?.startsWith(`${ln.surah}:${ln.ayah}:`)))) return ln
    const midInk = ink[Math.floor(ink.length / 2)]
    const keyed = midInk?.els.find((el) => el.dataset.key)
    if (keyed) {
      const [s, a] = keyed.dataset.key.split(':').map(Number)
      return { surah: s, ayah: a }
    }
    return targetRef.current
  }

  // is s:a:i at or past the free-recite veil frontier (i.e. still covered)?
  const afterFrontier = (s, a, i, v) =>
    s > v.surah || (s === v.surah && (a > v.ayah || (a === v.ayah && i >= v.word)))

  const markStep = (dir) => {
    if (!markedList.length) return null
    const { surah: cs, ayah: ca } = readingPos()
    if (dir > 0) {
      return markedList.find((m) => m.surah > cs || (m.surah === cs && m.ayah > ca)) ?? markedList[0]
    }
    for (let i = markedList.length - 1; i >= 0; i--) {
      const m = markedList[i]
      if (m.surah < cs || (m.surah === cs && m.ayah < ca)) return m
    }
    return markedList[markedList.length - 1]
  }

  const stepMarkNav = (dir) => {
    const t = markStep(dir)
    if (!t) return
    markNavRef.current = { surah: t.surah, ayah: t.ayah }
    jumpTo(t.surah, t.ayah)
  }

  const markTint = (m) =>
    m
      ? {
          background: `color-mix(in srgb, var(--${m.color}) 14%, var(--bg-2))`,
          borderColor: `color-mix(in srgb, var(--${m.color}) 40%, var(--bg-2))`,
        }
      : undefined

  // group highlight keys into per-ayah entries with contiguous colored runs + verse text
  useEffect(() => {
    if (!marks) return
    let alive = true
    ;(async () => {
      const byAyah = new Map()
      for (const [key, color] of Object.entries(highlights)) {
        const [s, a, i] = key.split(':').map(Number)
        const k = `${s}:${a}`
        if (!byAyah.has(k)) byAyah.set(k, [])
        byAyah.get(k).push({ i, color })
      }
      const entries = []
      for (const [k, ws] of byAyah) {
        const [s, a] = k.split(':').map(Number)
        ws.sort((x, y) => x.i - y.i)
        const runs = []
        for (const w of ws) {
          const last = runs[runs.length - 1]
          if (last && last.color === w.color && w.i === last.end + 1) last.end = w.i
          else runs.push({ color: w.color, start: w.i, end: w.i })
        }
        entries.push({ surah: s, ayah: a, runs })
      }
      entries.sort((x, y) => x.surah - y.surah || x.ayah - y.ayah)
      const texts = new Map()
      for (const n of new Set(entries.map((e) => e.surah))) texts.set(n, await getSurah(n))
      for (const e of entries) {
        const s = texts.get(e.surah)
        e.name = s.englishName
        e.words = s.ayahs[e.ayah - 1]?.words ?? []
      }
      if (alive) setMarksData(entries)
    })()
    return () => {
      alive = false
    }
  }, [!!marks, highlights])

  const filteredMarks = marks
    ? marksData.filter((e) => marks.filter === 'all' || e.runs.some((r) => r.color === marks.filter))
    : []

  const openMarks = () => {
    if (test) return // the drawer stays out of the way during a self-test
    setMutPop(null)
    setMarks((m) => (m ? null : { filter: 'all', idx: -1 }))
  }

  const gotoMark = (e, idx, keepOpen) => {
    setMarks((m) => (keepOpen ? { ...m, idx } : null))
    jumpTo(e.surah, e.ayah)
  }

  const stepMarks = (dir) => {
    if (!filteredMarks.length) return
    const idx = ((marks.idx < 0 ? (dir > 0 ? -1 : 0) : marks.idx) + dir + filteredMarks.length) % filteredMarks.length
    gotoMark(filteredMarks[idx], idx, true)
  }

  useEffect(() => {
    if (!marks) return
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setMarks(null)
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
        e.preventDefault()
        stepMarks(1)
      } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
        e.preventDefault()
        stepMarks(-1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [marks, marksData])

  // ——— Mistake self-test: veil from just before each mark, reveal from memory ———
  // window = the ayah before the mark (run-up) + the marked ayah, words flattened;
  // reveal counts how many of those words are shown, the rest are blurred
  const startTest = async () => {
    if (veilRef.current) return
    const list = filteredMarks
    if (!list.length) return
    const texts = new Map()
    for (const n of new Set(list.map((e) => e.surah))) texts.set(n, await getSurah(n))
    const queue = list.map((e) => {
      const startAyah = e.ayah > 1 ? e.ayah - 1 : e.ayah
      const startLen = startAyah === e.ayah ? 0 : texts.get(e.surah).ayahs[startAyah - 1].words.length
      return { ...e, startAyah, startLen, total: startLen + e.words.length }
    })
    setMarks(null)
    setTest({ queue, idx: 0, reveal: 0 })
    jumpTo(queue[0].surah, queue[0].startAyah)
  }

  const revealWord = () => {
    setTest((t) => (t ? { ...t, reveal: Math.min(t.reveal + 1, t.queue[t.idx].total) } : t))
  }

  // to the end of the run-up ayah first, then the rest of the window
  const revealVerse = () => {
    setTest((t) =>
      t ? { ...t, reveal: t.reveal < t.queue[t.idx].startLen ? t.queue[t.idx].startLen : t.queue[t.idx].total } : t
    )
  }

  const nextTest = () => {
    const t = testRef.current
    if (!t) return
    if (t.idx + 1 >= t.queue.length) {
      setTest(null)
      return
    }
    const item = t.queue[t.idx + 1]
    setTest({ ...t, idx: t.idx + 1, reveal: 0 })
    jumpTo(item.surah, item.startAyah)
  }

  useEffect(() => {
    if (!test) return
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setTest(null)
      } else if (e.key === ' ') {
        e.preventDefault() // Space reveals a word — don't scroll the page
        revealWord()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [!!test])

  // keep the newly revealed word in comfortable view
  useEffect(() => {
    if (!test || test.reveal === 0) return
    const item = test.queue[test.idx]
    const flat = test.reveal - 1
    const key =
      flat < item.startLen ? `${item.surah}:${item.startAyah}:${flat}` : `${item.surah}:${item.ayah}:${flat - item.startLen}`
    const el = containerRef.current?.querySelector(`[data-key="${key}"]`)
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.8) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [test])

  const testItem = test ? test.queue[test.idx] : null

  // ——— Veil practice: cover the page and recite from memory, no marks needed ———
  // everything from the frontier {surah, ayah, word} on is veiled

  // move the frontier, rolling word overflow into the next ayah; the session
  // ends at the surah's edge — the veil never crosses into the next surah
  const veilTo = (s, a, word) => {
    const sObj = surahsRef.current.find((x) => x.number === s)
    const len = sObj?.ayahs[a - 1]?.words.length
    if (len == null) {
      setVeil(null) // defensive: frontier ayah not found
      return
    }
    if (word >= len) {
      a += 1
      word = 0
      if (a > sObj.ayahs.length) {
        setVeil(null)
        return
      }
    }
    setVeil((v) => (v ? { ...v, surah: s, ayah: a, word } : v))
  }

  const veilWord = () => {
    const v = veilRef.current
    if (v) veilTo(v.surah, v.ayah, v.word + 1)
  }

  // reveal through the end of the frontier word's rendered line (same 40px
  // top-grouping as computeLines); falls back to end-of-verse when unmeasurable
  const veilLine = () => {
    const v = veilRef.current
    if (!v) return
    const root = containerRef.current
    const first = root?.querySelector(`[data-key="${v.surah}:${v.ayah}:${v.word}"]`)
    const sObj = surahsRef.current.find((x) => x.number === v.surah)
    if (!first || !sObj) {
      veilTo(v.surah, v.ayah + 1, 0)
      return
    }
    const top = first.getBoundingClientRect().top
    let a = v.ayah
    let w = v.word
    for (;;) {
      let na = a
      let nw = w + 1
      if (nw >= (sObj.ayahs[na - 1]?.words.length ?? 0)) {
        na += 1
        nw = 0
      }
      if (na > sObj.ayahs.length) break
      const el = root.querySelector(`[data-key="${v.surah}:${na}:${nw}"]`)
      if (!el || Math.abs(el.getBoundingClientRect().top - top) >= 40) break
      a = na
      w = nw
    }
    veilTo(v.surah, a, w + 1)
  }

  const startVeil = () => {
    if (testRef.current || cardSelRef.current) return
    const { surah: s, ayah: a } = readingPos()
    setVeil({ surah: s, ayah: a, word: 0 })
  }

  // 'v' starts a session at the current ayah, or ends the active one
  useEffect(() => {
    const isTyping = (e) =>
      e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable
    const onDown = (e) => {
      if (e.key !== 'v' || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.defaultPrevented || isTyping(e)) return
      if (veilRef.current) setVeil(null)
      else startVeil()
    }
    window.addEventListener('keydown', onDown)
    return () => window.removeEventListener('keydown', onDown)
  }, [])

  useEffect(() => {
    if (!veil) return
    const onKey = (e) => {
      if (e.defaultPrevented) return
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return
      if (e.key === 'Escape') {
        e.preventDefault()
        setVeil(null)
      } else if (e.key === 'w' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        veilWord()
      } else if (e.key === '$') {
        e.preventDefault()
        veilLine()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [veil])

  // keep the newly revealed word in comfortable view
  useEffect(() => {
    if (!veil) return
    const el = containerRef.current?.querySelector(
      `[data-key="${veil.surah}:${veil.ayah}:${Math.max(0, veil.word - 1)}"]`
    )
    if (el && el.getBoundingClientRect().top > window.innerHeight * 0.8) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }, [veil])

  // ——— Mutashabihat: ambient underlines + anchored popover ———
  // Tarteel ranges are 1-indexed into THEIR words (which include the trailing
  // ayah numeral and exclude our ۞/۩ ornament tokens) — map onto our indices.
  const processMutash = (s, a, data) => {
    const surahObj = surahsRef.current.find((x) => x.number === s)
    const words = surahObj?.ayahs[a - 1]?.words ?? []
    const real = []
    words.forEach((w, i) => {
      if (!ORNAMENTS.has(w)) real.push(i)
    })
    const wordSet = new Set()
    const phrases = []
    for (const p of data.phrases ?? []) {
      const cur = p.occurrences.find((o) => o.ayah_key === data.ayah_key)
      const ourRanges = []
      for (const [f, t] of cur?.ranges ?? p.ranges ?? []) {
        const from = real[f - 1]
        const to = real[Math.min(t, real.length) - 1]
        if (from == null || to == null) continue
        ourRanges.push({ from, to })
        // underline only meaningful twins: 2+ words, not boilerplate repeated everywhere
        if (t - f >= 1 && p.count >= 2 && p.count <= 12) {
          for (let i = from; i <= to; i++) wordSet.add(i)
        }
      }
      phrases.push({ ...p, ourRanges })
    }
    return { wordSet, phrases, ayahKey: data.ayah_key }
  }

  // Tarteel's occurrence text uses a different Uthmani encoding that our KFGQPC
  // font can't shape (dotted circles) — swap in our own words for every preview
  const attachOurWords = (occs) => {
    const keys = new Set(occs.map((o) => o.ayah_key))
    return Promise.all(
      [...keys].map((k) => {
        const [os, oa] = k.split(':').map(Number)
        return getSurah(os).then((sObj) => [k, (sObj.ayahs[oa - 1]?.words ?? []).filter((w) => !ORNAMENTS.has(w))])
      })
    ).then((pairs) => {
      const texts = Object.fromEntries(pairs)
      for (const o of occs) {
        const w = texts[o.ayah_key]
        if (w?.length) o.ourWords = w
      }
      return occs
    })
  }

  const enrichMutash = (s, a, data) => {
    const entry = processMutash(s, a, data)
    return attachOurWords(entry.phrases.flatMap((p) => p.occurrences)).then(() => entry)
  }

  // quietly fetch twins for ayahs resting in the focus band (cached 30 days)
  const requestedMutash = useRef(new Set())
  const prefetchMutash = () => {
    const keys = new Set()
    for (const l of linesRef.current) {
      if (!l.ink) continue
      for (const el of l.els) {
        if (el.dataset.key) keys.add(el.dataset.key.split(':', 2).join(':'))
      }
    }
    for (const key of keys) {
      if (requestedMutash.current.has(key)) continue
      requestedMutash.current.add(key)
      const [s, a] = key.split(':').map(Number)
      fetchMutashabihat(s, a)
        .then((data) => enrichMutash(s, a, data))
        .then((entry) => setMutashData((prev) => ({ ...prev, [key]: entry })))
        .catch(() => requestedMutash.current.delete(key)) // transient — retry on a later pass
    }
  }

  // ✦ in the selection menu: open the twins popover anchored to the selection
  const openMutPop = () => {
    const p = pending
    if (!p) return
    setMenu(null)
    const root = containerRef.current
    const first = root?.querySelector(`[data-key="${p.surah}:${p.ayah}:${p.start}"]`)
    const last = root?.querySelector(`[data-key="${p.surah}:${p.ayah}:${p.end}"]`)
    if (!first || !last) return
    const ra = first.getBoundingClientRect()
    const rb = last.getBoundingClientRect()
    const w = Math.min(400, window.innerWidth * 0.92)
    const cx = Math.max(
      8 + w / 2,
      Math.min(window.innerWidth - 8 - w / 2, (Math.min(ra.left, rb.left) + Math.max(ra.right, rb.right)) / 2)
    )
    const above = Math.max(ra.bottom, rb.bottom) + 360 > window.innerHeight && Math.min(ra.top, rb.top) > 380
    const pop = {
      surah: p.surah,
      ayah: p.ayah,
      start: p.start,
      end: p.end,
      left: cx + window.scrollX,
      top: (above ? Math.min(ra.top, rb.top) - 10 : Math.max(ra.bottom, rb.bottom) + 10) + window.scrollY,
      above,
      mode: 'ayah',
      status: 'ready',
    }
    const key = `${p.surah}:${p.ayah}`
    const samePop = (m) => m && m.surah === p.surah && m.ayah === p.ayah
    const loadAyah = () => {
      if (mutashData[key]) {
        setMutPop((m) => (samePop(m) ? { ...m, mode: 'ayah', status: 'ready' } : m))
        return
      }
      requestedMutash.current.add(key)
      fetchMutashabihat(p.surah, p.ayah)
        .then((data) => enrichMutash(p.surah, p.ayah, data))
        .then((entry) => {
          setMutashData((prev) => ({ ...prev, [key]: entry }))
          setMutPop((m) => (samePop(m) ? { ...m, mode: 'ayah', status: 'ready' } : m))
        })
        .catch((err) =>
          setMutPop((m) => (samePop(m) ? { ...m, mode: 'ayah', status: 'error', error: err.message } : m))
        )
    }
    // 2+ selected words → look up that exact phrase; failures fall back to the ayah list
    const words = surahsRef.current.find((x) => x.number === p.surah)?.ayahs[p.ayah - 1]?.words ?? []
    const phraseWords = words.slice(p.start, p.end + 1).filter((w) => !ORNAMENTS.has(w))
    if (phraseWords.length >= 2) {
      pop.mode = 'phrase'
      pop.phrase = phraseWords.join(' ')
      pop.status = 'loading'
      fetchPhraseMutashabihat(pop.phrase)
        .then((data) => {
          if (!data.found || !data.occurrences?.length) return null
          return attachOurWords(data.occurrences).then(() => data)
        })
        .then((data) => {
          if (data) setMutPop((m) => (samePop(m) ? { ...m, status: 'ready', entry: data } : m))
          else loadAyah()
        })
        .catch(() => loadAyah())
    } else if (!mutashData[key]) {
      pop.status = 'loading'
      loadAyah()
    }
    setMutPop(pop)
  }

  const gotoOccurrence = (key) => {
    const [s, a] = key.split(':').map(Number)
    setMutPop(null)
    setPending(null)
    jumpTo(s, a)
  }

  // one occurrence preview row — ≤5 words of context each side of the tinted match
  const occRow = (o, oi) => {
    const [f, t] = o.ranges[0]
    const ow = o.ourWords ?? o.words
    const before = ow.slice(Math.max(0, f - 1 - 5), f - 1)
    const after = ow.slice(t, t + 5)
    return (
      <button key={oi} className="mut-occ" onClick={() => gotoOccurrence(o.ayah_key)}>
        <div className="mut-occ-ref">
          {o.surah_name} {o.ayah_key}
        </div>
        <div className="mut-occ-ar" dir="rtl" lang="ar">
          {f - 1 > 5 ? '… ' : ''}{before.join(' ')}{' '}
          <span className="mut-seg">{ow.slice(f - 1, t).join(' ')}</span>{' '}
          {after.join(' ')}{ow.length > t + 5 ? ' …' : ''}
        </div>
      </button>
    )
  }

  useEffect(() => {
    if (!mutPop) return
    const onDown = (e) => {
      if (!mutPopRef.current?.contains(e.target)) {
        setMutPop(null)
        setPending(null)
      }
    }
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      e.preventDefault() // claim it so one Escape closes one layer
      setMutPop(null)
      setPending(null)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [mutPop])

  return (
    <div className="reader-page">
      <div className="reader-icons">
        <button className="icon-btn" title="Home" onClick={goHome}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="m3 10.5 9-7.5 9 7.5" />
            <path d="M5.5 9v11h13V9" />
          </svg>
        </button>
        <button className="icon-btn" title="Marked verses" onClick={openMarks}>
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M12 3.5 20.5 12 12 20.5 3.5 12Z" />
          </svg>
          {markedCount > 0 && <span className="marks-count">{markedCount}</span>}
        </button>
        <button
          className={'icon-btn mic-btn' + (recite.status === 'listening' ? ' active' : '')}
          title="Recite"
          onClick={toggleRecite}
          disabled={recite.status === 'loading'}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2.5" width="6" height="11" rx="3" />
            <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
            <path d="M12 17.5V21" />
          </svg>
          {recite.status === 'listening' && <span className="listening-dot" />}
        </button>
        <button
          className="icon-btn"
          title="recite from memory (v)"
          style={veil ? { borderColor: 'var(--bl)', color: 'var(--bl)' } : undefined}
          onClick={() => (veil ? setVeil(null) : startVeil())}
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
            <circle cx="12" cy="12" r="2.8" />
          </svg>
        </button>
      </div>
      {(cardSel || recite.status === 'listening' || recite.status === 'error') && (
        <div className={'ctx-pill' + (recite.status === 'error' ? ' err' : '')}>
          {cardSel
            ? 'flashcard: tap the last word that stays visible — the rest is hidden · Esc to cancel'
            : recite.status === 'listening'
              ? 'recite — the text follows you'
              : `mic/engine error: ${recite.message}`}
        </div>
      )}
      <div className="prefs-wrap" ref={prefsRef}>
        <button className="icon-btn aa-btn" title="Display settings" onClick={() => setPrefs((p) => !p)}>
          Aa
        </button>
        {prefs && (
          <div className="prefs-pop">
            <div className="prefs-row">
              <button title="Smaller text" disabled={fontSize <= 24} onClick={() => setFontSize((f) => Math.max(24, f - 2))}>
                −
              </button>
              <span className="prefs-val">{fontSize}</span>
              <button title="Larger text" disabled={fontSize >= 44} onClick={() => setFontSize((f) => Math.min(44, f + 2))}>
                +
              </button>
            </div>
            <div className="prefs-row">
              <button className={theme === 'light' ? 'on' : ''} onClick={() => setTheme('light')}>
                ☀ Light
              </button>
              <button className={theme === 'dark' ? 'on' : ''} onClick={() => setTheme('dark')}>
                ☾ Dark
              </button>
            </div>
            <div className="prefs-palettes">
              {PALETTES.map(([id, label]) => (
                <button
                  key={id}
                  className={palette === id ? 'on' : ''}
                  aria-pressed={palette === id}
                  onClick={() => setPalette(id)}
                >
                  <span>{label}</span>
                  {palette === id && <span className="prefs-check">✓</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="reader" ref={containerRef} style={{ '--mushaf-size': fontSize + 'px' }}>
        <div ref={topSentinelRef} className="sentinel">
          {surahs.length > 0 && surahs.length < 114 ? 'Loading…' : ''}
        </div>
        {surahs.map((s) => (
          <section key={s.number} data-surah={s.number}>
            <header className="surah-head">
              <div className="surah-head-ar">{s.name}</div>
              <div className="surah-head-en">{s.englishName}</div>
            </header>
            {s.basmala && (
              <p className="basmala" dir="rtl" lang="ar">
                <span data-line>{s.basmala}</span>
              </p>
            )}
            <p className="mushaf" dir="rtl" lang="ar">
              {s.ayahs.map((a) => (
                <Fragment key={a.n}>
                  {PAGE_STARTS.has(`${s.number}:${a.n}`) && (
                    <span className="page-sep" data-line title={`Page ${PAGE_STARTS.get(`${s.number}:${a.n}`)}`}>
                      {PAGE_STARTS.get(`${s.number}:${a.n}`)}
                    </span>
                  )}
                  {(() => {
                    const mutSet = mutashData[`${s.number}:${a.n}`]?.wordSet
                    const renderWord = (w, i) => {
                      const key = `${s.number}:${a.n}:${i}`
                      const hl = highlights[key]
                      const joinNext = hl && highlights[`${s.number}:${a.n}:${i + 1}`] === hl
                      const joinPrev = hl && highlights[`${s.number}:${a.n}:${i - 1}`] === hl
                      const pend =
                        pending &&
                        pending.surah === s.number &&
                        pending.ayah === a.n &&
                        i >= pending.start &&
                        i <= pending.end
                      const cued = cue && cue.surah === s.number && cue.ayah === a.n && i <= cue.end
                      const picking = cardSel && cardSel.surah === s.number && cardSel.ayah === a.n
                      const fl = flash === `${s.number}:${a.n}`
                      const veiled =
                        testItem &&
                        s.number === testItem.surah &&
                        (a.n === testItem.startAyah || a.n === testItem.ayah) &&
                        (a.n === testItem.ayah && testItem.startAyah !== testItem.ayah ? testItem.startLen + i : i) >=
                          test.reveal
                      const freeVeiled = veil && !testItem && afterFrontier(s.number, a.n, i, veil)
                      return (
                        <span
                          key={i}
                          className={
                            'w' +
                            (hl ? ' hl-' + hl : '') +
                            (pend ? ' hl-pending' : '') +
                            (cued ? ' hl-cue' : '') +
                            (picking ? ' pick' : '') +
                            (veiled || freeVeiled ? ' veiled' : '') +
                            (fl ? ' fl fl-j' + (i > 0 ? ' fl-j-prev' : '') : '') +
                            (joinNext || (pend && i < pending.end) || (cued && i < cue.end) ? ' hl-join' : '') +
                            (joinPrev || (pend && i > pending.start) || (cued && i > 0) ? ' hl-join-prev' : '')
                          }
                          data-line
                          data-key={key}
                          onPointerDown={(e) => {
                            if (!e.isPrimary || e.button !== 0) return
                            e.preventDefault()
                            if (cardSelRef.current || testRef.current || veilRef.current) return // picking a card boundary / testing / veiled — clicks only
                            // touch pointers implicitly capture — release so pointerenter fires on siblings
                            if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
                              e.currentTarget.releasePointerCapture(e.pointerId)
                            }
                            suppressClickRef.current = false
                            dragRef.current = { surah: s.number, ayah: a.n, start: i, end: i }
                          }}
                          onPointerEnter={() => {
                            const d = dragRef.current
                            if (!d || d.surah !== s.number || d.ayah !== a.n || d.end === i) return
                            d.end = i
                            setPending({
                              surah: d.surah,
                              ayah: d.ayah,
                              start: Math.min(d.start, d.end),
                              end: Math.max(d.start, d.end),
                            })
                          }}
                          onClick={() => markWord(key)}
                        >
                          {w}
                        </span>
                      )
                    }
                    // group contiguous underlined words so one wrapper paints one continuous dotted line
                    const out = []
                    for (let i = 0; i < a.words.length; i++) {
                      if (mutSet?.has(i)) {
                        const start = i
                        const run = [renderWord(a.words[i], i)]
                        while (mutSet.has(i + 1)) {
                          i++
                          run.push(' ', renderWord(a.words[i], i))
                        }
                        out.push(
                          <span key={`r${start}`} className="mut-run">
                            {run}
                          </span>
                        )
                      } else {
                        out.push(renderWord(a.words[i], i))
                      }
                      out.push(' ')
                    }
                    return out
                  })()}
                  <span
                    className={
                      'marker' +
                      (isCarded(s.number, a.n) ? ' carded' : '') +
                      (cardSel && cardSel.surah === s.number && cardSel.ayah === a.n ? ' picking' : '') +
                      (flash === `${s.number}:${a.n}` ? ' fl fl-j-prev' : '')
                    }
                    data-line
                    data-marker={`${s.number}:${a.n}`}
                    title={isCarded(s.number, a.n) ? 'Flashcard — tap to show' : 'Add to flashcards'}
                    onClick={() => markerClick(s.number, a.n)}
                  >
                    {toArabicDigits(a.n)}
                  </span>{' '}
                </Fragment>
              ))}
            </p>
          </section>
        ))}
        <div ref={sentinelRef} className="sentinel">
          {surahs.length < 114 ? 'Loading…' : 'صدق الله العظيم'}
        </div>
      </div>

      {markedCount > 0 && !test && (
        <div className="marks-nav">
          <button className="icon-btn" title="previous mark" style={markTint(markStep(-1))} onClick={() => stepMarkNav(-1)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 15 6-6 6 6" />
            </svg>
          </button>
          <button className="icon-btn" title="next mark" style={markTint(markStep(1))} onClick={() => stepMarkNav(1)}>
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        </div>
      )}

      {testItem && (
        <div className="test-bar">
          <span className="test-progress">
            {test.idx + 1}/{test.queue.length} · {testItem.name} {testItem.surah}:{testItem.ayah}
          </span>
          <button className="ghost" title="reveal one word (Space, or tap a veiled word)" onClick={revealWord}>
            word
          </button>
          <button className="ghost" title="reveal to the end of the verse" onClick={revealVerse}>
            verse
          </button>
          <button className="ghost" title="next mark" onClick={nextTest}>
            next ›
          </button>
          <button className="ghost" title="end test (Esc)" onClick={() => setTest(null)}>
            ✕
          </button>
        </div>
      )}

      {veil && !testItem && (
        <div className="test-bar">
          <span className="test-progress">
            reciting from {veil.surah}:{veil.ayah}
          </span>
          <button className="ghost" title="reveal one word (w, or tap a veiled word)" onClick={veilWord}>
            word
          </button>
          <button className="ghost" title="reveal to the end of the line ($)" onClick={veilLine}>
            line
          </button>
          <button className="ghost" title="end (Esc)" onClick={() => setVeil(null)}>
            ✕
          </button>
        </div>
      )}

      {takrar && (
        <div
          className={'takrar-pill' + (takrar.count >= takrar.target ? ' done' : '')}
          title="takrār — l counts up, h down, t closes (click also counts)"
          style={
            takrar.count >= takrar.target
              ? undefined
              : { background: `color-mix(in srgb, var(--gr) ${Math.round((takrar.count / takrar.target) * 20)}%, var(--bg-2))` }
          }
          onClick={() => setTakrar((t) => (t ? { ...t, count: t.count + 1 } : t))}
        >
          {takrar.count}
        </div>
      )}

      {pip != null && (
        <div
          className={'page-pip' + (pipScrub != null ? ' scrubbing' : '')}
          title="Jump to page"
          onPointerDown={pipPointerDown}
          onPointerMove={pipPointerMove}
          onPointerUp={pipPointerUp}
          onPointerCancel={pipPointerUp}
          onClick={() => {
            if (pipSuppressRef.current) {
              pipSuppressRef.current = false
              return
            }
            if (!pipEdit) startPipEdit()
          }}
        >
          {pipEdit ? (
            <input
              className="page-pip-input"
              autoFocus
              inputMode="numeric"
              defaultValue={pip}
              onFocus={(e) => e.target.select()}
              onKeyDown={(e) => {
                e.stopPropagation() // keep Escape/keys away from the cmdk & menu layers
                if (e.key === 'Enter') endPipEdit(+e.target.value)
                else if (e.key === 'Escape') endPipEdit(NaN)
              }}
              onBlur={(e) => pipEditRef.current && endPipEdit(+e.target.value === pip ? NaN : +e.target.value)}
            />
          ) : (
            pipScrub ?? pip
          )}
        </div>
      )}

      {menu && pending && (
        <div ref={menuRef} className={'hl-menu' + (menu.below ? ' below' : '')} style={{ left: menu.left, top: menu.top }}>
          {COLORS.map((c) => (
            <button
              key={c}
              className={'hl-swatch ' + c}
              title={c === 're' ? 'red — word slip' : c === 'or' ? 'orange — tajwīd' : 'purple — mutashābihah'}
              onClick={() => applyColor(c)}
            />
          ))}
          <span className="hl-menu-sep" />
          <button className="hl-menu-remove mut-star" title="mutashābihāt — similar phrases" onClick={openMutPop}>
            ✦
          </button>
          <button className="hl-menu-remove" title="remove highlight" onClick={removeRange}>
            ✕
          </button>
        </div>
      )}

      {cue && (
        <div
          ref={cueMenuRef}
          className={'hl-menu cue-menu' + (cue.below ? ' below' : '')}
          style={{ left: cue.left, top: cue.top }}
        >
          <span className="cue-label">flashcard</span>
          <button
            className="hl-menu-remove"
            title="re-pick the visible part"
            onClick={() => {
              setCue(null)
              setCardSel({ surah: cue.surah, ayah: cue.ayah })
            }}
          >
            ✎
          </button>
          <span className="hl-menu-sep" />
          <button className="hl-menu-remove" title="remove flashcard" onClick={() => removeCard(cue.surah, cue.ayah)}>
            ✕
          </button>
        </div>
      )}

      {marks && (
        <aside className="mut-drawer">
          <header className="mut-head">
            <span className="mut-title">◈ Marks — {filteredMarks.length}</span>
            <span className="marks-tools">
              {filteredMarks.length > 0 && (
                <button className="ghost" title="test yourself on these marks" onClick={startTest}>
                  Test
                </button>
              )}
              <button className="ghost marks-step" title="previous mark (↑)" onClick={() => stepMarks(-1)}>
                ‹
              </button>
              <button className="ghost marks-step" title="next mark (↓)" onClick={() => stepMarks(1)}>
                ›
              </button>
              <button className="ghost" onClick={() => setMarks(null)}>
                ✕
              </button>
            </span>
          </header>
          <div className="marks-filters">
            {['all', ...COLORS].map((f) => (
              <button
                key={f}
                className={'marks-f' + (f !== 'all' ? ' f-' + f : '') + (marks.filter === f ? ' on' : '')}
                title={f === 'all' ? 'all colours' : f === 're' ? 'red — word slips' : f === 'or' ? 'orange — tajwīd' : 'purple — mutashābihāt'}
                onClick={() => setMarks((m) => ({ ...m, filter: f, idx: -1 }))}
              >
                {f === 'all' ? 'All' : ''}
              </button>
            ))}
          </div>
          {filteredMarks.length === 0 && (
            <div className="mut-note">
              {marksData.length === 0 ? 'No marks yet — drag across words while reading to mark them.' : 'Nothing in this colour.'}
            </div>
          )}
          {filteredMarks.map((e, idx) => (
            <button
              key={`${e.surah}:${e.ayah}`}
              className={'mut-occ' + (idx === marks.idx ? ' active' : '')}
              onClick={() => gotoMark(e, idx, false)}
            >
              <div className="mut-occ-ref">
                {e.runs.map((r, ri) => (
                  <span key={ri} className={'marks-dot f-' + r.color} />
                ))}
                {e.name} {e.surah}:{e.ayah}
              </div>
              <div className="mut-occ-ar" dir="rtl" lang="ar">
                {e.words.map((w, wi) => {
                  const run = e.runs.find((r) => wi >= r.start && wi <= r.end)
                  return (
                    <Fragment key={wi}>
                      {run ? <span className={'mseg mseg-' + run.color}>{w}</span> : w}{' '}
                    </Fragment>
                  )
                })}
              </div>
            </button>
          ))}
        </aside>
      )}

      {mutPop && (
        <div
          ref={mutPopRef}
          className={'mut-pop' + (mutPop.above ? ' above' : '')}
          style={{ left: mutPop.left, top: mutPop.top }}
        >
          {mutPop.status === 'loading' && <div className="mut-note">Looking for similar phrases…</div>}
          {mutPop.status === 'error' && <div className="mut-note err">Could not load: {mutPop.error}</div>}
          {mutPop.status === 'ready' && mutPop.mode === 'phrase' && (
            <section className="mut-phrase">
              <div className="mut-phrase-ar" dir="rtl" lang="ar">
                {mutPop.phrase}
              </div>
              <div className="mut-caption">
                appears {mutPop.entry.count}× · {mutPop.entry.surahs} surah{mutPop.entry.surahs === 1 ? '' : 's'}
              </div>
              {mutPop.entry.occurrences.map(occRow)}
            </section>
          )}
          {mutPop.status === 'ready' &&
            mutPop.mode === 'ayah' &&
            (() => {
              const entry = mutashData[`${mutPop.surah}:${mutPop.ayah}`]
              const overlapping =
                entry?.phrases.filter((p) => p.ourRanges.some((r) => r.from <= mutPop.end && r.to >= mutPop.start)) ?? []
              const list = overlapping.length ? overlapping : (entry?.phrases ?? [])
              if (!list.length) return <div className="mut-note">No repeated phrases in this ayah</div>
              return list.map((p) => {
                const cur = p.occurrences.find((o) => o.ayah_key === entry.ayahKey) ?? p.occurrences[0]
                const [from, to] = (cur.ranges ?? p.ranges)[0]
                const cw = cur.ourWords ?? cur.words
                return (
                  <section key={p.phrase_id} className="mut-phrase">
                    <div className="mut-phrase-ar" dir="rtl" lang="ar">
                      {cw.slice(from - 1, to).join(' ')}
                    </div>
                    <div className="mut-caption">
                      appears {p.count}× · {p.surahs} surah{p.surahs === 1 ? '' : 's'}
                    </div>
                    {p.occurrences.map(occRow)}
                  </section>
                )
              })
            })()}
        </div>
      )}
    </div>
  )
}
