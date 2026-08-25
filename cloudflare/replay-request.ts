/** Snapshot a Request so it can be sent more than once (Worker bodies are one-shot). */
export async function makeReplayableRequest(request: Request): Promise<() => Request> {
  const url = request.url;
  const method = request.method;
  const headers = new Headers(request.headers);
  const canHaveBody = method !== "GET" && method !== "HEAD";
  const body = canHaveBody ? await request.arrayBuffer() : undefined;

  return () =>
    new Request(url, {
      method,
      headers,
      body: body ? body.slice(0) : undefined,
    });
}
