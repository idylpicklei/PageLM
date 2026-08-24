import { useMemo, useState, type DragEvent } from "react"
import { type PlannerTask } from "../../lib/api"
import { dateKeyFromDue, dueMs, formatTime, localDateKey, monthGrid, WEEKDAY_LABELS } from "./date"

type Props = {
    tasks: PlannerTask[]
    onMoveDue: (id: string, dueAt: string) => Promise<void> | void
}

export default function MonthCalendar({ tasks, onMoveDue }: Props) {
    const now = new Date()
    const [cursor, setCursor] = useState({ year: now.getFullYear(), month: now.getMonth() })
    const [overDay, setOverDay] = useState<string | null>(null)
    const [moving, setMoving] = useState<string | null>(null)

    const weeks = useMemo(() => monthGrid(cursor.year, cursor.month), [cursor.year, cursor.month])
    const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })
    const today = localDateKey()

    const openTasks = tasks.filter((t) => t.status !== "done")
    const byDay = useMemo(() => {
        const map: Record<string, PlannerTask[]> = {}
        for (const task of openTasks) {
            const key = dateKeyFromDue(task.dueAt)
            if (!key) continue
            ;(map[key] ||= []).push(task)
        }
        for (const list of Object.values(map)) {
            list.sort((a, b) => dueMs(a.dueAt) - dueMs(b.dueAt))
        }
        return map
    }, [openTasks])

    const unscheduled = openTasks.filter((t) => !dateKeyFromDue(t.dueAt))

    const shiftMonth = (delta: number) => {
        setCursor(({ year, month }) => {
            const d = new Date(year, month + delta, 1)
            return { year: d.getFullYear(), month: d.getMonth() }
        })
    }

    const moveToDay = async (task: PlannerTask, dateKey: string) => {
        setMoving(task.id)
        try {
            const ms = dueMs(task.dueAt)
            const src = Number.isFinite(ms) ? new Date(ms) : new Date()
            const [y, m, d] = dateKey.split("-").map(Number)
            src.setFullYear(y, (m || 1) - 1, d || 1)
            await onMoveDue(task.id, src.toISOString())
        } finally {
            setMoving(null)
            setOverDay(null)
        }
    }

    const onDropDay = (dateKey: string, e: DragEvent) => {
        e.preventDefault()
        const id = e.dataTransfer.getData("text/task-id")
        const task = openTasks.find((t) => t.id === id)
        if (task) void moveToDay(task, dateKey)
    }

    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                    <button
                        type="button"
                        onClick={() => shiftMonth(-1)}
                        className="px-2 py-1 rounded bg-stone-900 border border-zinc-800 text-stone-300 hover:bg-stone-800"
                        aria-label="Previous month"
                    >
                        ‹
                    </button>
                    <div className="text-zinc-100 font-medium min-w-[10rem] text-center">{monthLabel}</div>
                    <button
                        type="button"
                        onClick={() => shiftMonth(1)}
                        className="px-2 py-1 rounded bg-stone-900 border border-zinc-800 text-stone-300 hover:bg-stone-800"
                        aria-label="Next month"
                    >
                        ›
                    </button>
                    <button
                        type="button"
                        onClick={() => setCursor({ year: now.getFullYear(), month: now.getMonth() })}
                        className="text-xs px-2 py-1 rounded bg-stone-800 text-stone-200"
                    >
                        Today
                    </button>
                </div>
                <div className="text-[11px] text-stone-500">Drag a task onto a day to move it</div>
            </div>

            {unscheduled.length > 0 && (
                <div className="mb-3 rounded-lg border border-zinc-800 bg-stone-950 p-2">
                    <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-2">No date</div>
                    <div className="flex flex-wrap gap-2">
                        {unscheduled.map((task) => (
                            <div
                                key={task.id}
                                draggable
                                onDragStart={(e) => {
                                    e.dataTransfer.setData("text/task-id", task.id)
                                    e.dataTransfer.effectAllowed = "move"
                                }}
                                className="px-2 py-1 rounded bg-stone-900 border border-zinc-800 text-xs text-stone-200 cursor-grab"
                            >
                                {task.title}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="grid grid-cols-7 gap-px rounded-xl overflow-hidden border border-zinc-800 bg-zinc-800">
                {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="bg-stone-950 px-2 py-1.5 text-[11px] uppercase tracking-wide text-stone-500 text-center">
                        {label}
                    </div>
                ))}
                {weeks.flat().map((cell) => {
                    const items = byDay[cell.key] || []
                    const isOver = overDay === cell.key
                    return (
                        <div
                            key={cell.key}
                            onDragOver={(e) => {
                                e.preventDefault()
                                setOverDay(cell.key)
                            }}
                            onDragLeave={() => setOverDay((cur) => (cur === cell.key ? null : cur))}
                            onDrop={(e) => onDropDay(cell.key, e)}
                            className={[
                                "min-h-[110px] p-1.5 bg-stone-950",
                                cell.inMonth ? "" : "opacity-40",
                                cell.isToday ? "ring-1 ring-inset ring-sky-500/70" : "",
                                isOver ? "bg-sky-950/40" : "",
                            ].join(" ")}
                        >
                            <div className={`text-[11px] mb-1 ${cell.key === today ? "text-sky-300 font-semibold" : "text-stone-500"}`}>
                                {cell.date.getDate()}
                            </div>
                            <div className="space-y-1">
                                {items.slice(0, 3).map((task) => (
                                    <div
                                        key={task.id}
                                        draggable
                                        onDragStart={(e) => {
                                            e.dataTransfer.setData("text/task-id", task.id)
                                            e.dataTransfer.effectAllowed = "move"
                                        }}
                                        title={task.title}
                                        className={`rounded px-1.5 py-1 bg-stone-900 border border-zinc-800 cursor-grab active:cursor-grabbing ${moving === task.id ? "opacity-50" : ""}`}
                                    >
                                        <div className="text-[11px] text-stone-100 truncate">{task.title}</div>
                                        <div className="text-[10px] text-stone-500">{formatTime(task.dueAt)}</div>
                                    </div>
                                ))}
                                {items.length > 3 && (
                                    <div className="text-[10px] text-stone-500 px-1">+{items.length - 3} more</div>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
