import { useMemo, useState, type DragEvent } from "react"
import { type PlannerTask } from "../../lib/api"
import { dateKeyFromDue, dueMs, formatDue, localDateKey, toLocalInput } from "./date"

type Props = {
    tasks: PlannerTask[]
    onMoveDue: (id: string, dueAt: string) => Promise<void> | void
}

const DAY_MS = 24 * 60 * 60 * 1000

export default function WeekBoard({ tasks, onMoveDue }: Props) {
    const [overDay, setOverDay] = useState<string | null>(null)
    const [moving, setMoving] = useState<string | null>(null)

    const days = useMemo(() => {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start.getTime() + i * DAY_MS)
            return { key: localDateKey(d), label: d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }), isToday: i === 0 }
        })
    }, [])

    const openTasks = tasks.filter((t) => t.status !== "done")
    const byDay = useMemo(() => {
        const map: Record<string, PlannerTask[]> = { overdue: [], unscheduled: [], later: [] }
        for (const day of days) map[day.key] = []
        const today = localDateKey()
        for (const task of openTasks) {
            const key = dateKeyFromDue(task.dueAt)
            if (!key) map.unscheduled.push(task)
            else if (key < today) map.overdue.push(task)
            else if (map[key]) map[key].push(task)
            else map.later.push(task)
        }
        return map
    }, [openTasks, days])

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

    const Card = ({ task }: { task: PlannerTask }) => (
        <div
            draggable
            onDragStart={(e) => {
                e.dataTransfer.setData("text/task-id", task.id)
                e.dataTransfer.effectAllowed = "move"
            }}
            className={`rounded-lg border border-zinc-800 bg-stone-900 px-2.5 py-2 cursor-grab active:cursor-grabbing ${moving === task.id ? "opacity-50" : ""}`}
            title="Drag to another day"
        >
            <div className="text-stone-100 text-sm font-medium truncate">{task.title}</div>
            <div className="text-[11px] text-stone-400 mt-0.5">{formatDue(task.dueAt)}</div>
            <input
                type="datetime-local"
                value={toLocalInput(task.dueAt)}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => {
                    if (e.target.value) void onMoveDue(task.id, new Date(e.target.value).toISOString())
                }}
                className="mt-1 w-full bg-stone-950 border border-zinc-800 rounded px-1 py-0.5 text-[11px] text-stone-200"
            />
        </div>
    )

    const Column = ({ id, title, items, droppable = true }: { id: string; title: string; items: PlannerTask[]; droppable?: boolean }) => (
        <div
            onDragOver={(e) => {
                if (!droppable) return
                e.preventDefault()
                setOverDay(id)
            }}
            onDragLeave={() => setOverDay((cur) => (cur === id ? null : cur))}
            onDrop={(e) => droppable && onDropDay(id, e)}
            className={`rounded-xl border p-2 min-h-[140px] ${overDay === id ? "border-sky-500 bg-sky-950/30" : "border-zinc-800 bg-stone-950"}`}
        >
            <div className="text-[11px] uppercase tracking-wide text-stone-400 mb-2">{title}</div>
            <div className="space-y-2">
                {items.map((task) => <Card key={task.id} task={task} />)}
                {items.length === 0 && (
                    <div className="text-[11px] text-stone-600 py-4 text-center">{droppable ? "Drop a task here" : "None"}</div>
                )}
            </div>
        </div>
    )

    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="flex items-center justify-between mb-3">
                <div className="text-zinc-200 font-medium">This week</div>
                <div className="text-[11px] text-stone-500">Drag a task onto another day, or edit the date</div>
            </div>
            {(byDay.overdue.length > 0 || byDay.unscheduled.length > 0 || byDay.later.length > 0) && (
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                    {byDay.overdue.length > 0 && <Column id="overdue" title="Overdue" items={byDay.overdue} droppable={false} />}
                    {byDay.unscheduled.length > 0 && <Column id="unscheduled" title="No date" items={byDay.unscheduled} droppable={false} />}
                    {byDay.later.length > 0 && <Column id="later" title="Later" items={byDay.later} droppable={false} />}
                </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
                {days.map((day) => (
                    <Column
                        key={day.key}
                        id={day.key}
                        title={day.isToday ? `Today · ${day.label}` : day.label}
                        items={byDay[day.key] || []}
                    />
                ))}
            </div>
        </div>
    )
}
