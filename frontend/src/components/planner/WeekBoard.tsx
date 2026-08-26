import { useMemo, useState, type DragEvent } from "react"
import { type PlannerRecurrence, type PlannerTask } from "../../lib/api"
import { dateKeyFromDue, dueMs, formatDue, localDateKey, toLocalInput } from "./date"
import { RECURRENCE_OPTIONS, recurrenceLabel } from "./recurrence"

type Props = {
    tasks: PlannerTask[]
    onMoveDue: (id: string, dueAt: string) => Promise<void> | void
    onUpdateRecurrence?: (id: string, recurrence: PlannerRecurrence | null) => Promise<void> | void
}

const DAY_MS = 24 * 60 * 60 * 1000

function TaskCard({
    task,
    moving,
    showDueDate = false,
    onMoveDue,
    onUpdateRecurrence,
}: {
    task: PlannerTask
    moving: boolean
    showDueDate?: boolean
    onMoveDue: (id: string, dueAt: string) => Promise<void> | void
    onUpdateRecurrence?: (id: string, recurrence: PlannerRecurrence | null) => Promise<void> | void
}) {
    return (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData("text/task-id", task.id)
                e.dataTransfer.effectAllowed = "move"
            }}
            className={`rounded-lg border border-zinc-800 bg-stone-900 px-2.5 py-2 cursor-grab active:cursor-grabbing ${moving ? "opacity-50" : ""}`}
            title="Drag to another day"
        >
            <div className="flex items-start justify-between gap-2">
                <div className="text-stone-100 text-sm font-medium truncate min-w-0">{task.title}</div>
                {task.recurrence?.freq && (
                    <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-sky-900/40 border border-sky-800/60 text-sky-200">
                        {recurrenceLabel(task.recurrence.freq)}
                    </span>
                )}
            </div>
            {showDueDate && (
                <div className="text-[11px] text-orange-200/90 mt-0.5">{formatDue(task.dueAt)}</div>
            )}
            {!showDueDate && (
                <div className="text-[11px] text-stone-400 mt-0.5">{formatDue(task.dueAt)}</div>
            )}
            <input
                type="datetime-local"
                value={toLocalInput(task.dueAt)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                    if (e.target.value) void onMoveDue(task.id, new Date(e.target.value).toISOString())
                }}
                className="mt-1 w-full bg-stone-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-stone-200"
            />
            {onUpdateRecurrence && (
                <select
                    value={task.recurrence?.freq || ""}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                        const value = e.target.value as PlannerRecurrence["freq"] | ""
                        void onUpdateRecurrence(task.id, value ? { freq: value } : null)
                    }}
                    className="mt-1 w-full bg-stone-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-stone-200"
                >
                    {RECURRENCE_OPTIONS.map((opt) => (
                        <option key={opt.label} value={opt.value}>{opt.label}</option>
                    ))}
                </select>
            )}
        </div>
    )
}

export default function WeekBoard({ tasks, onMoveDue, onUpdateRecurrence }: Props) {
    const [overDay, setOverDay] = useState<string | null>(null)
    const [moving, setMoving] = useState<string | null>(null)
    const todayKey = localDateKey()

    const days = useMemo(() => {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start.getTime() + i * DAY_MS)
            return {
                key: localDateKey(d),
                label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }),
                isToday: i === 0,
            }
        })
    }, [todayKey])

    const openTasks = tasks.filter((t) => t.status !== "done")
    const byDay = useMemo(() => {
        const map: Record<string, PlannerTask[]> = { overdue: [], unscheduled: [], later: [] }
        for (const day of days) map[day.key] = []
        for (const task of openTasks) {
            const key = dateKeyFromDue(task.dueAt)
            if (!key) map.unscheduled.push(task)
            else if (key < todayKey) map.overdue.push(task)
            else if (map[key]) map[key].push(task)
            else map.later.push(task)
        }
        for (const list of Object.values(map)) {
            list.sort((a, b) => dueMs(a.dueAt) - dueMs(b.dueAt))
        }
        return map
    }, [openTasks, days, todayKey])

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

    const DayColumn = ({ id, title, items }: { id: string; title: string; items: PlannerTask[] }) => (
        <div
            onDragOver={(e) => {
                e.preventDefault()
                setOverDay(id)
            }}
            onDragLeave={() => setOverDay((cur) => (cur === id ? null : cur))}
            onDrop={(e) => onDropDay(id, e)}
            className={`rounded-xl border p-2 min-h-[140px] ${overDay === id ? "border-sky-500 bg-sky-950/30" : "border-zinc-800 bg-stone-950"}`}
        >
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-2">{title}</div>
            <div className="space-y-2">
                {items.map((task) => (
                    <TaskCard
                        key={task.id}
                        task={task}
                        moving={moving === task.id}
                        onMoveDue={onMoveDue}
                        onUpdateRecurrence={onUpdateRecurrence}
                    />
                ))}
                {items.length === 0 && (
                    <div className="text-[11px] text-stone-600 py-4 text-center">Drop a task here</div>
                )}
            </div>
        </div>
    )

    const StaticSection = ({ title, items, showDueDate = false }: { title: string; items: PlannerTask[]; showDueDate?: boolean }) => (
        items.length === 0 ? null : (
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="text-zinc-200 font-medium mb-3">{title}</div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                    {items.map((task) => (
                        <TaskCard
                            key={task.id}
                            task={task}
                            moving={moving === task.id}
                            showDueDate={showDueDate}
                            onMoveDue={onMoveDue}
                            onUpdateRecurrence={onUpdateRecurrence}
                        />
                    ))}
                </div>
            </div>
        )
    )

    return (
        <div className="space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                <div className="flex items-center justify-between mb-3">
                    <div className="text-zinc-200 font-medium">This week</div>
                    <div className="text-[11px] text-stone-500">Drag a task onto another day, or edit the date</div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
                    {days.map((day) => (
                        <DayColumn
                            key={day.key}
                            id={day.key}
                            title={day.isToday ? `Today · ${day.label}` : day.label}
                            items={byDay[day.key] || []}
                        />
                    ))}
                </div>
            </div>

            <StaticSection title="Overdue" items={byDay.overdue} showDueDate />
            <StaticSection title="No date" items={byDay.unscheduled} />
            <StaticSection title="Later" items={byDay.later} showDueDate />
        </div>
    )
}
