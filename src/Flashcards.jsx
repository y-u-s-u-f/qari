import { useEffect, useRef, useState } from 'react'
import { getSurah } from './quran'
import { getReciter } from './recite'
import { graded, fmtInterval } from './srs'
import { load, save } from './store'

const GRADES = [
  { g: 0, label: 'Again', cls: 're' },
  { g: 1, label: 'Hard', cls: 'or' },
  { g: 2, label: 'Good', cls: 'gr' },
  { g: 3, label: 'Easy', cls: 'bl' },
]

export default function Flashcards({ goHome, openReader }) {
  const [cards, setCards] = useState(() => load('cards', []))
  const [revealed, setRevealed] = useState(false)
  const [verse, setVerse] = useState(null)
  const [rec, setRec] = useState({ status: 'idle', coverage: 0, wrongVerse: false, done: false })
  const cardRef = useRef(null)

  const due = cards.filter((c) => c.due <= Date.now()).sort((a, b) => a.due - b.due)
  const card = due[0]
  cardRef.current = card

  useEffect(() => {
    setRevealed(false)
    setVerse(null)
    setRec({ status: 'idle', coverage: 0, wrongVerse: false, done: false })
    getReciter().stop()
    if (!card) return
    let alive = true
    getSurah(card.surah).then((s) => {
      if (!alive) return
      const a = s.ayahs.find((x) => x.n === card.ayah)
      setVerse({ surahName: s.englishName, surahAr: s.name, total: s.ayahs.length, words: a?.words ?? [] })
    })
    return () => {
      alive = false
    }
  }, [card?.id])

  useEffect(() => {
    const reciter = getReciter()
    const unsub = reciter.subscribe((msg) => {
      const cur = cardRef.current
      if (!cur) return
      if (msg.type === 'status') {
        setRec((r) => ({ ...r, status: msg.status, percent: msg.percent, message: msg.message }))
      } else if (msg.type === 'word_progress') {
        if (msg.surah === cur.surah && msg.ayah === cur.ayah) {
          const coverage = msg.total_words ? msg.matched_indices.length / msg.total_words : 0
          setRec((r) => {
            const next = { ...r, coverage: Math.max(r.coverage, coverage), wrongVerse: false }
            if (coverage >= 0.9 && !next.done) {
              next.done = true
              reciter.stop()
              setRevealed(true)
            }
            return next
          })
        } else {
          setRec((r) => ({ ...r, wrongVerse: true }))
        }
      }
    })
    return () => {
      unsub()
      reciter.stop()
    }
  }, [])

  const startRecite = () => {
    setRec({ status: 'loading', coverage: 0, wrongVerse: false, done: false })
    getReciter()
      .start()
      .catch((err) => setRec((r) => ({ ...r, status: 'error', message: err.message })))
  }

  const answer = (g) => {
    getReciter().stop()
    const updated = graded(card, g)
    setCards((prev) => {
      const next = prev.map((c) => (c.id === card.id ? updated : c))
      save('cards', next)
      return next
    })
  }

  const listening = rec.status === 'listening'

  return (
    <div className="page cards-page">
      <div className="reader-bar">
        <button className="ghost" onClick={goHome}>
          ← Home
        </button>
        <div className="hint">
          {cards.length} cards · {due.length} due
        </div>
      </div>

      {!card && (
        <div className="card-frame empty">
          <div className="empty-title">{cards.length ? 'All caught up ✓' : 'No flashcards yet'}</div>
          <div className="muted">
            {cards.length
              ? 'Nothing is due for review right now.'
              : 'In the reading view, tap an ayah number ١, then tap the last word that stays visible on the card.'}
          </div>
        </div>
      )}

      {card && (
        <div className="card-frame">
          <div className="card-meta">
            {verse ? `${verse.surahName} · Ayah ${card.ayah} of ${verse.total}` : '…'}
          </div>

          <div className="card-prompt" dir="rtl" lang="ar">
            {verse
              ? verse.words.slice(0, (card.promptEnd ?? 2) + 1).join(' ') +
                ((card.promptEnd ?? 2) + 1 < verse.words.length ? ' …' : '')
              : ''}
          </div>
          <div className="muted center">
            {rec.done
              ? '✓ Recited from memory'
              : listening
                ? 'Listening — recite the verse'
                : 'Recite the rest of the verse from memory'}
          </div>

          {(listening || rec.coverage > 0) && !revealed && (
            <div className="rec-progress">
              <div className="rec-progress-fill" style={{ width: Math.round(rec.coverage * 100) + '%' }} />
            </div>
          )}
          {rec.wrongVerse && !revealed && <div className="muted center">that sounds like a different verse…</div>}

          {revealed && verse && (
            <div className="card-answer" dir="rtl" lang="ar">
              {verse.words.join(' ')}
            </div>
          )}

          {!revealed ? (
            <div className="card-actions">
              <button
                className={'primary' + (listening ? ' listening' : '')}
                onClick={listening ? () => getReciter().stop() : startRecite}
                disabled={rec.status === 'loading'}
              >
                {listening
                  ? '⏹ Stop listening'
                  : rec.status === 'loading'
                    ? rec.percent
                      ? `Loading ${rec.percent}%`
                      : 'Loading…'
                    : '🎙 Recite answer'}
              </button>
              <button className="ghost" onClick={() => setRevealed(true)}>
                Show answer
              </button>
              <button className="ghost" onClick={() => openReader(card.surah, card.ayah)}>
                Open in reader
              </button>
            </div>
          ) : (
            <div className="card-actions">
              {GRADES.map(({ g, label, cls }) => (
                <button key={g} className={'grade ' + cls} onClick={() => answer(g)}>
                  {label}
                  <span className="grade-ivl">{fmtInterval(graded(card, g).interval)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
