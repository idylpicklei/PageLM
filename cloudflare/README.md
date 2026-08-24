# Cloudflare deployment for PageLM

Deploys the Node backend on **Cloudflare Containers** with **D1** (Keyv records) and **R2** (files/uploads/podcasts).

## Prerequisites

1. [Wrangler](https://developers.cloudflare.com/workers/wrangler/) logged in: `npx wrangler login`
2. **R2 enabled** on your Cloudflare account: [R2 Overview](https://dash.cloudflare.com/?to=/:account/r2/overview)
3. Gemini API key (or other LLM provider keys)

## One-time setup

```powershell
# Create resources (D1 may already exist as pagelm-db)
npx wrangler d1 create pagelm-db
npx wrangler r2 bucket create pagelm-storage

# Apply D1 schema
npx wrangler d1 migrations apply pagelm-db --remote

# Secrets (run each command and paste the value when prompted)
npx wrangler secret put CF_STORE_TOKEN
npx wrangler secret put gemini
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

Create an **R2 API token** in the dashboard (R2 → Manage API Tokens → Object Read & Write for `pagelm-storage`).

Generate a store token for D1 KV proxy auth:

```powershell
# Example: random token for CF_STORE_TOKEN
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Update `database_id` in `wrangler.jsonc` if you created a new D1 database.

## Deploy

```powershell
npm run build
npm run build --prefix frontend
npx wrangler deploy
```

The Worker serves the frontend from `frontend/dist` and proxies API/WebSocket traffic to the container.

## Local vs Cloudflare storage

| `STORAGE_BACKEND` | Used by |
|---|---|
| `local` (default) | Docker Compose, `npm run dev` |
| `cloudflare` | Container runtime (set automatically by Worker) |

## Verify

1. Open your `*.workers.dev` URL
2. `GET /health` should return `{ ok: true, storage: "cloudflare" }`
3. Create a chat, upload a file, generate a podcast
4. After container sleep/restart, data should persist via D1 + R2

## Troubleshooting

- **R2 error 10042**: Enable R2 in the Cloudflare dashboard first
- **Container start timeout**: Increase `instance_type` in `wrangler.jsonc` to `standard-2`
- **KV auth errors**: Ensure `CF_STORE_TOKEN` matches in Worker secrets and container env
