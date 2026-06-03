export async function choosePort(input: {
  startPort: number;
  maxAttempts?: number;
  reservePort: (port: number) => Promise<number>;
}): Promise<number> {
  const maxAttempts = input.maxAttempts ?? 10;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const port = input.startPort + attempt;
    try {
      return await input.reservePort(port);
    } catch {
      // Try the next port regardless of listen failure reason.
    }
  }

  throw new Error(`No free port found after ${maxAttempts} attempts`);
}
