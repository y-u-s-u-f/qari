export const load = (key, fallback) => {
  try {
    const v = JSON.parse(localStorage.getItem('qari.' + key))
    return v ?? fallback
  } catch {
    return fallback
  }
}

export const save = (key, value) => {
  localStorage.setItem('qari.' + key, JSON.stringify(value))
}
