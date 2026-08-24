import { AsyncLocalStorage } from "async_hooks";

export type UserContext = {
  userId: string;
  email?: string;
};

export const userContext = new AsyncLocalStorage<UserContext>();

export function scopedKey(key: string, userId?: string): string {
  const id = userId ?? userContext.getStore()?.userId;
  if (!id) return key;
  return `user:${id}:${key}`;
}

export function getUserId(): string {
  const id = userContext.getStore()?.userId;
  if (!id) throw new Error("No user context");
  return id;
}

export function getUserIdOrNull(): string | null {
  return userContext.getStore()?.userId ?? null;
}

export function bindUserFromRequest(req: { headers?: Record<string, string | string[] | undefined> }): boolean {
  const raw = req.headers?.["x-user-id"];
  const userId = Array.isArray(raw) ? raw[0] : raw;
  if (!userId) return false;
  const emailRaw = req.headers?.["x-user-email"];
  const email = Array.isArray(emailRaw) ? emailRaw[0] : emailRaw;
  userContext.enterWith({ userId: String(userId), email: email ? String(email) : undefined });
  return true;
}

export function storageUserPrefix(): string[] {
  const userId = getUserIdOrNull();
  return userId ? ["users", userId] : [];
}
