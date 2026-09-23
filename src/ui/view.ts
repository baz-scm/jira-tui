import { pointsStr } from "../jira/client.js";
import type { Model } from "./model.js";
import { scopeLabel } from "./model.js";
import {
  cursorBg,
  dim,
  err as errStyle,
  flash as flashStyle,
  header as headerStyle,
  hint,
  hintKey,
  key as keyStyle,
  label,
  padLeft,
  padRight,
  pts as ptsStyle,
  select,
  sprintStateStyle,
  statusStyle,
  title,
  truncate,
  typeLabel,
  width,
  wrap,
} from "./styles.js";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SEP = dim("  ·  ");

export function view(m: Model): string {
  if (m.width === 0) return "loading…";
  if (m.help) return renderHelp();
  switch (m.view) {
    case "detail":
      return renderDetail(m);
    case "sprints":
      return renderSprints(m);
    case "boards":
      return renderBoards(m);
    case "transition":
      return renderTransition(m);
    case "pick":
      return renderPick(m);
    default:
      return renderList(m);
  }
}

// ---- header/footer ----

function header(m: Model, t: string): string {
  const parts = [headerStyle("jt"), t];
  if (m.loading) parts.push(dim(SPINNER[m.spinFrame % SPINNER.length]!));
  return " " + parts.join(SEP);
}

function statusLine(m: Model): string {
  if (m.view === "search") return " " + dim("/ ") + m.input + "█";
  if (m.err) return " " + errStyle(truncate(m.err, m.width - 2));
  if (m.view === "create") {
    const pre = `new ${m.create?.type?.name.toLowerCase() ?? "issue"} › `;
    return " " + dim(pre) + tailFit(m.input, m.width - 3 - width(pre)) + "█";
  }
  if (m.flash) return " " + flashStyle(m.flash);
  return "";
}

/** Keep the end of `s` (where the cursor is) within `w` columns. */
function tailFit(s: string, w: number): string {
  if (width(s) <= w) return s;
  const chars = [...s];
  let out = "";
  for (let i = chars.length - 1; i >= 0 && width("…" + chars[i] + out) <= w; i--) out = chars[i] + out;
  return "…" + out;
}

function hints(...pairs: string[]): string {
  const out: string[] = [];
  for (let i = 0; i + 1 < pairs.length; i += 2) out.push(hintKey(pairs[i]!) + " " + hint(pairs[i + 1]!));
  return " " + out.join("  ");
}

function frame(m: Model, head: string, body: string, footer: string): string {
  const rows = m.height - 4;
  const lines = body.split("\n").slice(0, rows);
  while (lines.length < rows) lines.push("");
  return head + "\n\n" + lines.join("\n") + "\n" + statusLine(m) + "\n" + footer;
}

// ---- list ----

function listTitle(m: Model): string {
  if (m.searching) return `Search ${title(JSON.stringify(m.searchQuery))}`;
  let sp = "no active sprint";
  if (m.scope === "company") sp = "all open sprints";
  else if (m.sprint) {
    sp = m.sprint.name;
    if (m.sprint.state !== "active") sp += dim(` (${m.sprint.state})`);
  }
  return title(scopeLabel[m.scope]) + SEP + sp;
}

function renderList(m: Model): string {
  let count = dim(`${m.issues.length} issues`);
  if (m.cfg.board_name && m.scope !== "company" && !m.searching) count = dim(m.cfg.board_name) + SEP + count;
  const head = header(m, listTitle(m) + SEP + count);

  let body: string;
  if (m.issues.length === 0 && m.loading) body = " " + dim("loading…");
  else if (m.issues.length === 0 && !m.err) {
    const msg =
      !m.searching && !m.sprint && m.scope !== "company" && m.sprintLoaded
        ? "no active sprint on this board — press b to browse sprints, B to change board"
        : "no issues";
    body = " " + dim(msg);
  } else body = renderRows(m);

  let footer = hints("↑↓", "move", "⏎", "open", "s", "status", "n", "new", "m/t/c", "mine/team/company", "b", "sprints", "/", "search", "?", "help", "q", "quit");
  if (m.searching) footer = hints("↑↓", "move", "⏎", "open", "s", "status", "esc", "back", "/", "search", "?", "help", "q", "quit");
  if (m.view === "search") footer = hints("⏎", "search", "esc", "cancel");
  if (m.view === "create") footer = hints("⏎", "create (assigned to you, in this sprint)", "esc", "cancel");
  return frame(m, head, body, footer);
}

function renderRows(m: Model): string {
  let keyW = 6;
  let stW = 6;
  for (const is of m.issues) {
    keyW = Math.max(keyW, is.key.length);
    stW = Math.max(stW, width(is.status));
  }
  stW = Math.min(stW, 16);
  const ptsW = 3;
  const typeW = 5;
  const titleW = Math.max(10, m.width - 2 - typeW - 2 - keyW - 2 - stW - 2 - ptsW - 2 - 1);

  const rows = m.listRows();
  const end = Math.min(m.issues.length, m.offset + rows);
  const out: string[] = [];
  for (let i = m.offset; i < end; i++) {
    const is = m.issues[i]!;
    const st = padRight(truncate(is.status, stW), stW);
    const line = [
      typeLabel(is.type),
      keyStyle(padRight(is.key, keyW)),
      statusStyle(is.statusCategory)(st),
      ptsStyle(padLeft(pointsStr(is.points), ptsW)),
      truncate(is.summary, titleW),
    ].join("  ");
    out.push(i === m.cursor ? select("▸ ") + cursorBg(padRight(line, m.width - 2)) : "  " + line);
  }
  return out.join("\n");
}

// ---- detail ----

function renderDetail(m: Model): string {
  const is = m.detail;
  const head = header(
    m,
    keyStyle(is?.key ?? "") + SEP + statusStyle(is?.statusCategory ?? "")(is?.status ?? "") + SEP + `${m.cursor + 1}/${m.issues.length}`,
  );
  const footer = hints("↑↓", "scroll", "n/p", "next/prev", "s", "status", "o", "browser", "esc", "back", "?", "help");
  const rows = m.vpRows();
  const lines = m.vpLines.slice(m.vpOffset, m.vpOffset + rows);
  while (lines.length < rows) lines.push("");
  return head + "\n\n" + lines.join("\n") + "\n" + statusLine(m) + "\n" + footer;
}

export function renderDetailBody(m: Model): string {
  const is = m.detail;
  if (!is) return "";
  const w = Math.max(20, m.width - 2);
  const out: string[] = [];
  const row = (l: string, v: string) => {
    if (v) out.push(" " + label(l) + v);
  };
  out.push(" " + title(wrap(is.summary, w - 1)), "");
  row("Type", is.type);
  row("Status", statusStyle(is.statusCategory)(is.status));
  row("Points", pointsStr(is.points));
  row("Assignee", is.assignee || dim("unassigned"));
  row("Reporter", is.reporter);
  row("Priority", is.priority);
  if (is.labels.length) row("Labels", is.labels.join(", "));
  row("Parent", is.parent);
  if (is.created) row("Created", fmtDate(is.created));
  if (is.updated) row("Updated", fmtDate(is.updated, true));
  row("Link", dim(m.client.issueUrl(is.key)));
  out.push("", " " + dim("─".repeat(w - 1)), "");
  const desc = is.description || dim("no description");
  for (const line of wrap(desc, w - 1).split("\n")) out.push(" " + line);
  return out.join("\n") + "\n";
}

function fmtDate(d: Date, withTime = false): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  return withTime ? `${date} ${p(d.getHours())}:${p(d.getMinutes())}` : date;
}

// ---- sprints / boards / transitions ----

function windowStart(cursor: number, rows: number): number {
  return cursor >= rows ? cursor - rows + 1 : 0;
}

function renderSprints(m: Model): string {
  const head = header(m, title("Sprints") + dim("  ·  " + m.cfg.board_name));
  const rows = m.listRows();
  const start = windowStart(m.sprintCursor, rows);
  const out: string[] = [];
  for (let i = start; i < m.sprints.length && i < start + rows; i++) {
    const s = m.sprints[i]!;
    const st = sprintStateStyle(s.state)(padRight(s.state, 6));
    const dates = s.startDate ? dim(`  ${s.startDate.slice(0, 10)} → ${(s.endDate ?? "").slice(0, 10)}`) : "";
    const mark = m.sprint && s.id === m.sprint.id ? dim("• ") : "  ";
    const line = `${mark}${st}  ${s.name}${dates}`;
    out.push(i === m.sprintCursor ? select("▸ ") + cursorBg(line) : "  " + line);
  }
  if (m.sprints.length === 0) out.push(" " + dim("no sprints"));
  return frame(m, head, out.join("\n"), hints("↑↓", "move", "⏎", "select", "esc", "back"));
}

function renderBoards(m: Model): string {
  const head = header(m, title("Select board"));
  const rows = m.listRows();
  const start = windowStart(m.boardCursor, rows);
  const out: string[] = [];
  for (let i = start; i < m.boards.length && i < start + rows; i++) {
    const b = m.boards[i]!;
    const line = `${padRight(String(b.id), 5)} ${b.name}`;
    out.push(i === m.boardCursor ? select("▸ ") + cursorBg(line) : "  " + line);
  }
  if (m.boards.length === 0 && !m.loading) out.push(" " + dim("no boards visible"));
  return frame(m, head, out.join("\n"), hints("↑↓", "move", "⏎", "select", "esc", "back"));
}

function renderTransition(m: Model): string {
  const head = header(m, title("Change status") + SEP + keyStyle(m.trKey));
  const out = m.transitions.map((t, i) => {
    let line = t.name;
    if (t.to && t.to !== t.name) line += dim("  → " + t.to);
    return i === m.trCursor ? select("▸ ") + line : "  " + line;
  });
  return frame(m, head, out.join("\n"), hints("↑↓", "move", "⏎", "apply", "esc", "cancel"));
}

function renderPick(m: Model): string {
  let t = title(m.pickTitle);
  // Past the type step, picks are required fields that get remembered.
  if (m.create?.type) t += SEP + dim("saved for next time · `jt defaults` to reset");
  const head = header(m, t);
  const rows = m.listRows();
  const start = windowStart(m.pickCursor, rows);
  const out: string[] = [];
  for (let i = start; i < m.pickItems.length && i < start + rows; i++) {
    const line = m.pickItems[i]!;
    out.push(i === m.pickCursor ? select("▸ ") + cursorBg(line) : "  " + line);
  }
  return frame(m, head, out.join("\n"), hints("↑↓", "move", "⏎", "select", "esc", "cancel"));
}

// ---- help ----

function renderHelp(): string {
  const out: string[] = [" " + headerStyle("jt") + dim("  ·  keyboard shortcuts"), ""];
  const section = (t: string, rows: [string, string][]) => {
    out.push(" " + title(t));
    for (const [k, v] of rows) out.push(`   ${hintKey(padRight(k, 9))}  ${hint(v)}`);
    out.push("");
  };
  section("List", [
    ["j / k", "move down / up  (↑↓, g/G top/bottom, ^d/^u half page)"],
    ["enter", "open issue details"],
    ["s", "change status of selected issue"],
    ["n", "new issue in this sprint, assigned to you"],
    ["m", "my issues in current sprint (default)"],
    ["t", "all team issues in current sprint (board)"],
    ["c", "all company issues in any open sprint"],
    ["b", "browse sprints on the board"],
    ["B", "change board"],
    ["/", "search whole workspace (text or issue key)"],
    ["esc", "leave search results"],
    ["r", "refresh"],
    ["o", "open in browser"],
    ["q", "quit"],
  ]);
  section("Details", [
    ["j / k", "scroll"],
    ["n / p", "next / previous issue"],
    ["s", "change status"],
    ["o", "open in browser"],
    ["esc", "back to list"],
  ]);
  out.push(" " + dim("press ? or esc to close"));
  return out.join("\n");
}
