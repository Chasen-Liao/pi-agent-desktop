import { execFile } from "child_process";
import { promisify } from "util";
import { NextResponse } from "next/server";
import { errorMessage, getRequestId, logApiError } from "@/lib/api-error";

const execFileAsync = promisify(execFile);

async function selectDirectoryOnWindows(): Promise<string | null> {
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.ShowNewFolderButton = $false",
    "$dialog.Description = 'Select project folder'",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) {",
    "  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "  Write-Output $dialog.SelectedPath",
    "}",
  ].join("; ");

  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-STA", "-Command", script],
    {
      encoding: "utf8",
      timeout: 120_000,
      windowsHide: true,
    }
  );

  const selectedPath = stdout.trim();
  return selectedPath || null;
}

export async function POST(req: Request) {
  const requestId = getRequestId(req);
  if (process.platform !== "win32") {
    return NextResponse.json(
      { error: "Directory picker is only supported on Windows." },
      { status: 400, headers: { "x-request-id": requestId } }
    );
  }

  try {
    const selectedPath = await selectDirectoryOnWindows();
    return NextResponse.json({ path: selectedPath });
  } catch (error) {
    logApiError({ route: "/api/select-directory", method: "POST", requestId, error });
    return NextResponse.json(
      { error: `Failed to open directory picker: ${errorMessage(error)}` },
      { status: 500, headers: { "x-request-id": requestId } }
    );
  }
}
