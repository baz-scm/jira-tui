import { describe, expect, it, vi } from "vitest";
import { emptyConfig } from "../config.js";
import { JiraClient, SPRINT_CUSTOM, type CreateField, type Issue } from "../jira/client.js";
import { Model, sortIssues } from "./model.js";
import { stripAnsi } from "./styles.js";
import { renderDetailBody, view } from "./view.js";

const issue = (o: Partial<Issue> & { key: string }): Issue => ({
  summary: "",
  type: "",
  status: "",
  statusCategory: "",
  assignee: "",
  reporter: "",
  priority: "",
  points: null,
  labels: [],
  parent: "",
  created: null,
  updated: null,
  description: "",
  ...o,
});

vi.mock("../config.js", async (orig) => ({ ...(await orig<typeof import("../config.js")>()), saveConfig: vi.fn() }));

function testModel(): Model {
  const client = new JiraClient({ siteUrl: "https://x.atlassian.net" });
  const m = new Model(client, { ...emptyConfig(), board_id: 1, board_name: "Fixer" }, renderDetailBody);
  m.sprint = { id: 7, name: "Sprint 42", state: "active" };
  m.sprintLoaded = true;
  m.issues = sortIssues([
    issue({ key: "CR-3", type: "Bug", summary: "Done thing", status: "Done", statusCategory: "done", points: 2 }),
    issue({ key: "CR-1", type: "Story", summary: "very long title ".repeat(20), status: "In Progress", statusCategory: "indeterminate", points: 5 }),
    issue({ key: "CR-2", summary: "Todo", status: "To Do", statusCategory: "new" }),
  ]);
  m.resize(100, 12);
  return m;
}

describe("list view", () => {
  it("renders exactly `height` lines within width, sorted by status category", () => {
    const m = testModel();
    const out = view(m);
    const lines = out.split("\n");
    expect(lines).toHaveLength(12);
    expect(m.issues.map((i) => i.key)).toEqual(["CR-2", "CR-1", "CR-3"]);
    for (const want of ["Mine", "Sprint 42", "3 issues", "Bug", "Story", "CR-1", "In Progress", "5", "▸", "status", "sprints", "search"]) {
      expect(out).toContain(want);
    }
    for (const l of lines) expect([...stripAnsi(l)].length).toBeLessThanOrEqual(100);
  });

  it("navigates and builds JQL", () => {
    const m = testModel();
    m.key("j");
    expect(m.cursor).toBe(1);
    m.key("G");
    expect(m.cursor).toBe(2);
    expect(m.jql()).toBe("sprint = 7 AND assignee = currentUser() ORDER BY Rank ASC");
    m.scope = "team";
    expect(m.jql()).toBe("sprint = 7 ORDER BY Rank ASC");
    m.searching = true;
    m.searchQuery = "cr-12";
    expect(m.jql().startsWith(`key = "CR-12" OR text ~ "cr-12"`)).toBe(true);
    m.searchQuery = `say "hi"`;
    expect(m.jql()).toBe(`text ~ "say \\"hi\\"" ORDER BY updated DESC`);
  });

  it("shows help and detail", () => {
    const m = testModel();
    m.key("?");
    expect(view(m)).toContain("keyboard shortcuts");
    m.help = false;
    m.resize(100, 30);
    m.update({
      type: "issue",
      err: null,
      issue: issue({ key: "CR-1", summary: "Title", status: "To Do", statusCategory: "new", description: "## Goal\n\nline" }),
    });
    expect(m.view).toBe("detail");
    const out = view(m);
    for (const want of ["CR-1", "Title", "## Goal", "browse/CR-1", "browser"]) expect(out).toContain(want);
    expect(out.split("\n")).toHaveLength(30);
  });

  it("shows search input and applies the query", () => {
    const m = testModel();
    m.key("/");
    for (const ch of "auth") m.key(ch);
    const out = view(m);
    expect(stripAnsi(out)).toContain("/ auth");
    expect(out).toContain("cancel");
    const cmds = m.key("enter");
    expect(m.searching).toBe(true);
    expect(m.searchQuery).toBe("auth");
    expect(m.view).toBe("list");
    expect(cmds).toHaveLength(1);
  });

  it("ignores stale issue results", () => {
    const m = testModel();
    m.key("r"); // seq 1
    m.key("r"); // seq 2
    m.update({ type: "issues", seq: 1, issues: [], err: null });
    expect(m.issues).toHaveLength(3);
    m.update({ type: "issues", seq: 2, issues: [], err: null });
    expect(m.issues).toHaveLength(0);
  });

  it("creates an issue: type → required option (saved) → summary", async () => {
    const m = testModel();
    m.scope = "team";
    expect(m.key("n")).toHaveLength(1);
    m.update({
      type: "createTypes",
      project: "CR",
      me: "acc-1",
      sprintId: 7,
      types: [{ id: "1", name: "Bug" }, { id: "2", name: "Task" }],
      err: null,
    });
    expect(m.view).toBe("pick");
    expect(m.pickItems[m.pickCursor]).toBe("Task");
    expect(m.key("enter")).toHaveLength(1);

    const squad: CreateField = {
      id: "cf_squad",
      name: "Squad",
      required: true,
      hasDefault: false,
      array: false,
      custom: "",
      options: [{ id: "a", value: "Agents" }, { id: "b", value: "Tooling" }],
    };
    const sprintField: CreateField = { ...squad, id: "cf_sprint", name: "Sprint", required: false, custom: SPRINT_CUSTOM, options: [] };
    m.update({ type: "createFields", fields: [sprintField, squad], err: null });
    expect(m.pickTitle).toBe("Squad");
    expect(stripAnsi(view(m))).toContain("Tooling");
    m.key("j");
    m.key("enter");
    expect(m.cfg.create_defaults.CR?.cf_squad).toEqual({ field: "Squad", id: "b", value: "Tooling" });

    expect(m.view).toBe("create");
    for (const ch of "Fix q") m.key(ch);
    expect(stripAnsi(view(m))).toContain("new task › Fix q");
    const create = vi.spyOn(m.client, "createIssue").mockResolvedValue("CR-9");
    const [cmd] = m.key("enter");
    expect(await cmd!()).toEqual({ type: "created", key: "CR-9", err: null });
    expect(create).toHaveBeenCalledWith({
      project: { key: "CR" },
      issuetype: { id: "2" },
      summary: "Fix q",
      assignee: { accountId: "acc-1" },
      cf_squad: { id: "b" },
      cf_sprint: 7,
    });
    expect(m.update({ type: "created", key: "CR-9", err: null })).toHaveLength(2);
    expect(m.view).toBe("list");
    expect(m.flash).toBe("CR-9 created");

    // Second time: saved squad is reused, straight to summary.
    m.key("n");
    m.update({ type: "createTypes", project: "CR", me: "acc-1", sprintId: 7, types: [{ id: "2", name: "Task" }], err: null });
    m.key("enter");
    m.update({ type: "createFields", fields: [squad], err: null });
    expect(m.view).toBe("create");
    m.key("esc");
    expect(m.view).toBe("list");
    expect(m.create).toBeNull();
  });

  it("refuses to create outside a board sprint", () => {
    const m = testModel();
    m.scope = "company";
    m.key("n");
    expect(m.view).toBe("list");
    expect(m.flash).toContain("press m or t");
  });
});
