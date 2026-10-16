import assert from "node:assert/strict";
import test from "node:test";
import type { SessionInfo } from "../../lib/types";
import { defaultSidebarPreferences, groupProjects, moveProject, parseSidebarPreferences, projectKey, searchProjects, sortProjects } from "./projects.ts";

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
  assert.deepEqual(parseSidebarPreferences("broken"), defaultSidebarPreferences);
  assert.deepEqual(parseSidebarPreferences(JSON.stringify({ paths: ["D:/Pi", null, 3, ""], expanded: { "d:/pi": false, invalid: 4 }, explorerOpen: false, token: "ignored" })), {
    paths: ["D:/Pi"], expanded: { "d:/pi": false }, explorerOpen: false, sortMode: "name", projectOrder: [],
  });
});

test("name ordering is natural, deterministic and leaves conversation trees untouched", () => {
  const projects = groupProjects([session("a", "D:/Project10"), session("b", "D:/Project2"), session("c", "D:/Alpha")]);
  const sorted = sortProjects(projects, "name");
  assert.deepEqual(sorted.map((project) => project.name), ["Alpha", "Project2", "Project10"]);
  assert.equal(sorted[0].tree, projects.find((project) => project.name === "Alpha")!.tree);
  assert.notEqual(sorted, projects);
});

test("recent sorting uses the latest conversation in each project with empty projects last", () => {
  const older = session("older", "D:/Alpha");
  older.modified = "2026-10-14T00:00:00Z";
  const newest = session("newest", "D:/Zulu");
  newest.modified = "2026-10-16T00:00:00Z";
  const projects = groupProjects([older, session("middle", "D:/Zulu"), newest], ["D:/Empty"]);
  assert.deepEqual(sortProjects(projects, "recent").map((project) => project.name), ["Zulu", "Alpha", "Empty"]);
});

test("manual moves preserve every project and handle stale keys or newly added folders", () => {
  const keys = ["d:/alpha", "d:/beta", "d:/gamma"];
  assert.deepEqual(moveProject(keys, "d:/gamma", "d:/alpha"), ["d:/gamma", "d:/alpha", "d:/beta"]);
  assert.deepEqual(keys, ["d:/alpha", "d:/beta", "d:/gamma"]);
  assert.equal(moveProject(keys, "missing", "d:/alpha"), keys);
  assert.equal(moveProject(keys, "d:/alpha", "d:/alpha"), keys);
  const projects = groupProjects([], ["D:/Alpha", "D:/Beta", "D:/New2", "D:/New10"]);
  assert.deepEqual(sortProjects(projects, "manual", ["deleted", "d:/beta", "d:/alpha"]).map((project) => project.name), ["Beta", "Alpha", "New2", "New10"]);
  assert.deepEqual(sortProjects(projects, "name").map((project) => project.name), ["Alpha", "Beta", "New2", "New10"]);
});

test("old preferences migrate to name sorting and manual order survives storage validation", () => {
  assert.equal(parseSidebarPreferences('{"explorerOpen":false}').sortMode, "name");
  const saved = parseSidebarPreferences(JSON.stringify({ sortMode: "manual", projectOrder: ["a", "b", "a", 4, null] }));
  assert.equal(saved.sortMode, "manual");
  assert.deepEqual(saved.projectOrder, ["a", "b"]);
  assert.deepEqual(parseSidebarPreferences(JSON.stringify(saved)), saved);
  assert.equal(parseSidebarPreferences('{"sortMode":"unexpected"}').sortMode, "name");
});
