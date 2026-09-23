import { adfToText } from "./adf.js";

export interface Issue {
  key: string;
  summary: string;
  type: string;
  status: string;
  /** new | indeterminate | done */
  statusCategory: string;
  assignee: string;
  reporter: string;
  priority: string;
  points: number | null;
  labels: string[];
  parent: string;
  created: Date | null;
  updated: Date | null;
  description: string;
}

export interface Sprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  goal?: string;
}

export interface Board {
  id: number;
  name: string;
  type: string;
}

export interface Transition {
  id: string;
  name: string;
  to: string;
}

export interface IssueType {
  id: string;
  name: string;
}

export interface FieldOption {
  id: string;
  value: string;
}

/** A field on the create screen for one project + issue type. */
export interface CreateField {
  id: string;
  name: string;
  required: boolean;
  hasDefault: boolean;
  /** schema.type is "array": value must be sent as a list. */
  array: boolean;
  /** schema.custom, e.g. "com.pyxis.greenhopper.jira:gh-sprint". */
  custom: string;
  options: FieldOption[];
}

export const SPRINT_CUSTOM = "com.pyxis.greenhopper.jira:gh-sprint";

export interface Me {
  accountId: string;
  displayName: string;
}

export interface ClientOptions {
  siteUrl: string;
  email?: string;
  token?: string;
  spFields?: string[];
  /** Override the request base (tests). Defaults to siteUrl. */
  base?: string;
  timeoutMs?: number;
}

export function pointsStr(p: number | null): string {
  if (p === null) return "-";
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}

export class JiraError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Json = Record<string, unknown>;

export class JiraClient {
  readonly siteUrl: string;
  spFields: string[];
  private readonly base: string;
  private readonly authHeader: string | null;
  private readonly timeoutMs: number;

  constructor(o: ClientOptions) {
    this.siteUrl = o.siteUrl.replace(/\/+$/, "");
    this.base = (o.base ?? this.siteUrl).replace(/\/+$/, "");
    this.spFields = o.spFields ?? [];
    this.timeoutMs = o.timeoutMs ?? 30_000;
    this.authHeader =
      o.email && o.token ? "Basic " + Buffer.from(`${o.email}:${o.token}`).toString("base64") : null;
  }

  issueUrl(key: string): string {
    return `${this.siteUrl}/browse/${key}`;
  }

  private async do<T>(method: string, path: string, query?: Record<string, string>, body?: unknown): Promise<T> {
    let url = this.base + path;
    if (query && Object.keys(query).length) url += "?" + new URLSearchParams(query).toString();
    const headers: Record<string, string> = { Accept: "application/json" };
    if (this.authHeader) headers.Authorization = this.authHeader;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const resp = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });
    const text = await resp.text();
    if (resp.status >= 300) {
      let msgs: string[] = [];
      try {
        const ae = JSON.parse(text) as { errorMessages?: string[]; errors?: Record<string, string> };
        msgs = [...(ae.errorMessages ?? []), ...Object.entries(ae.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
      } catch {
        /* not json */
      }
      if (msgs.length === 0) msgs = [text.trim()];
      if (resp.status === 401) msgs.unshift("unauthorized — check email/API token (run `jt auth`)");
      throw new JiraError(resp.status, `HTTP ${resp.status}: ${msgs.join("; ")}`);
    }
    return (text.length ? JSON.parse(text) : undefined) as T;
  }

  myself(): Promise<Me> {
    return this.do<Me>("GET", "/rest/api/3/myself");
  }

  private async paged<T>(path: string, extra: Record<string, string> = {}): Promise<T[]> {
    const all: T[] = [];
    let start = 0;
    for (;;) {
      const page = await this.do<{ values?: T[]; isLast?: boolean }>("GET", path, {
        ...extra,
        startAt: String(start),
        maxResults: "50",
      });
      const values = page.values ?? [];
      all.push(...values);
      if (page.isLast || values.length === 0) break;
      start += values.length;
    }
    return all;
  }

  async boards(): Promise<Board[]> {
    const all = await this.paged<Board>("/rest/agile/1.0/board");
    return all.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** Board sprints: active first, then future, then closed (newest first). */
  async sprints(boardId: number): Promise<Sprint[]> {
    const all = await this.paged<Sprint>(`/rest/agile/1.0/board/${boardId}/sprint`);
    const rank: Record<string, number> = { active: 0, future: 1, closed: 2 };
    return all.sort((a, b) => {
      const ra = rank[a.state] ?? 3;
      const rb = rank[b.state] ?? 3;
      if (ra !== rb) return ra - rb;
      const sa = a.startDate ?? "";
      const sb = b.startDate ?? "";
      return a.state === "closed" ? sb.localeCompare(sa) : sa.localeCompare(sb);
    });
  }

  async activeSprint(boardId: number): Promise<Sprint | null> {
    const page = await this.do<{ values?: Sprint[] }>("GET", `/rest/agile/1.0/board/${boardId}/sprint`, {
      state: "active",
    });
    return page.values?.[0] ?? null;
  }

  private fields(withDesc: boolean): string[] {
    const f = ["summary", "status", "assignee", "issuetype", "priority", "reporter", "created", "updated", "labels", "parent"];
    if (withDesc) f.push("description");
    return [...f, ...this.spFields];
  }

  /** Runs JQL via /search/jql, following pages up to `max` issues. Falls back if the site rejects Rank ordering. */
  async search(jql: string, max: number): Promise<Issue[]> {
    try {
      return await this.searchPages(jql, max);
    } catch (e) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      const i = jql.indexOf(" ORDER BY");
      if (msg.includes("rank") && i > 0) return this.searchPages(jql.slice(0, i) + " ORDER BY updated DESC", max);
      throw e;
    }
  }

  private async searchPages(jql: string, max: number): Promise<Issue[]> {
    const out: Issue[] = [];
    let token = "";
    for (;;) {
      const body: Json = { jql, fields: this.fields(false), maxResults: 100 };
      if (token) body.nextPageToken = token;
      const page = await this.do<{ issues?: RawIssue[]; nextPageToken?: string; isLast?: boolean }>(
        "POST",
        "/rest/api/3/search/jql",
        undefined,
        body,
      );
      for (const r of page.issues ?? []) out.push(this.parse(r));
      if (page.isLast || !page.nextPageToken || out.length >= max) break;
      token = page.nextPageToken;
    }
    return out;
  }

  async issue(key: string): Promise<Issue> {
    const r = await this.do<RawIssue>("GET", `/rest/api/3/issue/${key}`, { fields: this.fields(true).join(",") });
    return this.parse(r);
  }

  async transitions(key: string): Promise<Transition[]> {
    const resp = await this.do<{ transitions?: { id: string; name: string; to?: { name?: string } }[] }>(
      "GET",
      `/rest/api/3/issue/${key}/transitions`,
    );
    return (resp.transitions ?? []).map((t) => ({ id: t.id, name: t.name, to: t.to?.name ?? "" }));
  }

  async transition(key: string, id: string): Promise<void> {
    await this.do<void>("POST", `/rest/api/3/issue/${key}/transitions`, undefined, { transition: { id } });
  }

  /** Project key of the board's location, or "" for boards not tied to one project. */
  async boardProject(boardId: number): Promise<string> {
    const b = await this.do<{ location?: { projectKey?: string } }>("GET", `/rest/agile/1.0/board/${boardId}`);
    return b.location?.projectKey ?? "";
  }

  /** Non-subtask issue types creatable in `project`. */
  async createIssueTypes(project: string): Promise<IssueType[]> {
    const resp = await this.do<{ issueTypes?: RawType[]; values?: RawType[] }>(
      "GET",
      `/rest/api/3/issue/createmeta/${project}/issuetypes`,
      { maxResults: "200" },
    );
    return (resp.issueTypes ?? resp.values ?? []).filter((t) => !t.subtask).map((t) => ({ id: t.id, name: t.name }));
  }

  async createFields(project: string, typeId: string): Promise<CreateField[]> {
    const out: CreateField[] = [];
    let start = 0;
    for (;;) {
      const page = await this.do<{ fields?: RawField[]; values?: RawField[]; total?: number }>(
        "GET",
        `/rest/api/3/issue/createmeta/${project}/issuetypes/${typeId}`,
        { startAt: String(start), maxResults: "200" },
      );
      const fields = page.fields ?? page.values ?? [];
      for (const f of fields) {
        out.push({
          id: f.fieldId,
          name: f.name,
          required: f.required === true,
          hasDefault: f.hasDefaultValue === true,
          array: f.schema?.type === "array",
          custom: f.schema?.custom ?? "",
          options: (f.allowedValues ?? []).map((v) => ({ id: String(v.id), value: v.value ?? v.name ?? String(v.id) })),
        });
      }
      start += fields.length;
      if (fields.length === 0 || start >= (page.total ?? 0)) break;
    }
    return out;
  }

  /** Creates an issue and returns its key. */
  async createIssue(fields: Record<string, unknown>): Promise<string> {
    const r = await this.do<{ key: string }>("POST", "/rest/api/3/issue", undefined, { fields });
    return r.key;
  }

  async addToSprint(sprintId: number, key: string): Promise<void> {
    await this.do<void>("POST", `/rest/agile/1.0/sprint/${sprintId}/issue`, undefined, { issues: [key] });
  }

  /** Custom field ids named like story points. */
  async discoverStoryPointFields(): Promise<string[]> {
    const fields = await this.do<{ id: string; name: string }[]>("GET", "/rest/api/3/field");
    const names = new Set(["story points", "story point estimate", "story points estimate"]);
    return fields.filter((f) => names.has(f.name.toLowerCase())).map((f) => f.id);
  }

  // ---- parsing ----

  private parse(r: RawIssue): Issue {
    const f = r.fields ?? {};
    const status = f.status as { name?: string; statusCategory?: { key?: string } } | undefined;
    const parent = f.parent as { key?: string; fields?: { summary?: string } } | undefined;
    let points: number | null = null;
    for (const id of this.spFields) {
      const v = f[id];
      if (typeof v === "number") {
        points = v;
        break;
      }
    }
    const desc = f.description;
    return {
      key: r.key,
      summary: typeof f.summary === "string" ? f.summary : "",
      type: nameOf(f.issuetype),
      status: status?.name ?? "",
      statusCategory: status?.statusCategory?.key ?? "",
      assignee: displayName(f.assignee),
      reporter: displayName(f.reporter),
      priority: nameOf(f.priority),
      points,
      labels: Array.isArray(f.labels) ? (f.labels as string[]) : [],
      parent: parent?.key ? `${parent.key}  ${parent.fields?.summary ?? ""}` : "",
      created: parseDate(f.created),
      updated: parseDate(f.updated),
      description: desc === undefined || desc === null ? "" : adfToText(desc),
    };
  }
}

interface RawIssue {
  key: string;
  fields?: Record<string, unknown>;
}

interface RawType {
  id: string;
  name: string;
  subtask?: boolean;
}

interface RawField {
  fieldId: string;
  name: string;
  required?: boolean;
  hasDefaultValue?: boolean;
  schema?: { type?: string; custom?: string };
  allowedValues?: { id: string | number; value?: string; name?: string }[];
}

function nameOf(v: unknown): string {
  return (v as { name?: string } | undefined)?.name ?? "";
}

function displayName(v: unknown): string {
  return (v as { displayName?: string } | undefined)?.displayName ?? "";
}

/** Jira emits "2026-09-01T10:00:00.000+0000"; JS wants "+00:00". */
export function parseDate(v: unknown): Date | null {
  if (typeof v !== "string" || !v) return null;
  const d = new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(d.getTime()) ? null : d;
}
