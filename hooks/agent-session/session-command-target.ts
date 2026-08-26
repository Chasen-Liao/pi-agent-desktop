export type SessionCommandTarget =
  | { kind: "existing"; sessionId: string }
  | { kind: "new"; cwd: string };

export function resolveSessionCommandTarget(input: {
  sessionId: string | null;
  isNew: boolean;
  newSessionCwd: string | null;
}): SessionCommandTarget | null {
  if (input.sessionId) {
    return { kind: "existing", sessionId: input.sessionId };
  }
  if (input.isNew && input.newSessionCwd) {
    return { kind: "new", cwd: input.newSessionCwd };
  }
  return null;
}
