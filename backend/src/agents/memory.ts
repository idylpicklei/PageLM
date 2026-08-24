import { readStorageSync, writeStorageSync } from "../utils/storage/store"

type M = Record<string, any>

const relOf = (sid: string) => `agents/${sid}.json`

export const load = (sid?: string) => {
  if (!sid) return {}
  try {
    return JSON.parse(readStorageSync(relOf(sid), "utf8") as string)
  } catch {
    return {}
  }
}

export const save = (sid?: string, m?: M) => {
  if (!sid) return
  writeStorageSync(relOf(sid), JSON.stringify(m || {}, null, 0))
}
