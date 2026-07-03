import { load, save } from './store'

const mem = new Map()
const MAX_AGE = 30 * 24 * 60 * 60 * 1000

async function callTool(key, name, args) {
  if (mem.has(key)) return mem.get(key)
  const cached = load(key, null)
  if (cached && Date.now() - cached.t < MAX_AGE) {
    mem.set(key, cached.data)
    return cached.data
  }
  const res = await fetch('https://mcp.tarteel.ai/mcp', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }),
  })
  if (!res.ok) throw new Error('request failed: ' + res.status)
  const text = await res.text()
  let obj
  if (text.trimStart().startsWith('{')) {
    obj = JSON.parse(text)
  } else {
    const line = text.split('\n').find((l) => l.startsWith('data: '))
    if (!line) throw new Error('unexpected response format')
    obj = JSON.parse(line.slice(6))
  }
  if (obj.result?.isError) {
    throw new Error(obj.result.content?.map((c) => c.text).join(' ') || 'server error')
  }
  const data = obj.result?.structuredContent
  if (!data) throw new Error('empty response')
  mem.set(key, data)
  try {
    save(key, { t: Date.now(), data })
  } catch {
    // localStorage full — in-memory cache still works
  }
  return data
}

export function fetchMutashabihat(surah, ayah) {
  return callTool(`mutash.${surah}:${ayah}`, 'ayah_mutashabihat', { surah, ayah })
}

export function fetchPhraseMutashabihat(phraseText) {
  return callTool('mutash.p.' + phraseText, 'phrase_mutashabihat', { phrase_text: phraseText })
}
