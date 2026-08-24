function backendOrigin(): string {
  if (typeof window !== "undefined") {
    const { hostname, origin } = window.location;
    if (hostname && hostname !== "localhost" && hostname !== "127.0.0.1") {
      return origin;
    }
  }
  const configured = import.meta.env.VITE_BACKEND_URL as string | undefined;
  if (configured && configured.trim()) return configured.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:5000";
}

export const env = {
  backend: backendOrigin(),
  timeout: Number(import.meta.env.VITE_TIMEOUT || 90000),
};
