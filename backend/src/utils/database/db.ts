import { Chroma } from "@langchain/community/vectorstores/chroma"
import { Document } from "@langchain/core/documents"
import { EmbeddingsInterface } from "@langchain/core/embeddings"
import { config } from "../../config/env"
import { existsStorageSync, readStorage, writeStorage } from "../storage/store"

const memoryStores: Record<string, any> = {}
const retrieverCache: Record<string, any> = {}

export async function saveDocuments(
  collection: string,
  docs: Document[],
  embeddings: EmbeddingsInterface
) {
  if (config.db_mode === "json") {
    const rel = `json/${collection}.json`
    await writeStorage(
      rel,
      JSON.stringify(
        docs.map(d => ({
          pageContent: typeof d.pageContent === "string" ? d.pageContent : String(d.pageContent ?? ""),
          metadata: d.metadata || {}
        })),
        null,
        2
      )
    )
    delete memoryStores[collection]
    delete retrieverCache[collection]
  } else {
    const store = new Chroma(embeddings, {
      collectionName: collection,
      collectionMetadata: { "hnsw:space": "cosine" },
      url: "http://localhost:8000",
    })
    await store.addDocuments(docs)
    retrieverCache[collection] = store.asRetriever({ k: 4 })
  }
}

export function hasLocalDocuments(collection: string): boolean {
  return existsStorageSync(`json/${collection}.json`)
}

export async function readNamespaceText(collection: string, maxChars = 28000): Promise<string> {
  const rel = `json/${collection}.json`
  try {
    const raw = JSON.parse((await readStorage(rel, "utf-8")) as string)
    if (!Array.isArray(raw)) return ""
    const text = raw
      .map((d: any) => (typeof d?.pageContent === "string" ? d.pageContent : ""))
      .filter(Boolean)
      .join("\n\n")
    return text.slice(0, maxChars)
  } catch {
    return ""
  }
}

export async function getRetriever(
  collection: string,
  embeddings: EmbeddingsInterface
) {
  if (retrieverCache[collection]) return retrieverCache[collection]

  if (config.db_mode === "json") {
    const rel = `json/${collection}.json`
    if (!existsStorageSync(rel)) {
      const empty = { invoke: async () => [] }
      retrieverCache[collection] = empty
      return empty
    }
    let docsRaw: any[] = []
    try {
      docsRaw = JSON.parse((await readStorage(rel, "utf-8")) as string)
    } catch {
      docsRaw = []
    }
    const docs = docsRaw.map((d: any) => new Document({
      pageContent: typeof d.pageContent === "string" ? d.pageContent : String(d.pageContent ?? ""),
      metadata: d.metadata || {},
    }))
    if (!docs.length) {
      const empty = { invoke: async () => [] }
      retrieverCache[collection] = empty
      return empty
    }
    if (!memoryStores[collection]) {
      const { MemoryVectorStore } = await import("@langchain/classic/vectorstores/memory")
      memoryStores[collection] = await MemoryVectorStore.fromDocuments(docs, embeddings)
    }
    retrieverCache[collection] = memoryStores[collection].asRetriever({ k: 4 })
    return retrieverCache[collection]
  } else {
    const store = new Chroma(embeddings, {
      collectionName: collection,
      url: "http://localhost:8000",
    })
    retrieverCache[collection] = store.asRetriever({ k: 4 })
    return retrieverCache[collection]
  }
}