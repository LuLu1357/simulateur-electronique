let token = "";
export type ApiOptions = { signal?: AbortSignal };
export async function api<T>(path: string, body?: unknown, options: ApiOptions = {}): Promise<T> {
  if (body !== undefined && !token) {
    const r = await fetch("/api/session", { signal: options.signal });
    if (!r.ok) throw Error("Connexion locale refusée.");
    token = (await r.json()).token;
  }
  const r = await fetch(
    `/api/${path}`,
    body === undefined
      ? { signal: options.signal }
      : {
          signal: options.signal,
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Atelier-Token": token,
          },
          body: JSON.stringify(body),
        },
  );
  let data;
  try {
    data = await r.json();
  } catch (error) {
    if (options.signal?.aborted || (error instanceof Error && error.name === "AbortError")) throw error;
    throw Error("Le service local ne répond pas.");
  }
  if (!r.ok) {
    const d = data.detail ?? data.error ?? data;
    throw Error(typeof d === "string" ? d : JSON.stringify(d));
  }
  return data as T;
}
