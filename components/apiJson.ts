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
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch {
    throw new Error(options.fallback);
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(options.fallback);
  }

  if (!response.ok) {
    throw new Error(responseError(data) ?? options.fallback);
  }
  return data as T;
}
