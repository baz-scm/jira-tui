import type { Config } from "../config.js";
import { saveConfig } from "../config.js";
import { openBrowser } from "../browser.js";
import type { Board, Issue, JiraClient, Sprint, Transition } from "../jira/client.js";

export type Scope = "mine" | "team" | "company";
export type View = "list" | "detail" | "sprints" | "search" | "transition" | "boards";

export const scopeLabel: Record<Scope, string> = { mine: "Mine", team: "Team", company: "Company" };

type Err = string | null;

export type Msg =
  | { type: "activeSprint"; sprint: Sprint | null; err: Err }
  | { type: "issues"; seq: number; issues: Issue[]; err: Err }
  | { type: "sprints"; sprints: Sprint[]; err: Err }
  | { type: "boards"; boards: Board[]; err: Err }
  | { type: "issue"; issue: Issue | null; err: Err }
  | { type: "transitions"; key: string; ts: Transition[]; err: Err }
  | { type: "transitioned"; key: string; to: string; err: Err }
  | { type: "listRefresh"; issue: Issue | null; err: Err }
  | { type: "flashClear" }
  | { type: "tick" };

/** A command runs async work and resolves to the message to feed back (or null). */
export type Cmd = () => Promise<Msg | null>;

const errStr = (e: unknown): string => (e instanceof Error ? e.message : String(e));

const KEY_RE = /^[A-Za-z][A-Za-z0-9_]+-\d+$/;
const CAT_RANK: Record<string, number> = { new: 0, indeterminate: 1, done: 2 };

export function sortIssues(issues: Issue[]): Issue[] {
  return [...issues].sort((a, b) => (CAT_RANK[a.statusCategory] ?? 3) - (CAT_RANK[b.statusCategory] ?? 3));
}

export class Model {
  view: View = "list";
  prevView: View = "list";
  scope: Scope = "mine";

  searching = false;
  searchQuery = "";
  input = "";

  activeSprint: Sprint | null = null;
  sprint: Sprint | null = null;
  sprintLoaded = false;

  issues: Issue[] = [];
  cursor = 0;
  offset = 0;
  private seq = 0;

  sprints: Sprint[] = [];
  sprintCursor = 0;
  boards: Board[] = [];
  boardCursor = 0;
  transitions: Transition[] = [];
  trCursor = 0;
  trKey = "";

  detail: Issue | null = null;
  vpLines: string[] = [];
  vpOffset = 0;

  loading = false;
  err = "";
  flash = "";
  help = false;
  width = 0;
  height = 0;
  spinFrame = 0;
  quit = false;

  constructor(
    readonly client: JiraClient,
    readonly cfg: Config,
    /** Hook so the view can rebuild detail lines; wired by view.ts to avoid a cycle. */
    public renderDetailBody: (m: Model) => string = () => "",
  ) {}

  init(): Cmd[] {
    return this.cfg.board_id === 0 ? [this.loadBoards()] : [this.loadActiveSprint()];
  }

  // ---- commands ----

  private loadActiveSprint(): Cmd {
    const board = this.cfg.board_id;
    return async () => {
      try {
        return { type: "activeSprint", sprint: await this.client.activeSprint(board), err: null };
      } catch (e) {
        return { type: "activeSprint", sprint: null, err: errStr(e) };
      }
    };
  }

  private loadIssues(): Cmd {
    this.seq++;
    this.loading = true;
    this.err = "";
    const seq = this.seq;
    const jql = this.jql();
    return async () => {
      try {
        return { type: "issues", seq, issues: await this.client.search(jql, 300), err: null };
      } catch (e) {
        return { type: "issues", seq, issues: [], err: errStr(e) };
      }
    };
  }

  private loadSprints(): Cmd {
    const board = this.cfg.board_id;
    return async () => {
      try {
        return { type: "sprints", sprints: await this.client.sprints(board), err: null };
      } catch (e) {
        return { type: "sprints", sprints: [], err: errStr(e) };
      }
    };
  }

  private loadBoards(): Cmd {
    return async () => {
      try {
        return { type: "boards", boards: await this.client.boards(), err: null };
      } catch (e) {
        return { type: "boards", boards: [], err: errStr(e) };
      }
    };
  }

  private loadIssue(key: string, as: "issue" | "listRefresh" = "issue"): Cmd {
    return async () => {
      try {
        return { type: as, issue: await this.client.issue(key), err: null };
      } catch (e) {
        return { type: as, issue: null, err: errStr(e) };
      }
    };
  }

  private loadTransitions(key: string): Cmd {
    return async () => {
      try {
        return { type: "transitions", key, ts: await this.client.transitions(key), err: null };
      } catch (e) {
        return { type: "transitions", key, ts: [], err: errStr(e) };
      }
    };
  }

  private doTransition(key: string, t: Transition): Cmd {
    return async () => {
      try {
        await this.client.transition(key, t.id);
        return { type: "transitioned", key, to: t.to, err: null };
      } catch (e) {
        return { type: "transitioned", key, to: t.to, err: errStr(e) };
      }
    };
  }

  private flashAfter(ms: number): Cmd {
    return () => new Promise((r) => setTimeout(() => r({ type: "flashClear" }), ms));
  }

  jql(): string {
    if (this.searching) {
      const q = this.searchQuery.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      const trimmed = this.searchQuery.trim();
      if (KEY_RE.test(trimmed)) {
        return `key = "${q.trim().toUpperCase()}" OR text ~ "${q}" ORDER BY updated DESC`;
      }
      return `text ~ "${q}" ORDER BY updated DESC`;
    }
    switch (this.scope) {
      case "company":
        return "sprint in openSprints() ORDER BY project ASC, Rank ASC";
      case "team":
        return this.sprint ? `sprint = ${this.sprint.id} ORDER BY Rank ASC` : "sprint in openSprints() ORDER BY Rank ASC";
      default:
        return this.sprint
          ? `sprint = ${this.sprint.id} AND assignee = currentUser() ORDER BY Rank ASC`
          : "assignee = currentUser() AND sprint in openSprints() ORDER BY Rank ASC";
    }
  }

  // ---- update ----

  resize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.clampScroll();
    this.clampVp();
  }

  update(msg: Msg): Cmd[] {
    switch (msg.type) {
      case "tick":
        this.spinFrame++;
        return [];
      case "flashClear":
        this.flash = "";
        return [];
      case "activeSprint":
        this.sprintLoaded = true;
        if (msg.err) {
          this.err = msg.err;
          this.loading = false;
          return [];
        }
        this.activeSprint = msg.sprint;
        this.sprint = msg.sprint;
        return [this.loadIssues()];
      case "issues":
        if (msg.seq !== this.seq) return [];
        this.loading = false;
        if (msg.err) {
          this.err = msg.err;
          return [];
        }
        this.issues = sortIssues(msg.issues);
        if (this.cursor >= this.issues.length) this.cursor = Math.max(0, this.issues.length - 1);
        this.clampScroll();
        return [];
      case "sprints":
        this.loading = false;
        if (msg.err) {
          this.err = msg.err;
          return [];
        }
        this.sprints = msg.sprints;
        this.sprintCursor = Math.max(0, this.sprints.findIndex((s) => s.id === this.sprint?.id));
        this.view = "sprints";
        return [];
      case "boards":
        this.loading = false;
        if (msg.err) {
          this.err = msg.err;
          return [];
        }
        this.boards = msg.boards;
        this.boardCursor = Math.max(0, this.boards.findIndex((b) => b.id === this.cfg.board_id));
        this.view = "boards";
        return [];
      case "issue":
        this.loading = false;
        if (msg.err || !msg.issue) {
          this.err = msg.err ?? "issue not found";
          return [];
        }
        this.detail = msg.issue;
        this.updateIssueInList(msg.issue);
        this.setDetailContent();
        this.vpOffset = 0;
        this.view = "detail";
        return [];
      case "transitions":
        this.loading = false;
        if (msg.err) {
          this.err = msg.err;
          return [];
        }
        if (msg.ts.length === 0) {
          this.flash = "no transitions available";
          return [this.flashAfter(2000)];
        }
        this.transitions = msg.ts;
        this.trCursor = 0;
        this.trKey = msg.key;
        this.prevView = this.view;
        this.view = "transition";
        return [];
      case "transitioned":
        this.loading = false;
        this.view = this.prevView;
        if (msg.err) {
          this.err = msg.err;
          return [];
        }
        this.flash = `${msg.key} → ${msg.to}`;
        // In the list, refresh status without opening detail.
        return [this.flashAfter(3000), this.loadIssue(msg.key, this.view === "list" ? "listRefresh" : "issue")];
      case "listRefresh":
        if (!msg.err && msg.issue) this.updateIssueInList(msg.issue);
        return [];
    }
  }

  private setDetailContent(): void {
    this.vpLines = this.renderDetailBody(this).replace(/\n$/, "").split("\n");
    this.clampVp();
  }

  private updateIssueInList(is: Issue): void {
    this.issues = this.issues.map((x) => (x.key === is.key ? { ...is, description: "" } : x));
    if (this.detail && this.detail.key === is.key) {
      this.detail = { ...this.detail, status: is.status, statusCategory: is.statusCategory };
      this.setDetailContent();
    }
  }

  // ---- keys ----

  key(k: string): Cmd[] {
    if (k === "ctrl+c") {
      this.quit = true;
      return [];
    }
    if (this.help) {
      if (k === "?" || k === "esc" || k === "q") this.help = false;
      return [];
    }
    switch (this.view) {
      case "list":
        return this.keyList(k);
      case "detail":
        return this.keyDetail(k);
      case "sprints":
        return this.keySprints(k);
      case "boards":
        return this.keyBoards(k);
      case "transition":
        return this.keyTransition(k);
      case "search":
        return this.keySearch(k);
    }
  }

  private keyList(k: string): Cmd[] {
    const cur = this.current();
    switch (k) {
      case "q":
        this.quit = true;
        break;
      case "j":
      case "down":
        this.move(1);
        break;
      case "k":
      case "up":
        this.move(-1);
        break;
      case "g":
      case "home":
        this.cursor = 0;
        this.clampScroll();
        break;
      case "G":
      case "end":
        this.cursor = Math.max(0, this.issues.length - 1);
        this.clampScroll();
        break;
      case "ctrl+d":
      case "pgdown":
        this.move(Math.floor(this.listRows() / 2));
        break;
      case "ctrl+u":
      case "pgup":
        this.move(-Math.floor(this.listRows() / 2));
        break;
      case "enter":
        if (cur) {
          this.loading = true;
          return [this.loadIssue(cur.key)];
        }
        break;
      case "s":
        if (cur) {
          this.loading = true;
          return [this.loadTransitions(cur.key)];
        }
        break;
      case "m":
      case "t":
      case "c":
        this.searching = false;
        this.scope = k === "m" ? "mine" : k === "t" ? "team" : "company";
        this.cursor = this.offset = 0;
        return [this.loadIssues()];
      case "b":
        this.loading = true;
        return [this.loadSprints()];
      case "B":
        this.loading = true;
        return [this.loadBoards()];
      case "/":
        this.input = this.searchQuery;
        this.view = "search";
        break;
      case "r":
        return [this.loadIssues()];
      case "o":
        if (cur) openBrowser(this.client.issueUrl(cur.key));
        break;
      case "?":
        this.help = true;
        break;
      case "esc":
        if (this.searching) {
          this.searching = false;
          this.cursor = this.offset = 0;
          return [this.loadIssues()];
        }
        break;
    }
    return [];
  }

  private keyDetail(k: string): Cmd[] {
    const d = this.detail;
    switch (k) {
      case "esc":
      case "q":
      case "enter":
      case "h":
      case "left":
        this.view = "list";
        return [];
      case "s":
        if (d) {
          this.loading = true;
          return [this.loadTransitions(d.key)];
        }
        return [];
      case "o":
        if (d) openBrowser(this.client.issueUrl(d.key));
        return [];
      case "r":
        if (d) {
          this.loading = true;
          return [this.loadIssue(d.key)];
        }
        return [];
      case "?":
        this.help = true;
        return [];
      case "J":
      case "n":
        if (this.cursor < this.issues.length - 1) {
          this.cursor++;
          this.clampScroll();
          this.loading = true;
          return [this.loadIssue(this.issues[this.cursor]!.key)];
        }
        return [];
      case "K":
      case "p":
        if (this.cursor > 0) {
          this.cursor--;
          this.clampScroll();
          this.loading = true;
          return [this.loadIssue(this.issues[this.cursor]!.key)];
        }
        return [];
      case "j":
      case "down":
        this.vpOffset++;
        break;
      case "k":
      case "up":
        this.vpOffset--;
        break;
      case "ctrl+d":
      case "pgdown":
      case " ":
        this.vpOffset += Math.floor(this.vpRows() / 2);
        break;
      case "ctrl+u":
      case "pgup":
        this.vpOffset -= Math.floor(this.vpRows() / 2);
        break;
      case "g":
      case "home":
        this.vpOffset = 0;
        break;
      case "G":
      case "end":
        this.vpOffset = Number.MAX_SAFE_INTEGER;
        break;
    }
    this.clampVp();
    return [];
  }

  private keySprints(k: string): Cmd[] {
    switch (k) {
      case "esc":
      case "q":
      case "b":
        this.view = "list";
        break;
      case "j":
      case "down":
        if (this.sprintCursor < this.sprints.length - 1) this.sprintCursor++;
        break;
      case "k":
      case "up":
        if (this.sprintCursor > 0) this.sprintCursor--;
        break;
      case "enter": {
        const s = this.sprints[this.sprintCursor];
        if (s) {
          this.sprint = s;
          this.searching = false;
          if (this.scope === "company") this.scope = "team";
          this.view = "list";
          this.cursor = this.offset = 0;
          return [this.loadIssues()];
        }
        break;
      }
      case "?":
        this.help = true;
        break;
    }
    return [];
  }

  private keyBoards(k: string): Cmd[] {
    switch (k) {
      case "esc":
      case "q":
        if (this.cfg.board_id === 0) this.quit = true;
        else this.view = "list";
        break;
      case "j":
      case "down":
        if (this.boardCursor < this.boards.length - 1) this.boardCursor++;
        break;
      case "k":
      case "up":
        if (this.boardCursor > 0) this.boardCursor--;
        break;
      case "enter": {
        const b = this.boards[this.boardCursor];
        if (b) {
          this.cfg.board_id = b.id;
          this.cfg.board_name = b.name;
          try {
            saveConfig(this.cfg);
          } catch (e) {
            this.err = errStr(e);
          }
          this.view = "list";
          this.loading = true;
          this.cursor = this.offset = 0;
          return [this.loadActiveSprint()];
        }
        break;
      }
    }
    return [];
  }

  private keyTransition(k: string): Cmd[] {
    switch (k) {
      case "esc":
      case "q":
      case "s":
        this.view = this.prevView;
        break;
      case "j":
      case "down":
        if (this.trCursor < this.transitions.length - 1) this.trCursor++;
        break;
      case "k":
      case "up":
        if (this.trCursor > 0) this.trCursor--;
        break;
      case "enter": {
        const t = this.transitions[this.trCursor];
        if (t) {
          this.loading = true;
          return [this.doTransition(this.trKey, t)];
        }
        break;
      }
    }
    return [];
  }

  private keySearch(k: string): Cmd[] {
    switch (k) {
      case "esc":
        this.view = "list";
        return [];
      case "enter": {
        const q = this.input.trim();
        this.view = "list";
        if (!q) return [];
        this.searching = true;
        this.searchQuery = q;
        this.cursor = this.offset = 0;
        return [this.loadIssues()];
      }
      case "backspace":
        this.input = this.input.slice(0, -1);
        return [];
      case "ctrl+u":
        this.input = "";
        return [];
      default:
        if (k.length === 1 && this.input.length < 200) this.input += k;
        return [];
    }
  }

  // ---- helpers ----

  current(): Issue | undefined {
    return this.issues[this.cursor];
  }

  private move(d: number): void {
    this.cursor = Math.min(Math.max(0, this.cursor + d), Math.max(0, this.issues.length - 1));
    this.clampScroll();
  }

  /** Rows available for list bodies: header, blank, status line, footer. */
  listRows(): number {
    return Math.max(1, this.height - 4);
  }

  vpRows(): number {
    return Math.max(1, this.height - 4);
  }

  private clampScroll(): void {
    const rows = this.listRows();
    if (this.cursor < this.offset) this.offset = this.cursor;
    if (this.cursor >= this.offset + rows) this.offset = this.cursor - rows + 1;
    if (this.offset < 0) this.offset = 0;
  }

  private clampVp(): void {
    const max = Math.max(0, this.vpLines.length - this.vpRows());
    this.vpOffset = Math.min(Math.max(0, this.vpOffset), max);
  }
}
