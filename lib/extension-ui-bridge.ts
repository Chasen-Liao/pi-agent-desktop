/**
 * In-process ExtensionUIContext that emits SSE-style events and waits for
 * HTTP `extension_ui_response` commands to resolve dialogs.
 */
import { randomUUID } from "crypto";

export type ExtensionUiMethod = "confirm" | "select" | "input" | "editor";

export type ExtensionUiRequestEvent = {
  type: "extension_ui_request";
  id: string;
  method: ExtensionUiMethod;
  title: string;
  message?: string;
  options?: string[];
  placeholder?: string;
  prefill?: string;
  timeout?: number;
};

export type ExtensionUiNotifyEvent = {
  type: "extension_ui_notify";
  message: string;
  notifyType: "info" | "warning" | "error";
};

export type ExtensionUiResponse = {
  id: string;
  confirmed?: boolean;
  value?: string;
  cancelled?: boolean;
};

type Deferred = {
  method: ExtensionUiMethod;
  resolve: (value: unknown) => void;
  timer?: ReturnType<typeof setTimeout>;
};

export type ExtensionUiEmit = (event: ExtensionUiRequestEvent | ExtensionUiNotifyEvent) => void;

export type ExtensionUiDialogOptions = {
  signal?: AbortSignal;
  timeout?: number;
};

/**
 * Bridge implementing the dialog + notify subset of ExtensionUIContext.
 * TUI-only methods are provided as no-ops so bindExtensions can use it as mode "rpc".
 */
export class ExtensionUiBridge {
  private pending = new Map<string, Deferred>();
  private destroyed = false;
  private emit: ExtensionUiEmit;

  constructor(emit: ExtensionUiEmit) {
    this.emit = emit;
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  destroy(): void {
    this.destroyed = true;
    for (const [id, d] of this.pending) {
      if (d.timer) clearTimeout(d.timer);
      d.resolve(d.method === "confirm" ? false : undefined);
      this.pending.delete(id);
    }
  }

  /**
   * Resolve a pending dialog from an agent command.
   * @returns null on success, error message string on failure.
   */
  respond(response: ExtensionUiResponse): string | null {
    const d = this.pending.get(response.id);
    if (!d) return "Unknown or expired UI request";
    if (d.timer) clearTimeout(d.timer);
    this.pending.delete(response.id);

    if (response.cancelled) {
      d.resolve(d.method === "confirm" ? false : undefined);
      return null;
    }
    if (d.method === "confirm") {
      d.resolve(response.confirmed === true);
      return null;
    }
    if (typeof response.value === "string") {
      d.resolve(response.value);
      return null;
    }
    d.resolve(undefined);
    return null;
  }

  private enqueue<T>(
    method: ExtensionUiMethod,
    payload: Omit<ExtensionUiRequestEvent, "type" | "id" | "method">,
    opts?: ExtensionUiDialogOptions
  ): Promise<T> {
    if (this.destroyed) {
      return Promise.resolve((method === "confirm" ? false : undefined) as T);
    }
    const id = randomUUID();
    const event: ExtensionUiRequestEvent = {
      type: "extension_ui_request",
      id,
      method,
      ...payload,
    };
    if (opts?.timeout != null) event.timeout = opts.timeout;

    return new Promise<T>((resolve) => {
      const deferred: Deferred = {
        method,
        resolve: (v) => resolve(v as T),
      };
      if (opts?.timeout != null && opts.timeout > 0) {
        deferred.timer = setTimeout(() => {
          if (!this.pending.has(id)) return;
          this.pending.delete(id);
          resolve((method === "confirm" ? false : undefined) as T);
        }, opts.timeout);
      }
      if (opts?.signal) {
        const onAbort = () => {
          if (!this.pending.has(id)) return;
          if (deferred.timer) clearTimeout(deferred.timer);
          this.pending.delete(id);
          resolve((method === "confirm" ? false : undefined) as T);
        };
        if (opts.signal.aborted) {
          onAbort();
          return;
        }
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      this.pending.set(id, deferred);
      try {
        this.emit(event);
      } catch (err) {
        if (deferred.timer) clearTimeout(deferred.timer);
        this.pending.delete(id);
        resolve((method === "confirm" ? false : undefined) as T);
        console.error("extension_ui emit failed:", err);
      }
    });
  }

  // --- ExtensionUIContext dialog subset ---

  select(title: string, options: string[], opts?: ExtensionUiDialogOptions): Promise<string | undefined> {
    return this.enqueue("select", { title, options }, opts);
  }

  confirm(title: string, message: string, opts?: ExtensionUiDialogOptions): Promise<boolean> {
    return this.enqueue("confirm", { title, message }, opts);
  }

  input(title: string, placeholder?: string, opts?: ExtensionUiDialogOptions): Promise<string | undefined> {
    return this.enqueue("input", { title, placeholder }, opts);
  }

  editor(title: string, prefill?: string, opts?: ExtensionUiDialogOptions): Promise<string | undefined> {
    return this.enqueue("editor", { title, prefill }, opts);
  }

  notify(message: string, type: "info" | "warning" | "error" = "info"): void {
    if (this.destroyed) return;
    this.emit({ type: "extension_ui_notify", message, notifyType: type });
  }

  // --- no-op stubs for the rest of ExtensionUIContext ---

  onTerminalInput(): () => void {
    return () => {};
  }
  setStatus(): void {}
  setWorkingMessage(): void {}
  setWorkingVisible(): void {}
  setWorkingIndicator(): void {}
  setHiddenThinkingLabel(): void {}
  setWidget(): void {}
  setFooter(): void {}
  setHeader(): void {}
  setTitle(): void {}
  custom(): Promise<undefined> {
    return Promise.resolve(undefined);
  }
  setEditorComponent(): void {}
  getEditorComponent(): undefined {
    return undefined;
  }
  addAutocompleteProvider(): void {}
  getEditorText(): string {
    return "";
  }
  setEditorText(): void {}
  pasteToEditor(): void {}
  getToolsExpanded(): boolean {
    return false;
  }
  setToolsExpanded(): void {}
  getAllThemes(): never[] {
    return [];
  }
  getTheme(): undefined {
    return undefined;
  }
  setTheme(): { success: false; error: string } {
    return { success: false, error: "Themes not supported in desktop UI mode" };
  }
  /** Required by ExtensionUIContext; desktop has no TUI theme object. */
  get theme(): never {
    return undefined as never;
  }
}
