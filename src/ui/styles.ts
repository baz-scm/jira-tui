import { Chalk } from "chalk";
import stringWidth from "string-width";

// Explicit level so rendering is deterministic; the runtime bumps it for real TTYs.
export const chalk = new Chalk({ level: process.stdout.isTTY ? 3 : 0 });

const c = (n: number) => (s: string) => chalk.ansi256(n)(s);

export const dim = c(242);
export const key = c(39);
export const title = (s: string) => chalk.bold(s);
export const header = (s: string) => chalk.bold(chalk.ansi256(255)(s));
export const cursorBg = (s: string) => chalk.bgAnsi256(236)(s);
export const err = c(203);
export const flash = c(114);
export const hint = c(245);
export const hintKey = (s: string) => chalk.bold(chalk.ansi256(252)(s));
export const label = (s: string) => chalk.ansi256(245)(padRight(s, 10));
export const select = (s: string) => chalk.bold(chalk.ansi256(39)(s));

export const todo = c(250);
export const prog = c(214);
export const done = c(78);
export const pts = c(141);

const bug = c(203);
const story = c(78);
const task = c(39);
const epic = c(141);

export function sprintStateStyle(state: string): (s: string) => string {
  return state === "active" ? prog : state === "future" ? todo : dim;
}

export function statusStyle(cat: string): (s: string) => string {
  return cat === "indeterminate" ? prog : cat === "done" ? done : todo;
}

/** Fixed-width (5), colored abbreviation of the issue type. */
export function typeLabel(t: string): string {
  const l = t.toLowerCase();
  if (l.includes("bug") || l.includes("defect")) return bug("Bug  ");
  if (l.includes("story")) return story("Story");
  if (l.includes("epic")) return epic("Epic ");
  if (l.includes("sub")) return dim("Sub  ");
  if (l.includes("task")) return task("Task ");
  if (t === "") return "     ";
  return dim(padRight(truncate(t, 5, ""), 5));
}

// ---- width helpers (ANSI-aware) ----

export const width = stringWidth;

export function padRight(s: string, w: number): string {
  const d = w - width(s);
  return d > 0 ? s + " ".repeat(d) : s;
}

export function padLeft(s: string, w: number): string {
  const d = w - width(s);
  return d > 0 ? " ".repeat(d) + s : s;
}

/** Truncate plain text to `w` columns, appending `tail` if cut. */
export function truncate(s: string, w: number, tail = "…"): string {
  if (width(s) <= w) return s;
  const tw = width(tail);
  let out = "";
  let cw = 0;
  for (const ch of s) {
    const chw = width(ch);
    if (cw + chw > w - tw) break;
    out += ch;
    cw += chw;
  }
  return out + tail;
}

/** Word-wrap plain text to `w` columns, preserving existing newlines. */
export function wrap(s: string, w: number): string {
  if (w <= 0) return s;
  const out: string[] = [];
  for (let line of s.split("\n")) {
    while (width(line) > w) {
      let cut = w;
      const head = line.slice(0, Math.min(line.length, w));
      const i = head.lastIndexOf(" ");
      if (i > w / 2) cut = i;
      out.push(line.slice(0, cut));
      line = line.slice(cut).replace(/^ +/, "");
    }
    out.push(line);
  }
  return out.join("\n");
}

export function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}
