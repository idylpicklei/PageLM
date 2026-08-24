import cors from 'cors';
import path from 'path'
import fs from 'fs'
import server from '../utils/server/server'
import { registerRoutes } from './router'
import { loggerMiddleware, authMiddleware } from './middleware'
import { bindUserFromRequest } from '../utils/user-context'
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
app.use(authMiddleware)
app.use(cors({
  origin: "*",
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-User-Id', 'X-User-Email'],
  credentials: true,
}));
app.options('*', cors());

const origWs = (app as any).ws.bind(app);
(app as any).ws = (path: string, handler: (ws: any, req: any) => void) => {
  origWs(path, (ws: any, req: any) => {
    if (!bindUserFromRequest(req)) {
      try { ws.close(4401, "unauthorized"); } catch { /* ignore */ }
      return;
    }
    handler(ws, req);
  });
};

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
  if (!isCloudStorage()) {
    fs.mkdirSync(storageRoot(), { recursive: true })
  }

  const host = process.env.HOST || '0.0.0.0'
  const port = Number.parseInt(process.env.PORT || '5000')
  app.listen(port, host, () => {
    console.log(`[pagelm] running on ${host}:${port} (${process.env.STORAGE_BACKEND || 'local'} storage)`)
    if (isCloudStorage()) {
      hydrateAllFromR2().catch((err) => console.error('[storage] hydrate failed:', err))
    }
  })
}

start().catch((err) => {
  console.error('[pagelm] failed to start:', err)
  process.exit(1)
})
