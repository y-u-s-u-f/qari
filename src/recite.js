// Recitation recognition — vendored tilawa.dev engine (MIT © yazinsai),
// see src/tilawa/. Runs fully on-device: mic → AudioWorklet (16kHz chunks)
// → module worker (ONNX FastConformer CTC + verse tracker).
//
// Singleton: the 88MB model loads once and the worker survives view changes.

let reciter = null

export function getReciter() {
  if (!reciter) reciter = createReciter()
  return reciter
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  window.__qariReciter = getReciter
}

function createReciter() {
  let worker = null
  let readyPromise = null
  let stream = null
  let audioCtx = null
  const listeners = new Set()

  const state = {
    status: 'idle', // idle | loading | ready | listening | error
    percent: 0,
    message: '',
  }

  const emit = (event) => {
    for (const fn of [...listeners]) fn(event)
  }
  const setStatus = (status, extra = {}) => {
    Object.assign(state, { status }, extra)
    emit({ type: 'status', ...state })
  }

  const ensureLoaded = () => {
    if (readyPromise) return readyPromise
    setStatus('loading', { message: 'Starting engine…' })
    worker = new Worker(new URL('./tilawa/worker/inference.ts', import.meta.url), {
      type: 'module',
    })
    readyPromise = new Promise((resolve, reject) => {
      worker.onmessage = (e) => {
        const msg = e.data
        if (msg.type === 'loading') {
          setStatus('loading', { percent: msg.percent })
        } else if (msg.type === 'loading_status') {
          setStatus('loading', { message: msg.message })
        } else if (msg.type === 'ready') {
          setStatus(state.status === 'listening' ? 'listening' : 'ready')
          resolve()
        } else if (msg.type === 'error') {
          setStatus('error', { message: msg.message })
          reject(new Error(msg.message))
        } else {
          emit(msg) // verse_match / verse_candidate / word_progress / raw_transcript / final_sequence / debug
        }
      }
      worker.onerror = (e) => {
        setStatus('error', { message: e.message || 'worker error' })
        reject(new Error(e.message || 'worker error'))
      }
    })
    worker.postMessage({ type: 'init' })
    return readyPromise
  }

  return {
    get status() {
      return state.status
    },
    subscribe(fn) {
      listeners.add(fn)
      return () => listeners.delete(fn)
    },
    preload: ensureLoaded,

    async start() {
      await ensureLoaded()
      if (stream) return // already listening
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      })
      audioCtx = new AudioContext()
      await audioCtx.audioWorklet.addModule('/tilawa/audio-processor.js')
      const source = audioCtx.createMediaStreamSource(stream)
      const processor = new AudioWorkletNode(audioCtx, 'audio-stream-processor')
      processor.port.onmessage = (e) => {
        const samples = new Float32Array(e.data)
        worker?.postMessage({ type: 'audio', samples }, [samples.buffer])
      }
      source.connect(processor)
      setStatus('listening')
    },

    stop() {
      if (stream) {
        stream.getTracks().forEach((t) => t.stop())
        stream = null
      }
      if (audioCtx) {
        audioCtx.close()
        audioCtx = null
      }
      worker?.postMessage({ type: 'reset' }) // fresh discovery next session
      if (state.status === 'listening') setStatus('ready')
    },
  }
}
