// Simplified SM-2. grade: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy.
// interval is in days.
export function graded(card, grade) {
  let { reps = 0, ease = 2.5, interval = 0 } = card
  if (grade === 0) {
    reps = 0
    interval = 10 / (60 * 24) // 10 minutes
  } else {
    if (reps === 0) interval = grade === 1 ? 0.5 : grade === 2 ? 1 : 3
    else interval = grade === 1 ? interval * 1.2 : grade === 2 ? interval * ease : interval * ease * 1.4
    reps += 1
  }
  ease = Math.max(1.3, ease + (grade === 0 ? -0.2 : grade === 1 ? -0.15 : grade === 3 ? 0.15 : 0))
  return { ...card, reps, ease, interval, due: Date.now() + interval * 864e5 }
}

export const fmtInterval = (days) => {
  if (days < 1 / 24) return Math.round(days * 1440) + 'm'
  if (days < 1) return Math.round(days * 24) + 'h'
  if (days < 30) return Math.round(days) + 'd'
  return Math.round(days / 30) + 'mo'
}
