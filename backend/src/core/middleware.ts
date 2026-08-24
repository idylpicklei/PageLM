import { userContext } from "../utils/user-context";

export function loggerMiddleware(req: any, _res: any, next: Function) {
  const now = new Date().toISOString();
  console.log(`[${now}] ${req.method} ${req.url}`);
  next();
}

export function authMiddleware(req: any, res: any, next: Function) {
  if (req.path === "/health") return next();

  const userId = req.headers["x-user-id"];
  if (!userId) {
    return res.status(401).json({ error: "unauthorized" });
  }

  const email = req.headers["x-user-email"];
  req.userId = String(userId);
  req.userEmail = email ? String(email) : undefined;

  userContext.run({ userId: req.userId, email: req.userEmail }, () => next());
}
