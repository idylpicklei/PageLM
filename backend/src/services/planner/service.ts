import { Task, Slot, PlanPolicy, CreateTaskRequest, UpdateTaskRequest, PlannerGenerateRequest, MaterialsRequest } from "./types"
import { createTask, getTask, updateTask, deleteTask, listTasks } from "./store"
import { parseTask, generateSteps, makeSlots, replan, calculateUrgencyScore } from "./ai"
import { nextOccurrence, parseRecurrence } from "./recurrence"
import { planTask, planTasks, weeklyPlan, defaultPolicy } from "./scheduler"
import { handleAsk } from "../../lib/ai/ask"
import crypto from "crypto"

function normalizeDueAt(value: unknown): string | null {
    if (value == null || value === "") return null
    if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString()
    if (typeof value === "string") {
        if (/^\d+$/.test(value)) {
            const n = Number(value)
            if (Number.isFinite(n)) return new Date(n).toISOString()
        }
        const d = new Date(value)
        if (!Number.isNaN(d.getTime())) return d.toISOString()
    }
    return null
}

function shiftSlotsByDueChange(slots: Slot[], fromDue: string, toDue: string): Slot[] {
    const from = new Date(fromDue)
    const to = new Date(toDue)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return slots
    const fromDay = new Date(from.getFullYear(), from.getMonth(), from.getDate()).getTime()
    const toDay = new Date(to.getFullYear(), to.getMonth(), to.getDate()).getTime()
    const delta = toDay - fromDay
    if (!delta) return slots
    return slots.map((s) => ({
        ...s,
        start: new Date(new Date(s.start).getTime() + delta).toISOString(),
        end: new Date(new Date(s.end).getTime() + delta).toISOString(),
    }))
}

function resolveDueAt(value: unknown): string {
    return normalizeDueAt(value) || ""
}

export type UpdateTaskResult = { task: Task; spawned?: Task }

export class PlannerService {
    private policy: PlanPolicy

    constructor(policy?: PlanPolicy) {
        this.policy = policy || defaultPolicy()
    }

    async createTaskFromRequest(req: CreateTaskRequest): Promise<Task> {
        let taskData: Partial<Task>
        const explicitDue = req.dueAt ? normalizeDueAt(req.dueAt) : null
        const recurrence = parseRecurrence(req.recurrence)

        if (req.text) {
            taskData = await parseTask(req.text)

            if (req.course) taskData.course = req.course
            if (req.title) taskData.title = req.title
            if (req.type) taskData.type = req.type
            if (req.notes) taskData.notes = req.notes
            if (explicitDue) taskData.dueAt = explicitDue
            if (req.estMins) taskData.estMins = req.estMins
            if (req.priority) taskData.priority = req.priority
        } else {
            taskData = {
                title: req.title || "Untitled Task",
                course: req.course,
                type: req.type,
                notes: req.notes,
                dueAt: explicitDue || "",
                estMins: req.estMins || 60,
                priority: req.priority || 3
            }
        }

        if (recurrence) taskData.recurrence = recurrence

        const tempTask = { ...taskData, id: 'temp', dueAt: taskData.dueAt || "" } as Task
        const steps = await generateSteps(tempTask)
        taskData.steps = steps

        const task = await createTask({
            title: taskData.title || "Untitled Task",
            course: taskData.course,
            type: taskData.type,
            notes: taskData.notes,
            dueAt: resolveDueAt(taskData.dueAt),
            estMins: taskData.estMins || 60,
            priority: taskData.priority || 3,
            status: 'todo',
            steps: taskData.steps,
            recurrence: taskData.recurrence,
        })

        if (req.files && req.files.length > 0) {
            await this.addFilesToTask(task.id, req.files)
            const updatedTask = await getTask(task.id)
            return updatedTask || task
        }

        return task
    }

    async getTask(id: string): Promise<Task | null> {
        return getTask(id)
    }

    async updateTask(id: string, req: UpdateTaskRequest): Promise<UpdateTaskResult | null> {
        const existing = await getTask(id)
        if (!existing) return null

        const patch: UpdateTaskRequest = { ...req }
        if (patch.recurrence !== undefined) {
            patch.recurrence = parseRecurrence(patch.recurrence) ?? undefined
        }
        if (patch.dueAt != null) {
            const iso = normalizeDueAt(patch.dueAt)
            if (!iso) {
                patch.dueAt = ""
            } else {
                if (existing.plan?.slots?.length && existing.dueAt) {
                    patch.plan = {
                        ...existing.plan,
                        slots: shiftSlotsByDueChange(existing.plan.slots, existing.dueAt, iso),
                    }
                }
                patch.dueAt = iso
            }
        }

        let steps = existing.steps
        if (patch.title || patch.type || patch.notes) {
            const updatedTask = { ...existing, ...patch }
            steps = await generateSteps(updatedTask)
        }

        const becomingDone = patch.status === "done" && existing.status !== "done"
        const savedRecurrence = existing.recurrence

        if (becomingDone && savedRecurrence) {
            const donePatch = { ...patch, steps, recurrence: undefined }
            const task = await updateTask(id, donePatch)
            if (!task) return null

            const spawned = await createTask({
                title: existing.title,
                course: existing.course,
                type: existing.type,
                notes: existing.notes,
                dueAt: nextOccurrence(existing.dueAt, savedRecurrence.freq),
                estMins: existing.estMins,
                priority: existing.priority,
                status: "todo",
                steps: existing.steps,
                tags: existing.tags,
                recurrence: savedRecurrence,
            })

            return { task, spawned }
        }

        const task = await updateTask(id, { ...patch, steps })
        return task ? { task } : null
    }

    async deleteTask(id: string): Promise<boolean> {
        return deleteTask(id)
    }

    async listTasks(filter?: { status?: string; dueBefore?: string; course?: string }): Promise<Task[]> {
        return listTasks(filter)
    }

    async planSingleTask(taskId: string): Promise<Task | null> {
        const task = await getTask(taskId)
        if (!task) return null

        const plannedTask = planTask(task, this.policy)
        await updateTask(taskId, { plan: plannedTask.plan })

        return plannedTask
    }

    async generateWeeklyPlan(req?: PlannerGenerateRequest): Promise<{ tasks: Task[]; plan: any }> {
        const policy = { ...this.policy, ...req?.policy }

        const tasks = await listTasks({ status: 'todo' })

        const plannedTasks = planTasks(tasks, policy)

        for (const task of plannedTasks) {
            await updateTask(task.id, { plan: task.plan })
        }

        const plan = weeklyPlan(plannedTasks, policy)

        return { tasks: plannedTasks, plan }
    }

    async getWeeklyPlan(): Promise<{ tasks: Task[]; plan: any }> {
        const tasks = (await listTasks()).filter((t) => t.status !== "done")
        return { tasks, plan: weeklyPlan(tasks, this.policy) }
    }

    async getTodaySessions(): Promise<{ task: Task; slots: Slot[] }[]> {
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000)

        const tasks = await listTasks({ status: 'todo' })
        const todaySessions: { task: Task; slots: Slot[] }[] = []

        for (const task of tasks) {
            if (!task.plan?.slots) continue

            const todaySlots = task.plan.slots.filter(slot => {
                const slotDate = new Date(slot.start)
                return slotDate >= today && slotDate < tomorrow
            })

            if (todaySlots.length > 0) {
                todaySessions.push({ task, slots: todaySlots })
            }
        }

        return todaySessions.sort((a, b) => {
            const aStart = new Date(a.slots[0].start).getTime()
            const bStart = new Date(b.slots[0].start).getTime()
            return aStart - bStart
        })
    }

    async updateSlot(taskId: string, slotId: string, updates: { done?: boolean; skip?: boolean }): Promise<Task | null> {
        const task = await getTask(taskId)
        if (!task?.plan?.slots) return null

        const slotIndex = task.plan.slots.findIndex(s => s.id === slotId)
        if (slotIndex === -1) return null

        const updatedSlots = [...task.plan.slots]
        updatedSlots[slotIndex] = {
            ...updatedSlots[slotIndex],
            done: updates.done
        }

        if (updates.skip) {
            await this.replanTask(taskId)
            return getTask(taskId)
        }

        const updatedPlan = { ...task.plan, slots: updatedSlots }
        return updateTask(taskId, { plan: updatedPlan })
    }

    async replanTask(taskId: string): Promise<Task | null> {
        const task = await getTask(taskId)
        if (!task?.plan) return null

        const now = new Date()
        const missedSlots = task.plan.slots.filter(s => new Date(s.end) < now && !s.done)
        const remainingSlots = task.plan.slots.filter(s => new Date(s.start) >= now)

        const allTasks = await listTasks({ status: 'todo' })

        const newSlots = replan(missedSlots, remainingSlots, allTasks, task.plan.policy)
        const taskSlots = newSlots.filter(s => s.taskId === taskId)

        const updatedPlan = {
            ...task.plan,
            slots: taskSlots,
            lastPlannedAt: new Date().toISOString()
        }

        return updateTask(taskId, { plan: updatedPlan })
    }

    async generateMaterials(taskId: string, req: MaterialsRequest): Promise<any> {
        const task = await getTask(taskId)
        if (!task) throw new Error('Task not found')

        const content = `${task.title}\n${task.notes || ''}\nSteps: ${task.steps?.join(', ') || ''}`

        switch (req.type) {
            case 'summary':
                return this.generateSummary(content)
            case 'studyGuide':
                return this.generateStudyGuide(content, task)
            case 'flashcards':
                return this.generateFlashcards(content, task)
            case 'quiz':
                return this.generateQuiz(content, task)
            default:
                throw new Error('Invalid material type')
        }
    }

    private async generateSummary(content: string): Promise<string> {
        const prompt = `Create a clear, concise summary of this study material that highlights the key concepts and important points:`
        const response = await handleAsk(prompt + '\n\n' + content)
        return response.answer
    }

    private async generateStudyGuide(content: string, task: Task): Promise<string> {
        const prompt = `Create a comprehensive study guide for this ${task.type || 'assignment'}. Include:
        - Key concepts and definitions
        - Important formulas or principles
        - Practice questions
        - Study tips specific to this topic

        Format as a structured guide with clear sections:`

        const response = await handleAsk(prompt + '\n\n' + content)
        return response.answer
    }

    private async generateFlashcards(content: string, task: Task): Promise<Array<{ front: string; back: string }>> {
        const prompt = `Create 10-15 flashcards for this ${task.type || 'assignment'}. 
        Return as JSON array with "front" and "back" properties.
        Focus on key concepts, definitions, formulas, and important facts.
        
        Example format:
        [
          {"front": "What is the derivative of x^2?", "back": "2x"},
          {"front": "Define photosynthesis", "back": "The process by which plants convert light energy into chemical energy"}
        ]`

        try {
            const response = await handleAsk(prompt + '\n\n' + content)
            return JSON.parse(response.answer)
        } catch (error) {
            console.warn('Failed to parse flashcards JSON, returning default')
            return [
                { front: `Key concept from ${task.title}`, back: 'Review the main material' }
            ]
        }
    }

    private async generateQuiz(content: string, task: Task): Promise<any> {
        const prompt = `Create a 5-question quiz for this ${task.type || 'assignment'}.
        Include multiple choice and short answer questions.
        Focus on testing understanding of key concepts.`

        const response = await handleAsk(prompt + '\n\n' + content)
        return response.answer
    }

    async getUpcomingDeadlines(): Promise<{ urgent: Task[]; atRisk: Task[]; upcoming: Task[] }> {
        const tasks = await listTasks({ status: 'todo' })
        const now = new Date()

        const urgent: Task[] = []
        const atRisk: Task[] = []
        const upcoming: Task[] = []

        for (const task of tasks) {
            const deadline = Date.parse(String(task.dueAt || ""))
            if (!Number.isFinite(deadline)) continue
            const hoursToDeadline = (deadline - now.getTime()) / (1000 * 60 * 60)

            const hasScheduledWork = task.plan?.slots?.some(s => new Date(s.start) >= now)

            if (hoursToDeadline < 24) {
                urgent.push(task)
            } else if (hoursToDeadline < 72 && !hasScheduledWork) {
                atRisk.push(task)
            } else if (hoursToDeadline < 168) {
                upcoming.push(task)
            }
        }

        return { urgent, atRisk, upcoming }
    }

    async getUserStats(): Promise<any> {
        const allTasks = await listTasks()
        const completedTasks = allTasks.filter(t => t.status === 'done')

        const totalPlannedMinutes = allTasks.reduce((sum, task) => {
            return sum + (task.plan?.slots?.length || 0) * this.policy.pomodoroMins
        }, 0)

        const completedMinutes = completedTasks.reduce((sum, task) => {
            const completedSlots = task.plan?.slots?.filter(s => s.done) || []
            return sum + completedSlots.length * this.policy.pomodoroMins
        }, 0)

        const onTimeCompletions = completedTasks.filter(task => {
            return new Date(task.updatedAt) <= new Date(task.dueAt)
        }).length

        return {
            totalTasks: allTasks.length,
            completedTasks: completedTasks.length,
            totalPlannedMinutes,
            completedMinutes,
            onTimeRatio: completedTasks.length > 0 ? onTimeCompletions / completedTasks.length : 0,
            averageEstimateAccuracy: this.calculateEstimateAccuracy(completedTasks)
        }
    }

    async addFilesToTask(taskId: string, files: any[]): Promise<any[]> {
        const task = await getTask(taskId)
        if (!task) throw new Error("Task not found")

        const { saveTaskFile } = await import("./store")
        const uploadedFiles: any[] = []

        for (const file of files) {
            const taskFile = {
                id: crypto.randomUUID(),
                taskId,
                filename: file.filename,
                originalName: file.filename,
                mimeType: file.mimeType,
                size: require('fs').statSync(file.path).size,
                uploadedAt: new Date().toISOString()
            }

            await saveTaskFile(taskFile)
            uploadedFiles.push(taskFile)
        }

        return uploadedFiles
    }

    async removeFileFromTask(taskId: string, fileId: string): Promise<boolean> {
        const task = await getTask(taskId)
        if (!task) return false

        const { deleteTaskFile } = await import("./store")
        try {
            await deleteTaskFile(fileId)
            return true
        } catch {
            return false
        }
    }

    private calculateEstimateAccuracy(completedTasks: Task[]): number {
        if (completedTasks.length === 0) return 1.0

        let totalAccuracy = 0
        let validTasks = 0

        for (const task of completedTasks) {
            if (task.metrics?.minutesSpent && task.estMins > 0) {
                const accuracy = Math.min(task.estMins / task.metrics.minutesSpent, 2)
                totalAccuracy += accuracy
                validTasks++
            }
        }

        return validTasks > 0 ? totalAccuracy / validTasks : 1.0
    }
}

export const plannerService = new PlannerService()