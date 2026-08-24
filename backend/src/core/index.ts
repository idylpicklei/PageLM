import cors from 'cors';
import path from 'path'
import fs from 'fs'
import server from '../utils/server/server'
import { registerRoutes } from './router'
import { loggerMiddleware } from './middleware'
import { ensureStorageDirs, hydrateAllFromR2, isCloudStorage, hydrateStoragePath, storageRoot } from '../utils/storage/store'

try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'))
} catch {
  // Cloudflare Containers inject env vars directly
}

const app = server()

app.get('/health', (_req: any, res: any) => {
  res.json({ ok: true, storage: process.env.STORAGE_BACKEND || 'local' })
})

app.use(loggerMiddleware)
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.options('*', cors());

if (isCloudStorage()) {
  app.use((req: any, res: any, next: any) => {
    if (!req.path?.startsWith('/storage/')) return next()
    const rel = req.path.replace(/^\/storage\//, '')
    if (!rel) return next()
    hydrateStoragePath(path.join(storageRoot(), rel))
      .catch((err) => console.error('[storage] hydrate middleware error:', err))
      .finally(() => next())
  })
}

app.use(app.serverStatic("/storage", "./storage"))

registerRoutes(app)

async function start() {
  ensureStorageDirs()
  if (isCloudStorage()) {
    await hydrateAllFromR2()
  } else {
    fs.mkdirSync(storageRoot(), { recursive: true })
  }

  const host = process.env.HOST || '0.0.0.0'
  const port = Number.parseInt(process.env.PORT || '5000')
  app.listen(port, host, () => {
    console.log(`[pagelm] running on ${host}:${port} (${process.env.STORAGE_BACKEND || 'local'} storage)`)
  })
}

start().catch((err) => {
  console.error('[pagelm] failed to start:', err)
  process.exit(1)
})
