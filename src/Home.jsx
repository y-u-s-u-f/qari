import { useEffect, useMemo, useRef, useState } from 'react'
import { getSurahList } from './quran'
import { normalizeName } from './surah-names'
import { getReciter } from './recite'
import { load } from './store'

export default function Home({ openReader, openCards, theme, setTheme }) {
  const [list, setList] = useState([])
  const [q, setQ] = useState('')
  const [recite, setRecite] = useState(null) // null | {status, percent, message, transcript, candidates}
  const openRef = useRef(false)

  useEffect(() => {
    getSurahList().then(setList).catch(console.error)
  }, [])

  const lastRead = load('lastRead', null)
  const recent = load('recent', [])
  const cards = load('cards', [])
  const due = cards.filter((c) => c.due <= Date.now()).length

  const byNumber = useMemo(() => new Map(list.map((s) => [s.number, s])), [list])

  const search = useMemo(() => {
    const raw = q.trim()
    if (!raw) return { surahs: list, ayah: null }
    // 'baqarah 255' — latin name followed by an ayah number
    const m = raw.match(/^([a-zA-Zʾʿ'‘’][a-zA-Zʾʿ'‘’\s-]*)\s+(\d{1,3})$/)
    const name = m ? m[1] : raw
    const ayah = m ? +m[2] : null
    const nq = normalizeName(name)
    const lq = name.toLowerCase()
    return {
      surahs: list.filter(
        (x) =>
          (nq && normalizeName(x.englishName).includes(nq)) ||
          x.translation.toLowerCase().includes(lq) ||
          String(x.number) === raw ||
          x.name.includes(raw)
      ),
      ayah,
    }
  }, [list, q])

  useEffect(() => {
    const reciter = getReciter()
    const unsub = reciter.subscribe((msg) => {
      if (!openRef.current) return
      if (msg.type === 'status') {
        setRecite((r) => r && { ...r, status: msg.status, percent: msg.percent, message: msg.message })
      } else if (msg.type === 'raw_transcript') {
        setRecite((r) => r && { ...r, transcript: msg.text })
      } else if (msg.type === 'verse_candidate') {
        setRecite((r) => r && { ...r, candidates: msg.candidates.slice(0, 3) })
      } else if (msg.type === 'verse_match') {
        closeRecite()
        openReader(msg.surah, msg.ayah)
      }
    })
    return () => {
      unsub()
      if (openRef.current) getReciter().stop()
    }
  }, [])

  const startRecite = () => {
    openRef.current = true
    setRecite({ status: 'loading', percent: 0, message: '', transcript: '', candidates: [] })
    getReciter()
      .start()
      .catch((err) => setRecite((r) => r && { ...r, status: 'error', message: err.message }))
  }

  const closeRecite = () => {
    openRef.current = false
    getReciter().stop()
    setRecite(null)
  }

  const lastSurah = lastRead && byNumber.get(lastRead.surah)

  return (
    <div className="page">
      <header className="home-header">
        <div className="brand">
          <span className="brand-ar">قارئ</span>
          <span className="brand-en">Qāriʾ</span>
        </div>
        <button className="ghost" onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>
          {theme === 'light' ? '☾ Dark' : '☀ Light'}
        </button>
      </header>

      {lastSurah && (
        <button className="continue-card" onClick={() => openReader(lastRead.surah, lastRead.ayah)}>
          <div>
            <div className="label">Continue reading</div>
            <div className="continue-title">
              {lastSurah.englishName} · Ayah {lastRead.ayah}
            </div>
          </div>
          <span className="continue-ar">{lastSurah.name}</span>
        </button>
      )}

      <div className="nav-row">
        <button className="nav-card" onClick={openCards}>
          <div className="nav-title">Flashcards</div>
          <div className="nav-sub">{due > 0 ? `${due} due for review` : cards.length ? 'Nothing due' : 'No cards yet'}</div>
        </button>
        <button className="nav-card" onClick={startRecite}>
          <div className="nav-title">🎙 Recite</div>
          <div className="nav-sub">Speak a verse to jump there</div>
        </button>
      </div>

      {recent.length > 0 && (
        <section>
          <div className="label">Recently read</div>
          <div className="chips">
            {recent.map(
              (n) =>
                byNumber.get(n) && (
                  <button key={n} className="chip" onClick={() => openReader(n)}>
                    {byNumber.get(n).englishName}
                  </button>
                )
            )}
          </div>
        </section>
      )}

      <section>
        <div className="label">Surahs</div>
        <input
          className="search"
          placeholder="Search surah by name or number…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="surah-grid">
          {search.surahs.map((s) => {
            const ayah = search.ayah && Math.min(Math.max(1, search.ayah), s.ayahCount)
            return (
              <button
                key={s.number}
                className="surah-card"
                onClick={() => (ayah ? openReader(s.number, ayah) : openReader(s.number))}
              >
                <span className="surah-num">{s.number}</span>
                <span className="surah-names">
                  <span className="surah-en">{s.englishName}</span>
                  <span className="surah-tr">
                    {s.translation} · {s.ayahCount} ayahs
                    {ayah ? ` · Ayah ${ayah}` : ''}
                  </span>
                </span>
                <span className="surah-ar">{s.name}</span>
              </button>
            )
          })}
        </div>
        {list.length === 0 && <div className="muted">Loading surahs…</div>}
      </section>

      {recite && (
        <div className="recite-overlay" onClick={closeRecite}>
          <div className="recite-modal" onClick={(e) => e.stopPropagation()}>
            <div className={'recite-orb' + (recite.status === 'listening' ? ' live' : '')}>🎙</div>
            <div className="recite-status">
              {recite.status === 'listening'
                ? 'Listening — recite any verse'
                : recite.status === 'error'
                  ? `Error: ${recite.message}`
                  : recite.percent
                    ? `Loading recognition model… ${recite.percent}%`
                    : recite.message || 'Loading…'}
            </div>
            {recite.transcript && (
              <div className="recite-transcript" dir="rtl" lang="ar">
                {recite.transcript}
              </div>
            )}
            {recite.candidates?.length > 0 && (
              <div className="recite-candidates">
                {recite.candidates.map((c) => {
                  const s = byNumber.get(c.surah)
                  return (
                    <button
                      key={`${c.surah}:${c.ayah}`}
                      className="chip"
                      onClick={() => {
                        closeRecite()
                        openReader(c.surah, c.ayah)
                      }}
                    >
                      {s ? s.englishName : c.surah} : {c.ayah}
                    </button>
                  )
                })}
              </div>
            )}
            <button className="ghost" onClick={closeRecite}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
