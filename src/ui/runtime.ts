import { parseKeys } from "./keys.js";
import type { Cmd, Model, Msg } from "./model.js";
import { view } from "./view.js";

const ENTER_ALT = "\x1b[?1049h\x1b[?25l";
const LEAVE_ALT = "\x1b[?25h\x1b[?1049l";

/** Drives a Model: raw stdin → keys, async commands → messages, redraw after each change. */
export async function run(m: Model): Promise<void> {
  const out = process.stdout;
  const inp = process.stdin;
  if (inp.isTTY) inp.setRawMode(true);
  inp.resume();
  inp.setEncoding("utf8");
  out.write(ENTER_ALT);

  let spinTimer: NodeJS.Timeout | null = null;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((r) => (resolveDone = r));

  const render = () => {
    const lines = view(m).split("\n").slice(0, Math.max(1, m.height));
    // Home the cursor and repaint each row, clearing to end of line — no full-screen flash.
    out.write("\x1b[H" + lines.map((l) => l + "\x1b[K").join("\n") + "\x1b[J");
  };

  const runCmds = (cmds: Cmd[]) => {
    for (const c of cmds) {
      void c().then((msg) => {
        if (msg) dispatch(msg);
      });
    }
  };

  const syncSpinner = () => {
    if (m.loading && !spinTimer) {
      spinTimer = setInterval(() => dispatch({ type: "tick" }), 80);
    } else if (!m.loading && spinTimer) {
      clearInterval(spinTimer);
      spinTimer = null;
    }
  };

  const after = (cmds: Cmd[]) => {
    if (m.quit) {
      finish();
      return;
    }
    runCmds(cmds);
    syncSpinner();
    render();
  };

  const dispatch = (msg: Msg) => {
    if (m.quit) return;
    after(m.update(msg));
  };

  const onData = (data: string) => {
    for (const k of parseKeys(data)) {
      if (m.quit) break;
      after(m.key(k));
    }
  };

  const onResize = () => {
    m.resize(out.columns || 80, out.rows || 24);
    render();
  };

  const finish = () => {
    if (spinTimer) clearInterval(spinTimer);
    inp.off("data", onData);
    out.off("resize", onResize);
    if (inp.isTTY) inp.setRawMode(false);
    inp.pause();
    out.write(LEAVE_ALT);
    resolveDone();
  };

  inp.on("data", onData);
  out.on("resize", onResize);
  m.resize(out.columns || 80, out.rows || 24);
  after(m.init());
  await done;
}
