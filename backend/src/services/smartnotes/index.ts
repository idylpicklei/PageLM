import fs from "fs"
import path from "path"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import fontkit from "@pdf-lib/fontkit"
import llm from "../../utils/llm/llm"
import { normalizeTopic } from "../../utils/text/normalize"
import { resolveStorage, storageRel, writeStorage } from "../../utils/storage/store"

export type SmartNotesOptions = { topic?: any; notes?: string; filePath?: string }
export type SmartNotesResult = { ok: boolean; file: string }

function sanitizeText(s: string) {
  if (!s) return ""
  return s
    .replace(/\u2192/g, "->")
    .replace(/\u00b2/g, "^2")
    .replace(/\u00b3/g, "^3")
    .replace(/[^\x00-\x7F]/g, "")
}

function wrap(s: string, max = 90) {
  return s
    .split("\n")
    .map(line => {
      const out: string[] = []
      let cur = ""
      for (const w of line.split(/\s+/)) {
        if ((cur + " " + w).trim().length > max) {
          out.push(cur)
          cur = w
        } else {
          cur = (cur ? cur + " " : "") + w
        }
      }
      if (cur) out.push(cur)
      return out.join("\n")
    })
    .join("\n")
}

async function readInput(opts: SmartNotesOptions) {
  if (opts.notes) return opts.notes
  if (opts.filePath) return await fs.promises.readFile(opts.filePath, "utf8")
  if (opts.topic) return `Generate detailed Cornell notes on: ${normalizeTopic(opts.topic)}`
  throw new Error("No input")
}

function extractFirstJsonObject(s: string) {
  let depth = 0, start = -1
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === "{") { if (depth === 0) start = i; depth++ }
    else if (ch === "}") { depth--; if (depth === 0 && start !== -1) return s.slice(start, i + 1) }
  }
  return ""
}

function safeParse<T = any>(raw: string): T | null {
  try { return JSON.parse(raw) as T } catch { return null }
}

async function generateNotes(text: string) {
  const prompt = `
ROLE
You are a note generator producing Cornell-style notes.

OBJECTIVE
Generate maximum detailed study notes from the input.

OUTPUT
Return ONLY a valid JSON object, no markdown, no prose.

SCHEMA
{
  "title": string,
  "notes": string,
  "summary": string,
  "questions": string[],
  "answers": string[]
}

RULES
- Do not wrap with code fences.
- Do not add commentary.
- Use plain text only.
- If a field has no content, return "" or [].
- For each question, the corresponding answer must be in the same index in answers.
`.trim()

  const r1 = await llm.invoke([{ role: "user", content: prompt + "\n\nINPUT:\n" + text }] as any)
  const raw1 = typeof r1 === "string" ? r1 : String((r1 as any)?.content ?? "")
  const parsed1 = safeParse<any>(extractFirstJsonObject(raw1) || raw1)
  if (parsed1 && typeof parsed1 === "object") return parsed1

  const retrySys = `Return only a JSON object matching the schema. No markdown. No extra text.`
  const r2 = await llm.invoke([
    { role: "system", content: retrySys },
    { role: "user", content: prompt + "\n\nINPUT:\n" + text }
  ] as any)
  const raw2 = typeof r2 === "string" ? r2 : String((r2 as any)?.content ?? "")
  const parsed2 = safeParse<any>(extractFirstJsonObject(raw2) || raw2)
  if (parsed2 && typeof parsed2 === "object") return parsed2

  const fallback = {
    title: "Notes",
    notes: sanitizeText(text).slice(0, 4000),
    summary: "",
    questions: [],
    answers: []
  }
  return fallback
}

async function fillTemplateFormPDF(data: any) {
  const dir = path.join(process.cwd(), "assets", "smartnotes")
  const hasDir = fs.existsSync(dir)
  if (!hasDir) return null
  const files = (await fs.promises.readdir(dir)).filter(f => f.endsWith(".pdf"))
  if (!files.length) return null

  const chosen = files[Math.floor(Math.random() * files.length)]
  const pdfBytes = await fs.promises.readFile(path.join(dir, chosen))
  const pdfDoc = await PDFDocument.load(pdfBytes)
  pdfDoc.registerFontkit(fontkit)

  const form = pdfDoc.getForm()
  let appearanceFont: any = null
  try {
    const fontPath = path.join(process.cwd(), "assets", "fonts", "Lexend.ttf")
    if (fs.existsSync(fontPath)) {
      const fontBytes = await fs.promises.readFile(fontPath)
      appearanceFont = await pdfDoc.embedFont(fontBytes, { subset: true })
    }
  } catch { }

  try { form.getTextField("topic").setText(sanitizeText(data.title || "")) } catch { }
  try { form.getTextField("notes").setText(wrap(sanitizeText(data.notes || ""))) } catch { }
  try { form.getTextField("summary").setText(wrap(sanitizeText(data.summary || ""))) } catch { }
  try {
    const qna = (data.questions || [])
      .map((q: string, i: number) => {
        const a = data.answers && data.answers[i] ? `\nAnswer: ${data.answers[i]}` : ""
        return `• ${q}${a}`
      })
      .join("\n\n")
    form.getTextField("questions").setText(sanitizeText(qna))
  } catch { }

  try {
    if (appearanceFont) form.updateFieldAppearances(appearanceFont)
    else form.updateFieldAppearances()
  } catch { }
  try { form.flatten() } catch { }

  const outDir = resolveStorage("smartnotes")
  await fs.promises.mkdir(outDir, { recursive: true })
  const safeTitle = sanitizeText(data.title || "notes").replace(/[^a-z0-9]/gi, "_").slice(0, 50)
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = path.join(outDir, `${safeTitle || "notes"}_${ts}.pdf`)
  const outBytes = await pdfDoc.save()
  await writeStorage(storageRel(outPath), Buffer.from(outBytes))
  return outPath
}

function wrapToWidth(text: string, font: { widthOfTextAtSize: (t: string, s: number) => number }, size: number, maxWidth: number) {
  const lines: string[] = []
  for (const paragraph of sanitizeText(text).split(/\r?\n/)) {
    if (!paragraph.trim()) {
      lines.push("")
      continue
    }
    let cur = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = cur ? `${cur} ${word}` : word
      if (font.widthOfTextAtSize(next, size) <= maxWidth) {
        cur = next
        continue
      }
      if (cur) lines.push(cur)
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        cur = word
        continue
      }
      let chunk = ""
      for (const ch of word) {
        const trial = chunk + ch
        if (font.widthOfTextAtSize(trial, size) > maxWidth && chunk) {
          lines.push(chunk)
          chunk = ch
        } else {
          chunk = trial
        }
      }
      cur = chunk
    }
    if (cur) lines.push(cur)
  }
  return lines
}

async function createSimplePDF(data: any) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedStandardFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedStandardFont(StandardFonts.HelveticaBold)

  const pageSize: [number, number] = [612, 792]
  const margin = 48
  const title = sanitizeText(data.title || "Notes")
  const bodySize = 11
  const headingSize = 14
  const lineGap = 16

  let page = pdfDoc.addPage(pageSize)
  let y = page.getHeight() - margin
  const maxWidth = page.getWidth() - margin * 2

  const newPage = () => {
    page = pdfDoc.addPage(pageSize)
    y = page.getHeight() - margin
    page.drawText(title, { x: margin, y, size: 12, font: bold, color: rgb(0.2, 0.2, 0.2) })
    y -= 22
  }

  const ensureSpace = (needed: number) => {
    if (y < margin + needed) newPage()
  }

  const drawLines = (lines: string[], size: number, usedFont = font) => {
    for (const line of lines) {
      ensureSpace(lineGap)
      if (line) {
        page.drawText(line, { x: margin, y, size, font: usedFont, color: rgb(0.1, 0.1, 0.1) })
      }
      y -= lineGap
    }
  }

  page.drawText(title, { x: margin, y, size: 20, font: bold, color: rgb(0, 0, 0) })
  y -= 32

  const sections = [
    { h: "Notes", t: sanitizeText(data.notes || "") },
    { h: "Summary", t: sanitizeText(data.summary || "") },
    {
      h: "Questions",
      t: (data.questions || [])
        .map((q: string, i: number) => {
          const a = data.answers && data.answers[i] ? `\nAnswer: ${data.answers[i]}` : ""
          return `• ${q}${a}`
        })
        .join("\n\n")
    }
  ]

  for (const sec of sections) {
    if (!sec.t) continue
    ensureSpace(lineGap * 2)
    page.drawText(sec.h, { x: margin, y, size: headingSize, font: bold, color: rgb(0, 0, 0) })
    y -= 20
    drawLines(wrapToWidth(sec.t, font, bodySize, maxWidth), bodySize)
    y -= 10
  }

  const outDir = resolveStorage("smartnotes")
  await fs.promises.mkdir(outDir, { recursive: true })
  const safeTitle = sanitizeText(data.title || "notes").replace(/[^a-z0-9]/gi, "_").slice(0, 50)
  const ts = new Date().toISOString().replace(/[:.]/g, "-")
  const outPath = path.join(outDir, `${safeTitle || "notes"}_${ts}.pdf`)
  const outBytes = await pdfDoc.save()
  await writeStorage(storageRel(outPath), Buffer.from(outBytes))
  return outPath
}

export async function handleSmartNotes(opts: SmartNotesOptions): Promise<SmartNotesResult> {
  const input = await readInput(opts)
  const data = await generateNotes(input)

  const filled = await fillTemplateFormPDF(data)
  if (filled) return { ok: true, file: filled }

  const simple = await createSimplePDF(data)
  return { ok: true, file: simple }
}
