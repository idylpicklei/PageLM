export function dueMs(dueAt: unknown): number {
    if (typeof dueAt === "number" && Number.isFinite(dueAt)) return dueAt
    const n = Date.parse(String(dueAt ?? ""))
    return Number.isFinite(n) ? n : NaN
}

export function localDateKey(d: Date = new Date()): string {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, "0")
    const day = String(d.getDate()).padStart(2, "0")
    return `${y}-${m}-${day}`
}

export function dateKeyFromDue(dueAt: unknown): string | null {
    const ms = dueMs(dueAt)
    if (!Number.isFinite(ms)) return null
    return localDateKey(new Date(ms))
}

export function toLocalInput(dueAt: unknown): string {
    const ms = dueMs(dueAt)
    if (!Number.isFinite(ms)) return ""
    const d = new Date(ms)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function dueIsoFromLocalInput(value: string): string {
    return new Date(value).toISOString()
}

export function moveDueToDateKey(dueAt: unknown, dateKey: string): string {
    const [y, m, d] = dateKey.split("-").map(Number)
    const ms = dueMs(dueAt)
    const src = Number.isFinite(ms) ? new Date(ms) : new Date()
    const next = new Date(src)
    next.setFullYear(y, (m || 1) - 1, d || 1)
    return next.toISOString()
}

export function formatDue(dueAt: unknown): string {
    const ms = dueMs(dueAt)
    if (!Number.isFinite(ms)) return "No date"
    return new Date(ms).toLocaleString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    })
}

export function formatTime(dueAt: unknown): string {
    const ms = dueMs(dueAt)
    if (!Number.isFinite(ms)) return ""
    return new Date(ms).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
}

export type CalendarCell = {
    key: string
    date: Date
    inMonth: boolean
    isToday: boolean
}

export function monthGrid(year: number, month: number, weekStartsOn = 0): CalendarCell[][] {
    const first = new Date(year, month, 1)
    const start = new Date(first)
    start.setDate(1 - ((first.getDay() - weekStartsOn + 7) % 7))
    const today = localDateKey()
    const weeks: CalendarCell[][] = []
    for (let w = 0; w < 6; w++) {
        const week: CalendarCell[] = []
        for (let d = 0; d < 7; d++) {
            const date = new Date(start)
            date.setDate(start.getDate() + w * 7 + d)
            const key = localDateKey(date)
            week.push({
                key,
                date,
                inMonth: date.getMonth() === month,
                isToday: key === today,
            })
        }
        weeks.push(week)
    }
    return weeks
}

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
