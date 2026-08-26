import fs from 'fs'
import path from 'path'
import mammoth from 'mammoth'
import pdf from 'pdf-parse'
import Busboy from 'busboy'
import { marked } from 'marked'
import { embedTextFromFile } from '../ai/embed'
import { listLibraryFiles } from '../../utils/library/files'
import { hydrateAnyKey, hydrateStoragePath, resolveStorage, storageRel, wrapStorageWriteStream, writeStorageSync } from '../../utils/storage/store'

export type UpFile = { path: string; filename: string; mimeType: string }

function sanitizeUploadName(filename: string): string {
  const base = path.basename(String(filename || 'file')).replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_').trim()
  return base.slice(0, 180) || 'file'
}

function openUploadWrite(filename: string): { path: string; filename: string; stream: ReturnType<typeof wrapStorageWriteStream> } {
  const safe = sanitizeUploadName(filename)
  const rel = `uploads/${Date.now()}-${safe}`
  const fp = resolveStorage(rel)
  return { path: fp, filename: safe, stream: wrapStorageWriteStream(rel) }
}

function parseFileIds(raw: string): string[] {
  const text = String(raw || '').trim()
  if (!text) return []
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed.map((id) => String(id || '').trim()).filter(Boolean)
  } catch { /* comma-separated */ }
  return text.split(',').map((id) => id.trim()).filter(Boolean)
}

export function parseMultipart(req: any): Promise<{ q: string; chatId?: string; length?: string; dueAt?: string; recurrence?: string; files: UpFile[]; fileIds: string[] }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers })
    let q = ''
    let chatId = ''
    let length = ''
    let dueAt = ''
    let recurrence = ''
    let fileIds: string[] = []
    const files: UpFile[] = []
    let pending = 0
    let ended = false
    let failed = false
    const done = () => { if (!failed && ended && pending === 0) resolve({ q, chatId: chatId || undefined, length: length || undefined, dueAt: dueAt || undefined, recurrence: recurrence || undefined, files, fileIds }) }

    bb.on('field', (n, v) => {
      if (n === 'q') q = v
      if (n === 'chatId') chatId = v
      if (n === 'length') length = v
      if (n === 'dueAt') dueAt = v
      if (n === 'recurrence') recurrence = v
      if (n === 'fileIds' || n === 'fileId') fileIds = [...fileIds, ...parseFileIds(v)]
    })
    bb.on('file', (_n, file, info: any) => {
      pending++
      const originalName = info?.filename || 'file'
      const mimeType = info?.mimeType || info?.mime || 'application/octet-stream'
      const { path: fp, filename, stream: ws } = openUploadWrite(originalName)
      file.on('error', e => { failed = true; reject(e) })
      ws.on('error', e => { failed = true; reject(e) })
      ws.on('finish', () => {
        Promise.resolve(ws.uploaded).catch(() => {}).finally(() => {
          files.push({ path: fp, filename, mimeType });
          pending--;
          done();
        });
      })
      file.pipe(ws)
    })
    bb.on('error', e => { failed = true; reject(e) })
    bb.on('finish', () => { ended = true; done() })
    req.pipe(bb)
  })
}

export function parseImportMultipart(req: any): Promise<{ chatId?: string; title?: string; files: UpFile[] }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers })
    let chatId = ''
    let title = ''
    const files: UpFile[] = []
    let pending = 0
    let ended = false
    let failed = false
    const done = () => {
      if (!failed && ended && pending === 0) {
        resolve({
          chatId: chatId || undefined,
          title: title || undefined,
          files,
        })
      }
    }

    bb.on('field', (n, v) => {
      if (n === 'chatId') chatId = v
      if (n === 'title') title = v
    })
    bb.on('file', (_n, file, info: any) => {
      pending++
      const originalName = info?.filename || 'file'
      const mimeType = info?.mimeType || info?.mime || 'application/octet-stream'
      const { path: fp, filename, stream: ws } = openUploadWrite(originalName)
      file.on('error', e => { failed = true; reject(e) })
      ws.on('error', e => { failed = true; reject(e) })
      ws.on('finish', () => {
        Promise.resolve(ws.uploaded).catch(() => {}).finally(() => {
          files.push({ path: fp, filename, mimeType });
          pending--;
          done();
        });
      })
      file.pipe(ws)
    })
    bb.on('error', e => { failed = true; reject(e) })
    bb.on('finish', () => { ended = true; done() })
    req.pipe(bb)
  })
}

export async function resolveLibrarySource(fileId: string): Promise<UpFile | null> {
  const wanted = decodeURIComponent(String(fileId || '')).replace(/\\/g, '/').replace(/^\/+/, '')
  if (!wanted || wanted.includes('..')) return null
  const files = await listLibraryFiles()
  const match = files.find((f) => f.id === wanted || f.id.endsWith(`/${wanted}`) || f.filename === wanted)
  const id = match?.id || wanted
  const filename = match?.filename || path.basename(id).replace(/^\d+-/, '') || 'file'
  const mimeType = match?.mimeType || ''
  const candidates = Array.from(new Set([
    id,
    `uploads/${path.basename(id)}`,
    id.startsWith('uploads/') ? id : `uploads/${id}`,
  ]))
  for (const rel of candidates) {
    const found = await hydrateAnyKey(rel)
    if (found) return { path: found, filename, mimeType }
  }
  return null
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function handleUpload(a: { filePath: string; filename?: string; contentType?: string; namespace?: string }): Promise<{ stored: string }> {
  const fp = a.filePath
  const mime = a.contentType || ''
  const ns = a.namespace || 'pagelm'
  await hydrateStoragePath(fp)
  if (!fs.existsSync(fp)) throw new Error(`Uploaded file was not found on disk: ${path.basename(fp)}`)
  const sidecar = `${fp}.txt`
  await hydrateStoragePath(sidecar)
  let txt = ''
  if (fs.existsSync(sidecar)) {
    try { txt = fs.readFileSync(sidecar, 'utf8') } catch { txt = '' }
  }
  if (!txt.trim()) {
    txt = await withTimeout(extractText(fp, mime), 30_000, 'file extract')
    if (!txt?.trim()) throw new Error('No valid content extracted from file.')
    writeStorageSync(storageRel(sidecar), txt)
  }
  await embedTextFromFile(sidecar, ns)
  return { stored: sidecar }
}

async function extractText(filePath: string, mime: string) {
  const raw = fs.readFileSync(filePath)
  const lowerPath = filePath.toLowerCase()
  const effectiveMime =
    mime.includes('pdf') || lowerPath.endsWith('.pdf') ? 'application/pdf'
    : mime.includes('markdown') || lowerPath.endsWith('.md') || lowerPath.endsWith('.markdown') ? 'text/markdown'
    : mime.includes('plain') || lowerPath.endsWith('.txt') ? 'text/plain'
    : mime.includes('wordprocessingml') || mime.includes('msword') || mime.includes('vnd.oasis.opendocument.text')
      || lowerPath.endsWith('.doc') || lowerPath.endsWith('.docx') || lowerPath.endsWith('.odt') ? 'application/word'
    : mime

  if (effectiveMime.includes('pdf')) {
    const data = await pdf(raw)
    return data.text
  }
  if (effectiveMime.includes('markdown')) {
    return marked.parse(raw.toString())
  }
  if (effectiveMime.includes('plain')) {
    return raw.toString()
  }
  if (effectiveMime.includes('word') || effectiveMime.includes('wordprocessingml') || effectiveMime.includes('msword') || effectiveMime.includes('vnd.oasis.opendocument.text')) {
    const r = await mammoth.extractRawText({ buffer: raw })
    return r.value
  }
  throw new Error('unsupported file type')
}
