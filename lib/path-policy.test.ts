import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import os from "node:os";
import { validateAgentCwd, validateWritablePath } from "./path-policy.ts";

const isWin = process.platform === "win32";

test("validateAgentCwd: rejects Windows drive root", { skip: !isWin }, () => {
  assert.equal(validateAgentCwd("C:\\"), "Filesystem root is not allowed as cwd");
  assert.equal(validateAgentCwd("C:/"), "Filesystem root is not allowed as cwd");
  assert.equal(validateAgentCwd("D:\\"), "Filesystem root is not allowed as cwd");
});

test("validateAgentCwd: rejects POSIX filesystem root", { skip: isWin }, () => {
  assert.equal(validateAgentCwd("/"), "Filesystem root is not allowed as cwd");
});

test("validateAgentCwd: rejects user home directory itself", () => {
  const home = os.homedir();
  assert.equal(
    validateAgentCwd(home),
    "User home directory is not allowed as cwd (use a subdirectory)",
  );
});

test("validateAgentCwd: allows a subdirectory of user home", () => {
  const proj = path.join(os.homedir(), "project");
  assert.equal(validateAgentCwd(proj), null);
});

test("validateAgentCwd: rejects Windows system directories", { skip: !isWin }, () => {
  assert.match(validateAgentCwd("C:\\Windows")!, /System directory is not allowed as cwd/);
  assert.match(validateAgentCwd("C:\\Windows\\System32")!, /System directory is not allowed as cwd/);
  assert.match(validateAgentCwd("C:\\Program Files")!, /System directory is not allowed as cwd/);
  assert.match(validateAgentCwd("C:\\Program Files (x86)")!, /System directory is not allowed as cwd/);
  assert.match(validateAgentCwd("C:\\ProgramData")!, /System directory is not allowed as cwd/);
});

test("validateAgentCwd: rejects POSIX system directories", { skip: isWin }, () => {
  for (const sys of ["/etc", "/usr", "/usr/local", "/var", "/bin", "/sbin", "/boot", "/dev", "/sys", "/proc"]) {
    assert.match(validateAgentCwd(sys)!, /System directory is not allowed as cwd/);
  }
});

test("validateAgentCwd: allows an arbitrary project path", () => {
  const proj = isWin ? "D:\\code\\my-app" : "/home/user/proj";
  assert.equal(validateAgentCwd(proj), null);
});

test("validateAgentCwd: is case-insensitive on Windows", { skip: !isWin }, () => {
  assert.match(validateAgentCwd("c:\\windows")!, /System directory is not allowed as cwd/);
  assert.match(validateAgentCwd("C:\\WINDOWS")!, /System directory is not allowed as cwd/);
});

// ---------- validateWritablePath ----------

test("validateWritablePath: rejects .git internals", () => {
  assert.match(validateWritablePath("/proj/.git/config")!, /Writes to \.git\/ directories are forbidden/);
  assert.match(validateWritablePath("/proj/.git/refs/heads/main")!, /Writes to \.git\/ directories are forbidden/);
  assert.match(validateWritablePath("/proj/.git")!, /Writes to \.git\/ directories are forbidden/);
  assert.match(validateWritablePath("/proj/sub/.git/HEAD")!, /Writes to \.git\/ directories are forbidden/);
});

test("validateWritablePath: rejects .hg and .svn internals", () => {
  assert.match(validateWritablePath("/proj/.hg/store")!, /Writes to \.hg\/ directories are forbidden/);
  assert.match(validateWritablePath("/proj/.svn/wc.db")!, /Writes to \.svn\/ directories are forbidden/);
});

test("validateWritablePath: rejects node_modules writes", () => {
  assert.match(
    validateWritablePath("/proj/node_modules/lodash/index.js")!,
    /Writes to node_modules\/ directories are forbidden/,
  );
  assert.match(
    validateWritablePath("/proj/node_modules/.package-lock.json")!,
    /Writes to node_modules\/ directories are forbidden/,
  );
});

test("validateWritablePath: rejects .env files (basename only)", () => {
  assert.match(validateWritablePath("/proj/.env")!, /Writes to \.env files are forbidden/);
  assert.match(validateWritablePath("/proj/.env.local")!, /Writes to \.env files are forbidden/);
  assert.match(validateWritablePath("/proj/.env.production")!, /Writes to \.env files are forbidden/);
  assert.match(validateWritablePath("/proj/sub/.env")!, /Writes to \.env files are forbidden/);
  // bare filename
  assert.match(validateWritablePath(".env")!, /Writes to \.env files are forbidden/);
});

test("validateWritablePath: does NOT match 'envelope.env.ts' (basename is not .env*)", () => {
  // The leading (?:^|\/) anchor ensures `.env` must be the basename.
  assert.equal(validateWritablePath("/proj/envelope.env.ts"), null);
  assert.equal(validateWritablePath("/proj/src/foo.env.d.ts"), null);
});

test("validateWritablePath: allows normal source files and package.json", () => {
  assert.equal(validateWritablePath("/proj/src/index.ts"), null);
  assert.equal(validateWritablePath("/proj/package.json"), null);
  assert.equal(validateWritablePath("/proj/README.md"), null);
});

test("validateWritablePath: treats backslashes like forward slashes", () => {
  assert.match(validateWritablePath("C:\\proj\\.git\\config")!, /Writes to \.git\/ directories are forbidden/);
  assert.match(validateWritablePath("C:\\proj\\node_modules\\x\\y.js")!, /Writes to node_modules\/ directories are forbidden/);
  assert.match(validateWritablePath("C:\\proj\\.env")!, /Writes to \.env files are forbidden/);
  assert.equal(validateWritablePath("C:\\proj\\src\\index.ts"), null);
});
