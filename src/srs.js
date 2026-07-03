// FSRS scheduler (ts-fsrs, default parameters). grade: 0 = Again, 1 = Hard, 2 = Good, 3 = Easy.
// interval is in days. Dates are persisted as ms timestamps on our card object.
import { fsrs, createEmptyCard, State } from 'ts-fsrs'

const f = fsrs()

// Rebuild a ts-fsrs Card from our stored card, seeding legacy (pre-FSRS) cards lazily.
function toFsrs(card, now) {
  if (card.stability != null) {
    return {
      due: new Date(card.due),
      stability: card.stability,
      difficulty: card.difficulty,
      elapsed_days: card.elapsed_days ?? 0,
      scheduled_days: card.scheduled_days ?? 0,
      reps: card.reps ?? 0,
      lapses: card.lapses ?? 0,
      learning_steps: card.learning_steps ?? 0,
      state: card.state ?? State.New,
      last_review: card.last_review != null ? new Date(card.last_review) : undefined,
    }
  }
  if (!card.reps) return createEmptyCard(now)
  const ivl = Math.max(card.interval || 0, 0.1)
  const due = card.due || now.getTime()
  return {
    ...createEmptyCard(now),
    due: new Date(due),
    stability: ivl,
    difficulty: 5,
    scheduled_days: Math.round(ivl),
    reps: card.reps,
    state: State.Review,
    last_review: new Date(due - ivl * 864e5),
  }
}

export function graded(card, grade) {
  const now = new Date()
  const { card: next } = f.next(toFsrs(card, now), now, grade + 1)
  return {
    ...card,
    due: next.due.getTime(),
    interval: (next.due.getTime() - now.getTime()) / 864e5,
    stability: next.stability,
    difficulty: next.difficulty,
    elapsed_days: next.elapsed_days,
    scheduled_days: next.scheduled_days,
    reps: next.reps,
    lapses: next.lapses,
    learning_steps: next.learning_steps,
    state: next.state,
    last_review: next.last_review ? next.last_review.getTime() : now.getTime(),
  }
}

export const fmtInterval = (days) => {
  if (days < 1 / 24) return Math.round(days * 1440) + 'm'
  if (days < 1) return Math.round(days * 24) + 'h'
  if (days < 30) return Math.round(days) + 'd'
  return Math.round(days / 30) + 'mo'
}
