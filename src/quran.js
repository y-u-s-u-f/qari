// Text source: official KFGQPC UthmanicHafs v22 document, parsed into
// public/quran.json — encoding matches the bundled UthmanicHafs_V22.ttf font.
import { SURAH_NAMES } from './surah-names'

let dataPromise = null

// drop the stale API-sourced cache from earlier builds
localStorage.removeItem('qari.surahList')

function getData() {
  if (!dataPromise) {
    dataPromise = fetch('/quran.json').then((r) => r.json())
  }
  return dataPromise
}

export async function getSurahList() {
  const data = await getData()
  return data.map((s) => ({
    number: s.number,
    name: s.name,
    englishName: SURAH_NAMES[s.number - 1],
    translation: s.translation,
    ayahCount: s.ayahs.length,
    type: s.type,
  }))
}

export async function getSurah(n) {
  const data = await getData()
  const s = data[n - 1]
  return {
    number: s.number,
    name: s.name,
    englishName: SURAH_NAMES[n - 1],
    basmala: s.basmala,
    // NBSP joins the ۞ rub' el hizb ornament to the next word; treat it as a separator
    ayahs: s.ayahs.map((text, i) => ({ n: i + 1, words: text.split(/[ \u00A0]/) })),
  }
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩'
export const toArabicDigits = (n) =>
  String(n)
    .split('')
    .map((d) => AR_DIGITS[+d])
    .join('')
