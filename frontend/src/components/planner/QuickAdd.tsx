import { useState, useRef } from "react"
import type { PlannerRecurrence } from "../../lib/api"
import { RECURRENCE_OPTIONS } from "./recurrence"
import { dueIsoFromLocalInput } from "./date"

interface QuickAddProps {
    onAdd: (data: { text?: string; files?: File[]; dueAt?: string; recurrence?: PlannerRecurrence | null }) => Promise<void>
    loading: boolean
}

export default function QuickAdd({ onAdd, loading }: QuickAddProps) {
    const [text, setText] = useState("")
    const [dueInput, setDueInput] = useState("")
    const [repeat, setRepeat] = useState<PlannerRecurrence["freq"] | "">("")
    const [selectedFiles, setSelectedFiles] = useState<File[]>([])
    const fileInputRef = useRef<HTMLInputElement>(null)

    const handleSubmit = async () => {
        if (!text.trim() && selectedFiles.length === 0) return
        await onAdd({
            text,
            files: selectedFiles,
            dueAt: dueInput ? dueIsoFromLocalInput(dueInput) : undefined,
            recurrence: repeat ? { freq: repeat } : null,
        })
        setText("")
        setDueInput("")
        setRepeat("")
        setSelectedFiles([])
    }

    const handleFileSelect = (files: FileList | null) => {
        if (!files) return
        const newFiles = Array.from(files).filter(f =>
            f.size <= 10 * 1024 * 1024 &&
            (f.type.includes('pdf') || f.type.includes('image') || f.type.includes('text') || f.type.includes('document'))
        )
        setSelectedFiles(prev => [...prev, ...newFiles])
    }

    const removeFile = (index: number) => {
        setSelectedFiles(prev => prev.filter((_, i) => i !== index))
    }

    return (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
            <div className="text-zinc-200 font-medium mb-3 flex items-center gap-2">
                <span>⚡</span>
                Quick Add
            </div>

            <div className="space-y-3">
                <div className="flex gap-2">
                    <input
                        value={text}
                        onChange={e => setText(e.target.value)}
                        placeholder="e.g. Review Bio notes every Tuesday"
                        className="flex-1 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 placeholder:text-zinc-500 outline-none focus:ring-1 focus:ring-zinc-700"
                        onKeyDown={e => e.key === 'Enter' && !e.shiftKey && handleSubmit()}
                    />
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.doc,.docx,.txt,.png,.jpg,.jpeg"
                        onChange={e => handleFileSelect(e.target.files)}
                        className="hidden"
                    />
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="px-3 py-2 rounded-lg bg-zinc-800 text-zinc-200 border border-zinc-700 hover:bg-zinc-700"
                        title="Upload homework files"
                    >
                        📎
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={loading || (!text.trim() && selectedFiles.length === 0)}
                        className="px-4 py-2 rounded-lg bg-blue-600 text-white disabled:opacity-60 hover:bg-blue-700"
                    >
                        {loading ? "Adding..." : "Add"}
                    </button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="block">
                        <span className="text-[11px] uppercase tracking-wide text-stone-500 mb-1 block">Due date</span>
                        <input
                            type="datetime-local"
                            value={dueInput}
                            onChange={(e) => setDueInput(e.target.value)}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm outline-none focus:ring-1 focus:ring-zinc-700"
                        />
                    </label>
                    <label className="block">
                        <span className="text-[11px] uppercase tracking-wide text-stone-500 mb-1 block">Repeats</span>
                        <select
                            value={repeat}
                            onChange={(e) => setRepeat(e.target.value as PlannerRecurrence["freq"] | "")}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-200 text-sm outline-none focus:ring-1 focus:ring-zinc-700"
                        >
                            {RECURRENCE_OPTIONS.map((opt) => (
                                <option key={opt.label} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </label>
                </div>

                {selectedFiles.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                        {selectedFiles.map((file, i) => (
                            <div key={i} className="flex items-center gap-1 px-2 py-1 bg-zinc-800 rounded text-xs text-zinc-200">
                                <span className="truncate max-w-32" title={file.name}>{file.name}</span>
                                <span className="text-zinc-400">({Math.round(file.size / 1024)}KB)</span>
                                <button
                                    onClick={() => removeFile(i)}
                                    className="text-zinc-400 hover:text-zinc-200 ml-1"
                                >×</button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="flex flex-wrap gap-2">
                    <div className="text-zinc-400 text-xs">Quick templates:</div>
                    <button
                        onClick={() => {
                            setText("Math homework ch 5")
                            setDueInput("")
                            setRepeat("")
                        }}
                        className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    >
                        Math HW
                    </button>
                    <button
                        onClick={() => {
                            setText("Read chapter for English class")
                            setDueInput("")
                            setRepeat("weekly")
                        }}
                        className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    >
                        Reading
                    </button>
                    <button
                        onClick={() => {
                            setText("Review notes")
                            setRepeat("weekly")
                        }}
                        className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                    >
                        Weekly review
                    </button>
                </div>
            </div>
        </div>
    )
}
