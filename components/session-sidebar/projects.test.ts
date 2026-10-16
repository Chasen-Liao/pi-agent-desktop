import assert from "node:assert/strict";
import test from "node:test";
import type { SessionInfo } from "../../lib/types";
import { groupProjects, parseSidebarPreferences, projectKey, searchProjects } from "./projects.ts";

function session(id: string, cwd: string, name = id, parentSessionId?: string): SessionInfo {
  return { id, cwd, name, parentSessionId, path: id + ".jsonl", created: "2026-10-01T00:00:00Z", modified: "2026-10-15T00:00:00Z", firstMessage: "", messageCount: 2 };
}

test("Windows aliases share a project while POSIX case and sibling worktrees remain distinct", () => {
  const sessions = [session("a", "D:\\work\\Pi"), session("b", "d:/work/pi/"), session("c", "/work/Pi"), session("d", "/work/pi"), session("e", "D:\\work\\Pi-tree")];
  const projects = groupProjects(sessions);
  assert.equal(projects.length, 4);
  const windows = projects.find((project) => project.key === projectKey("D:/work/pi"))!;
  assert.deepEqual(windows.sessions.map((item) => item.id), ["a", "b"]);
  assert.equal(windows.sessions[0].cwd, "D:\\work\\Pi");
  assert.notEqual(projectKey(""), projectKey("/"));
  assert.notEqual(projectKey("/work/Pi"), projectKey("/work/pi"));
  assert.notEqual(projectKey("\\\\wsl.localhost\\Ubuntu\\home\\Pi"), projectKey("\\\\wsl.localhost\\Ubuntu\\home\\pi"));
});

test("all projects, including added empty folders, survive grouping without a five-item cap", () => {
  const sessions = Array.from({ length: 8 }, (_, index) => session(String(index), "D:/work/" + index));
  const projects = groupProjects(sessions, ["D:/empty", "d:\\EMPTY\\"]);
  assert.equal(projects.length, 9);
  assert.equal(projects.find((project) => project.key === "d:/empty")?.sessions.length, 0);
});

test("search keeps a matching fork's ancestors and excludes unrelated siblings without mutating the tree", () => {
  const projects = groupProjects([
    session("root", "D:/Pi", "Release"),
    session("child", "D:/Pi", "MCP compatibility", "root"),
    session("grandchild", "D:/Pi", "Windows installer", "child"),
    session("sibling", "D:/Pi", "Update readme", "root"),
    session("other", "D:/Other", "Interview"),
  ]);
  const filtered = searchProjects(projects, "pi installer");
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].tree[0].session.id, "root");
  assert.deepEqual(filtered[0].tree[0].children.map((node) => node.session.id), ["child"]);
  assert.equal(filtered[0].tree[0].children[0].children[0].session.id, "grandchild");
  assert.equal(projects.find((project) => project.name === "Pi")!.tree[0].children.length, 2);
  assert.equal(searchProjects(projects, "  "), projects);
  assert.equal(searchProjects(projects, "not-found").length, 0);
});

test("project name search includes the entire tree and empty folders", () => {
  const projects = groupProjects([session("root", "D:/Pi", "Release"), session("child", "D:/Pi", "Installer", "root")], ["D:/Empty"]);
  assert.equal(searchProjects(projects, "PI")[0].tree[0].children.length, 1);
  assert.equal(searchProjects(projects, "Empty")[0].cwd, "D:/Empty");
});

test("cross-project forks stay in their own working directory", () => {
  const projects = groupProjects([session("root", "D:/Pi"), session("fork", "D:/Pi-worktree", "Fork", "root")]);
  assert.equal(projects.find((project) => project.cwd === "D:/Pi-worktree")!.tree[0].session.id, "fork");
});

test("preferences recover from invalid storage and keep only valid presentation fields", () => {
  assert.deepEqual(parseSidebarPreferences("broken"), { paths: [], expanded: {}, explorerOpen: true });
  assert.deepEqual(parseSidebarPreferences(JSON.stringify({ paths: ["D:/Pi", null, 3, ""], expanded: { "d:/pi": false, invalid: 4 }, explorerOpen: false, token: "ignored" })), {
    paths: ["D:/Pi"], expanded: { "d:/pi": false }, explorerOpen: false,
  });
});
