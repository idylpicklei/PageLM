import fs from 'fs'
import path from 'path'
import mammoth from 'mammoth'
import pdf from 'pdf-parse'
import Busboy from 'busboy'
import { marked } from 'marked'
import { embedTextFromFile } from '../ai/embed'
import { OllamaEmbeddings } from '@langchain/ollama'
import { OpenAIEmbeddings } from '@langchain/openai'
import { hydrateStoragePath, resolveStorage, storageRel, wrapStorageWriteStream, writeStorageSync } from '../../utils/storage/store'

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

export function parseMultipart(req: any): Promise<{ q: string; chatId?: string; length?: string; files: UpFile[] }> {
  return new Promise((resolve, reject) => {
    const bb = Busboy({ headers: req.headers })
    let q = ''
    let chatId = ''
    let length = ''
    const files: UpFile[] = []
    let pending = 0
    let ended = false
    let failed = false
    const done = () => { if (!failed && ended && pending === 0) resolve({ q, chatId: chatId || undefined, length: length || undefined, files }) }

    bb.on('field', (n, v) => {
      if (n === 'q') q = v
      if (n === 'chatId') chatId = v
      if (n === 'length') length = v
    })
    bb.on('file', (_n, file, info: any) => {
      pending++
      const originalName = info?.filename || 'file'
      const mimeType = info?.mimeType || info?.mime || 'application/octet-stream'
      const { path: fp, filename, stream: ws } = openUploadWrite(originalName)
      file.on('error', e => { failed = true; reject(e) })
      ws.on('error', e => { failed = true; reject(e) })
      ws.on('finish', () => { files.push({ path: fp, filename, mimeType }); pending--; done() })
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
      ws.on('finish', () => { files.push({ path: fp, filename, mimeType }); pending--; done() })
      file.pipe(ws)
    })
    bb.on('error', e => { failed = true; reject(e) })
    bb.on('finish', () => { ended = true; done() })
    req.pipe(bb)
  })
}

export async function handleUpload(a: { filePath: string; filename?: string; contentType?: string; namespace?: string }): Promise<{ stored: string }> {
  const fp = a.filePath
  const mime = a.contentType || ''
  const ns = a.namespace || 'pagelm'
  await hydrateStoragePath(fp)
  if (!fs.existsSync(fp)) throw new Error(`Uploaded file was not found on disk: ${path.basename(fp)}`)
  const txt = await extractText(fp, mime)
  if (!txt?.trim()) throw new Error('No valid content extracted from file.')
  const out = `${fp}.txt`
  writeStorageSync(storageRel(out), txt)
  const isO = process.env.LLM_PROVIDER === 'ollama'
  const _emb = isO
    ? new OllamaEmbeddings({ model: process.env.OLLAMA_MODEL || 'llama3' })
    : new OpenAIEmbeddings({ model: 'text-embedding-3-small', openAIApiKey: process.env.OPENROUTER_API_KEY, configuration: { baseURL: 'https://openrouter.ai/api/v1' } })
  await embedTextFromFile(out, ns)
  return { stored: out }
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
