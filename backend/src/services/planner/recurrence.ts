import type { Recurrence, RecurrenceFreq } from "./types"

export function nextOccurrence(fromDue: string | undefined, freq: RecurrenceFreq, after = Date.now()): string {
  const baseMs = fromDue ? Date.parse(fromDue) : NaN
  let next = Number.isFinite(baseMs) ? new Date(baseMs) : new Date(after)

  const advance = () => {
    switch (freq) {
      case "daily":
        next.setDate(next.getDate() + 1)
        break
      case "weekly":
        next.setDate(next.getDate() + 7)
        break
      case "biweekly":
        next.setDate(next.getDate() + 14)
        break
      case "monthly":
        next.setMonth(next.getMonth() + 1)
        break
    }
  }

  while (next.getTime() <= after) advance()
  return next.toISOString()
}

export function parseRecurrence(value: unknown): Recurrence | undefined {
  if (!value || typeof value !== "object") return undefined
  const freq = (value as Recurrence).freq
  if (freq === "daily" || freq === "weekly" || freq === "biweekly" || freq === "monthly") {
    return { freq }
  }
  return undefined
}
