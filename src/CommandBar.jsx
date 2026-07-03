import { useEffect, useMemo, useRef, useState } from 'react'
import { getSurahList } from './quran'
import { normalizeName } from './surah-names'
import { load } from './store'
import navData from './nav-data.json'

// diacritics, quranic annotation signs, tatweel and ornaments (۞ ۩ live in the ranges)
const STRIP = /[\u064B-\u065F\u0670\u06D6-\u06DF\u06E0-\u06ED\u0640]/g
// fold alef wasla (\u0671) to plain alef so typed queries match the KFGQPC text
const normalize = (t) => t.replace(STRIP, '').replace(/\u0671/g, '\u0627')
const isArabic = (t) => /[\u0600-\uFFFF]/.test(t)

// full-text ayah index, built once and cached at module level
let ayahIndexPromise = null
function getAyahIndex() {
  if (!ayahIndexPromise) {
    ayahIndexPromise = fetch('/quran.json')
      .then((r) => r.json())
      .then((data) => {
        const idx = []
        for (const s of data) {
          s.ayahs.forEach((text, i) => {
            const words = text.split(/[ \u00A0]/)
            const map = []
            const kept = []
            words.forEach((w, wi) => {
              const n = normalize(w)
              if (n) {
                map.push(wi)
                kept.push(n)
              }
            })
            idx.push({ s: s.number, a: i + 1, words, joined: kept.join(' '), map })
          })
        }
        return idx
      })
  }
  return ayahIndexPromise
}

export default function CommandBar({ openReader, openCards }) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [surahs, setSurahs] = useState([])
  const [ayahResults, setAyahResults] = useState([])
  const listRef = useRef(null)
  const openRef = useRef(false)

  openRef.current = open

  useEffect(() => {
    getSurahList().then(setSurahs).catch(console.error)
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((o) => !o)
      } else if (e.key === 'Escape' && openRef.current) {
        e.preventDefault() // claim Escape so lower layers (mutashabihat drawer) stay open
        setOpen(false)
      }
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('qari-cmdk', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('qari-cmdk', onOpen)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setQ('')
      setAyahResults([])
      setSel(0)
    }
  }, [open])

  useEffect(() => setSel(0), [q])

  // debounced full-text ayah search for Arabic queries
  useEffect(() => {
    const query = q.trim()
    if (!open || !isArabic(query)) {
      setAyahResults([])
      return
    }
    let live = true
    const t = setTimeout(() => {
      getAyahIndex().then((idx) => {
        if (!live) return
        const nq = normalize(query).replace(/\s+/g, ' ').trim()
        if (!nq) {
          setAyahResults([])
          return
        }
        const out = []
        for (const e of idx) {
          const at = e.joined.indexOf(nq)
          if (at < 0) continue
          const wi = e.map[e.joined.slice(0, at).split(' ').length - 1] ?? 0
          const from = Math.max(0, wi - 2)
          out.push({
            badge: 'Ayah',
            title: `${e.s}:${e.a}`,
            ar: e.words.slice(from, wi + 6).join(' '),
            go: () => openReader(e.s, e.a),
          })
          if (out.length >= 12) break
        }
        setAyahResults(out)
      })
    }, 120)
    return () => {
      live = false
      clearTimeout(t)
    }
  }, [q, open])

  const results = useMemo(() => {
    let query = q.trim()
    const bySurah = (n) => surahs[n - 1]
    const surahRow = (s) => ({
      badge: 'Surah',
      title: `${s.number}. ${s.englishName}`,
      sub: `${s.translation} · ${s.ayahCount} ayahs`,
      go: () => openReader(s.number),
    })
    const pageRow = (p) => {
      if (p < 1 || p > 604) return null
      const e = navData.pages[p - 1]
      const s = bySurah(e.surah)
      return {
        badge: 'Page',
        title: `Page ${p}`,
        sub: `${s ? s.englishName + ' ' : ''}${e.surah}:${e.ayah}`,
        go: () => openReader(e.surah, e.ayah),
      }
    }
    const juzRow = (j) => {
      if (j < 1 || j > 30) return null
      const e = navData.juz[j - 1]
      const s = bySurah(e.surah)
      return {
        badge: 'Juz',
        title: `Juz ${j}`,
        sub: `${s ? s.englishName + ' ' : ''}${e.surah}:${e.ayah}`,
        go: () => openReader(e.surah, e.ayah),
      }
    }
    const hizbRow = (h) => {
      // h may be fractional in quarters: 1, 1.25, 1.5, 1.75, 2 …
      const q = Math.round((h - 1) * 4)
      if (q < 0 || q >= 240 || Math.abs((h - 1) * 4 - q) > 1e-9) return null
      const e = navData.hizbQuarters[q]
      const s = bySurah(e.surah)
      return {
        badge: 'Hizb',
        title: `Hizb ${Math.floor(h)}${['', '¼', '½', '¾'][q % 4]}`,
        sub: `${s ? s.englishName + ' ' : ''}${e.surah}:${e.ayah}`,
        go: () => openReader(e.surah, e.ayah),
      }
    }
    const out = []
    if (!query) {
      const last = load('lastRead', null)
      const s = last && bySurah(last.surah)
      if (s) {
        out.push({
          badge: 'Action',
          title: 'Continue reading',
          sub: `${s.englishName} · Ayah ${last.ayah}`,
          go: () => openReader(last.surah, last.ayah),
        })
      }
      out.push({ badge: 'Action', title: 'Flashcards', sub: 'Review your cards', go: openCards })
      return out
    }
    let m
    if ((m = query.match(/^(\d{1,3})[:\s](\d{1,3})$/))) {
      const sn = +m[1]
      const s = sn >= 1 && sn <= 114 && bySurah(sn)
      if (s) {
        const a = Math.min(Math.max(1, +m[2]), s.ayahCount)
        out.push({
          badge: 'Ayah',
          title: `${s.englishName} ${sn}:${a}`,
          sub: `${s.translation} · ${s.ayahCount} ayahs`,
          go: () => openReader(sn, a),
        })
      }
      return out
    }
    if ((m = query.match(/^p(?:age)?\s*(\d{1,3})$/i))) {
      const r = pageRow(+m[1])
      if (r) out.push(r)
      return out
    }
    if ((m = query.match(/^j(?:uz)?\s*(\d{1,2})$/i))) {
      const r = juzRow(+m[1])
      if (r) out.push(r)
      return out
    }
    if ((m = query.match(/^h(?:izb)?\s*(\d{1,2}(?:\.\d{1,2})?)$/i))) {
      const h = parseFloat(m[1])
      if (m[1].includes('.')) {
        const r = hizbRow(h)
        if (r) out.push(r)
      } else {
        // integer hizb — offer the hizb and its quarters
        for (const f of [0, 0.25, 0.5, 0.75]) {
          const r = hizbRow(h + f)
          if (r) out.push(r)
        }
      }
      return out
    }
    // bare keywords list everything in order
    if (/^j(?:uz)?$/i.test(query)) {
      for (let j = 1; j <= 30; j++) out.push(juzRow(j))
      return out
    }
    if (/^h(?:izb)?$/i.test(query)) {
      for (let h = 1; h <= 60; h++) out.push(hizbRow(h))
      return out
    }
    if (/^p(?:age)?$/i.test(query)) {
      for (let p = 1; p <= 604; p++) out.push(pageRow(p))
      return out
    }
    if (/^sur?ahs?$/i.test(query)) {
      for (const s of surahs) out.push(surahRow(s))
      return out
    }
    // 'surah fatihah' / 'surah 2' — strip the keyword and search the rest
    if ((m = query.match(/^sur?ahs?\s+(.+)$/i))) {
      const rest = m[1].trim()
      if (/^\d{1,3}$/.test(rest)) {
        const s = +rest >= 1 && +rest <= 114 && bySurah(+rest)
        if (s) out.push(surahRow(s))
        return out
      }
      query = rest // fall through to name matching below
    }
    if (/^\d{1,3}$/.test(query)) {
      const n = +query
      const s = n >= 1 && n <= 114 && bySurah(n)
      if (s) out.push(surahRow(s))
      const p = pageRow(n)
      if (p) out.push(p)
      const j = juzRow(n)
      if (j) out.push(j)
      const h = hizbRow(n)
      if (h) out.push(h)
      return out
    }
    if (isArabic(query)) {
      const nq = normalize(query)
      for (const s of surahs) {
        if (normalize(s.name).includes(nq)) {
          out.push(surahRow(s))
          if (out.length >= 8) break
        }
      }
      return out
    }
    // 'baqarah 255' — latin name followed by an ayah number
    if ((m = query.match(/^([a-zʾʿ'‘’][a-zʾʿ'‘’\s-]*)\s+(\d{1,3})$/i))) {
      const nq = normalizeName(m[1])
      if (nq) {
        for (const s of surahs) {
          if (normalizeName(s.englishName).includes(nq)) {
            const a = Math.min(Math.max(1, +m[2]), s.ayahCount)
            out.push({
              badge: 'Ayah',
              title: `${s.englishName} ${s.number}:${a}`,
              sub: `${s.translation} · ${s.ayahCount} ayahs`,
              go: () => openReader(s.number, a),
            })
            if (out.length >= 3) break
          }
        }
      }
    }
    const lq = query.toLowerCase()
    const nq = normalizeName(query)
    for (const s of surahs) {
      if ((nq && normalizeName(s.englishName).includes(nq)) || s.translation.toLowerCase().includes(lq)) {
        out.push(surahRow(s))
        if (out.length >= 8) break
      }
    }
    return out
  }, [q, surahs, open])

  const all = results.concat(ayahResults)
  const selIdx = Math.min(sel, Math.max(0, all.length - 1))

  useEffect(() => {
    listRef.current?.querySelector('.cmdk-row.sel')?.scrollIntoView({ block: 'nearest' })
  }, [selIdx])

  if (!open) return null

  const close = () => setOpen(false)
  const activate = (r) => {
    r.go()
    close()
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSel((s) => Math.min(s + 1, all.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSel((s) => Math.max(s - 1, 0))
    } else if (e.key === 'Enter') {
      if (all[selIdx]) activate(all[selIdx])
    }
  }

  return (
    <div className="cmdk-overlay" onClick={close}>
      <div className="cmdk-panel" onClick={(e) => e.stopPropagation()}>
        <input
          className="cmdk-input"
          autoFocus
          placeholder="Search surah, ayah (2:255), page, juz, hizb or text…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <div className="cmdk-list" ref={listRef}>
          {all.map((r, i) => (
            <div
              key={i}
              className={'cmdk-row' + (i === selIdx ? ' sel' : '')}
              onMouseEnter={() => setSel(i)}
              onClick={() => activate(r)}
            >
              <span className="cmdk-badge">{r.badge}</span>
              <span className="cmdk-main">
                <span className="cmdk-title">{r.title}</span>
                {r.sub && <span className="cmdk-sub">{r.sub}</span>}
                {r.ar && (
                  <span className="cmdk-ar" dir="rtl" lang="ar">
                    {r.ar}
                  </span>
                )}
              </span>
            </div>
          ))}
          {all.length === 0 && <div className="cmdk-empty">No results</div>}
        </div>
      </div>
    </div>
  )
}
