export type PromptDispatchState = { current: boolean };

export function tryStartPromptDispatch(state: PromptDispatchState): boolean {
  if (state.current) return false;
  state.current = true;
  return true;
}

export function finishPromptDispatch(state: PromptDispatchState): void {
  state.current = false;
}
