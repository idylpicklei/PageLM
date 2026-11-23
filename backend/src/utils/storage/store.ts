import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import fs from "fs";
import path from "path";
import { Readable } from "stream";

import { storageUserPrefix } from "../user-context";

const ROOT = path.join(process.cwd(), "storage");

function scopedRelKey(relKey: string): string {
  const prefix = storageUserPrefix();
  const clean = relKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!prefix.length) return clean;
  const userRoot = `${prefix[0]}/${prefix[1]}/`;
  if (clean.startsWith(userRoot)) return clean;
  return `${prefix.join("/")}/${clean}`;
}

export function isCloudStorage(): boolean {
  return process.env.STORAGE_BACKEND === "cloudflare";
}

export function storageRoot(): string {
  return ROOT;
}

export function resolveStorage(...parts: string[]): string {
  const joined = parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/^\/+/, "");
  return path.join(ROOT, ...scopedRelKey(joined).split("/"));
}

export function storageRel(fullPath: string): string {
  const rel = path.relative(ROOT, fullPath);
  return rel.split(path.sep).join("/");
}

let s3: S3Client | null = null;

function getS3(): S3Client {
  if (s3) return s3;
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials missing (CLOUDFLARE_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY)");
  }
  s3 = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return s3;
}

function bucketName(): string {
  return process.env.R2_BUCKET_NAME || "pagelm-storage";
}

async function streamToBuffer(body: Readable | Blob | undefined): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Blob) return Buffer.from(await body.arrayBuffer());
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Buffer>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function r2PutRaw(key: string, data: Buffer | string): Promise<void> {
  const client = getS3();
  const body = typeof data === "string" ? Buffer.from(data) : data;
  await client.send(
    new PutObjectCommand({
      Bucket: bucketName(),
      Key: key,
      Body: body,
    })
  );
}

export async function r2Put(relKey: string, data: Buffer | string): Promise<void> {
  await r2PutRaw(scopedRelKey(relKey), data);
}

export async function r2GetExact(key: string): Promise<Buffer | null> {
  try {
    const client = getS3();
    const out = await client.send(
      new GetObjectCommand({
        Bucket: bucketName(),
        Key: key.replace(/\\/g, "/").replace(/^\/+/, ""),
      })
    );
    return await streamToBuffer(out.Body as Readable);
  } catch (err: any) {
    if (err?.name === "NoSuchKey" || err?.$metadata?.httpStatusCode === 404) return null;
    throw err;
  }
}

export async function r2Get(relKey: string): Promise<Buffer | null> {
  const scoped = await r2GetExact(scopedRelKey(relKey));
  if (scoped) return scoped;
  const clean = relKey.replace(/\\/g, "/").replace(/^\/+/, "");
  if (clean && clean !== scopedRelKey(relKey)) return r2GetExact(clean);
  return null;
}

export async function r2Exists(relKey: string): Promise<boolean> {
  try {
    const client = getS3();
    await client.send(
      new HeadObjectCommand({
        Bucket: bucketName(),
        Key: scopedRelKey(relKey),
      })
    );
    return true;
  } catch {
    return false;
  }
}

export async function r2List(prefix = ""): Promise<string[]> {
  const client = getS3();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await client.send(
      new ListObjectsV2Command({
        Bucket: bucketName(),
        Prefix: prefix.replace(/\\/g, "/"),
        ContinuationToken: token,
      })
    );
    for (const obj of out.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

export function ensureStorageDir(fullPath: string): void {
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
}

export function ensureStorageDirs(): void {
  const dirs = [
    "uploads",
    "json",
    "podcasts",
    "smartnotes",
    "agents",
    "cache/ask",
    "cache/exam",
    "cache/examgen",
  ];
  for (const d of dirs) {
    fs.mkdirSync(resolveStorage(d), { recursive: true });
  }
}

export async function hydrateFromR2(relKey: string): Promise<boolean> {
  if (!isCloudStorage()) return false;
  const full = resolveStorage(relKey);
  if (fs.existsSync(full)) return true;
  const data = await r2Get(relKey);
  if (!data) return false;
  ensureStorageDir(full);
  fs.writeFileSync(full, data);
  return true;
}

export async function hydrateAllFromR2(): Promise<void> {
  if (!isCloudStorage()) return;
  ensureStorageDirs();
  const keys = await r2List("");
  for (const key of keys) {
    const full = resolveStorage(key);
    if (fs.existsSync(full)) continue;
    const data = await r2Get(key);
    if (!data) continue;
    ensureStorageDir(full);
    fs.writeFileSync(full, data);
  }
  console.log(`[storage] hydrated ${keys.length} object(s) from R2`);
}

export function writeStorageSync(relKey: string, data: Buffer | string): void {
  const key = scopedRelKey(relKey);
  const full = path.join(ROOT, ...key.split("/"));
  ensureStorageDir(full);
  fs.writeFileSync(full, data);
  if (isCloudStorage()) {
    void r2PutRaw(key, data).catch((err) =>
      console.error(`[storage] R2 put failed for ${key}:`, err)
    );
  }
}

export function readStorageSync(relKey: string, encoding?: BufferEncoding): string | Buffer {
  const full = resolveStorage(relKey);
  if (!fs.existsSync(full)) {
    throw new Error(`storage miss (local): ${relKey}`);
  }
  return encoding ? fs.readFileSync(full, encoding) : fs.readFileSync(full);
}

export async function readStorage(relKey: string, encoding?: BufferEncoding): Promise<string | Buffer> {
  await hydrateFromR2(relKey);
  return readStorageSync(relKey, encoding);
}

export async function writeStorage(relKey: string, data: Buffer | string): Promise<void> {
  const key = scopedRelKey(relKey);
  const full = path.join(ROOT, ...key.split("/"));
  ensureStorageDir(full);
  fs.writeFileSync(full, data);
  if (isCloudStorage()) await r2PutRaw(key, data);
}

export function existsStorageSync(relKey: string): boolean {
  if (fs.existsSync(resolveStorage(relKey))) return true;
  return false;
}

export async function existsStorage(relKey: string): Promise<boolean> {
  if (existsStorageSync(relKey)) return true;
  if (!isCloudStorage()) return false;
  return r2Exists(relKey);
}

export async function hydrateStoragePath(fullPath: string): Promise<boolean> {
  if (fs.existsSync(fullPath)) return true;
  if (!isCloudStorage()) return false;
  const rel = storageRel(fullPath);
  const data = await r2Get(rel);
  if (!data) return false;
  ensureStorageDir(fullPath);
  fs.writeFileSync(fullPath, data);
  return true;
}

export async function hydrateAnyKey(relKey: string): Promise<string | null> {
  const clean = String(relKey || "").replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.includes("..")) return null;
  const keys = Array.from(new Set([scopedRelKey(clean), clean]));
  for (const key of keys) {
    const full = path.join(ROOT, ...key.split("/"));
    if (fs.existsSync(full)) return full;
    if (!isCloudStorage()) continue;
    try {
      const data = await r2GetExact(key);
      if (!data) continue;
      ensureStorageDir(full);
      fs.writeFileSync(full, data);
      return full;
    } catch {
      continue;
    }
  }
  return null;
}

export function wrapStorageWriteStream(relKey: string): fs.WriteStream & { uploaded: Promise<void> } {
  const key = scopedRelKey(relKey);
  const full = path.join(ROOT, ...key.split("/"));
  ensureStorageDir(full);
  const ws = fs.createWriteStream(full) as fs.WriteStream & { uploaded: Promise<void> };
  let resolveUpload: () => void;
  let rejectUpload: (err: Error) => void;
  ws.uploaded = new Promise<void>((resolve, reject) => {
    resolveUpload = resolve;
    rejectUpload = reject;
  });
  ws.on("finish", () => {
    if (!isCloudStorage()) {
      resolveUpload();
      return;
    }
    r2PutRaw(key, fs.readFileSync(full)).then(resolveUpload).catch((err) => {
      console.error(`[storage] R2 put failed for ${key}:`, err);
      rejectUpload(err instanceof Error ? err : new Error(String(err)));
    });
  });
  ws.on("error", (err) => rejectUpload(err));
  return ws;
}
