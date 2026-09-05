export interface ApiJsonOptions {
  fallback: string;
}

function responseError(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null || !("error" in data)) return undefined;
  const error = (data as { error?: unknown }).error;
  return error ? String(error) : undefined;
}

export async function apiJson<T>(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  options: ApiJsonOptions,
): Promise<T> {
  try {
    const response = await fetch(input, init);
    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      throw error;
    }
    if (!response.ok) {
      throw new Error(responseError(data) ?? `HTTP ${response.status}`);
    }
    return data as T;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error(options.fallback);
  }
}
