import { useEffect, useState } from 'react'
import Home from './Home'
import Reader from './Reader'
import Flashcards from './Flashcards'
import CommandBar from './CommandBar'
import { load, save } from './store'

// URL ↔ view: /home, /cards, /mushaf?ayah=51:10 (bare /mushaf resumes last position)
const parseLocation = () => {
  const path = window.location.pathname
  if (path === '/mushaf') {
    const q = new URLSearchParams(window.location.search).get('ayah')
    const m = q?.match(/^(\d{1,3}):(\d{1,3})$/)
    if (m && +m[1] >= 1 && +m[1] <= 114) {
      return { name: 'read', surah: +m[1], ayah: Math.max(1, +m[2]) }
    }
    const last = load('lastRead', null)
    return { name: 'read', surah: last?.surah ?? 1, ayah: last?.ayah ?? 1 }
  }
  if (path === '/cards') return { name: 'cards' }
  return { name: 'home' }
}

const urlFor = (view) =>
  view.name === 'read' ? `/mushaf?ayah=${view.surah}:${view.ayah}` : view.name === 'cards' ? '/cards' : '/home'

export default function App() {
  const [theme, setTheme] = useState(() => load('theme', 'light'))
  const [palette, setPalette] = useState(() => load('palette', 'flexoki'))
  const [view, setView] = useState(parseLocation)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    save('theme', theme)
  }, [theme])

  useEffect(() => {
    if (palette === 'flexoki') delete document.documentElement.dataset.palette
    else document.documentElement.dataset.palette = palette
    save('palette', palette)
  }, [palette])

  useEffect(() => {
    // normalize the address bar on first load ('/' → '/home', bare /mushaf → resumed ayah)
    window.history.replaceState(null, '', urlFor(parseLocation()))
    const onPop = () => setView(parseLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const navigate = (next) => {
    window.history.pushState(null, '', urlFor(next))
    setView(next)
  }

  const openReader = (surah, ayah = 1) => navigate({ name: 'read', surah, ayah })
  const openCards = () => navigate({ name: 'cards' })
  const goHome = () => navigate({ name: 'home' })

  return (
    <>
      {view.name === 'home' && <Home openReader={openReader} openCards={openCards} theme={theme} setTheme={setTheme} />}
      {view.name === 'read' && (
        <Reader
          surah={view.surah}
          ayah={view.ayah}
          nav={view}
          goHome={goHome}
          theme={theme}
          setTheme={setTheme}
          palette={palette}
          setPalette={setPalette}
        />
      )}
      {view.name === 'cards' && <Flashcards goHome={goHome} openReader={openReader} />}
      <CommandBar openReader={openReader} openCards={openCards} />
    </>
  )
}
