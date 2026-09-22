/** Translate raw stdin bytes into key names ("j", "up", "enter", "ctrl+c", …). */

const SEQ: Record<string, string> = {
  "\x1b[A": "up",
  "\x1bOA": "up",
  "\x1b[B": "down",
  "\x1bOB": "down",
  "\x1b[C": "right",
  "\x1bOC": "right",
  "\x1b[D": "left",
  "\x1bOD": "left",
  "\x1b[H": "home",
  "\x1b[1~": "home",
  "\x1bOH": "home",
  "\x1b[F": "end",
  "\x1b[4~": "end",
  "\x1bOF": "end",
  "\x1b[5~": "pgup",
  "\x1b[6~": "pgdown",
  "\x1b[3~": "delete",
};

export function parseKeys(data: string): string[] {
  const keys: string[] = [];
  let i = 0;
  while (i < data.length) {
    const ch = data[i]!;
    if (ch === "\x1b") {
      // longest matching escape sequence
      let matched = false;
      for (let len = 4; len >= 2; len--) {
        const seq = data.slice(i, i + len);
        const name = SEQ[seq];
        if (name) {
          keys.push(name);
          i += len;
          matched = true;
          break;
        }
      }
      if (matched) continue;
      keys.push("esc");
      i++;
      continue;
    }
    const code = ch.charCodeAt(0);
    if (ch === "\r" || ch === "\n") keys.push("enter");
    else if (ch === "\t") keys.push("tab");
    else if (ch === "\x7f" || ch === "\b") keys.push("backspace");
    else if (code < 32) keys.push("ctrl+" + String.fromCharCode(code + 96));
    else keys.push(ch);
    i++;
  }
  return keys;
}
