/** Atlassian Document Format → readable plain text. */

interface Mark {
  type: string;
  attrs?: Record<string, unknown>;
}

interface Node {
  type: string;
  text?: string;
  attrs?: Record<string, unknown>;
  content?: Node[];
  marks?: Mark[];
}

export function adfToText(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (!raw || typeof raw !== "object") return "";
  const doc = raw as Node;
  return renderBlocks(doc.content ?? [], "").trim();
}

function renderBlocks(nodes: Node[], indent: string): string {
  return nodes.map((n) => renderBlock(n, indent)).join("");
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function renderBlock(n: Node, indent: string): string {
  const content = n.content ?? [];
  const attrs = n.attrs ?? {};
  switch (n.type) {
    case "paragraph":
      return indent + inline(content) + "\n\n";
    case "heading": {
      const lvl = typeof attrs.level === "number" ? attrs.level : 1;
      return indent + "#".repeat(lvl) + " " + inline(content) + "\n\n";
    }
    case "bulletList":
      return content.map((li) => renderListItem(li, indent + "• ", indent + "  ")).join("") + "\n";
    case "orderedList":
      return content.map((li, i) => renderListItem(li, `${indent}${i + 1}. `, indent + "   ")).join("") + "\n";
    case "taskList":
      return (
        content
          .map((li) => indent + (li.attrs?.state === "DONE" ? "[x] " : "[ ] ") + inline(li.content ?? []) + "\n")
          .join("") + "\n"
      );
    case "codeBlock": {
      const lang = str(attrs.language);
      const lines = inline(content)
        .split("\n")
        .map((l) => indent + l + "\n")
        .join("");
      return indent + "```" + lang + "\n" + lines + indent + "```\n\n";
    }
    case "blockquote": {
      const inner = renderBlocks(content, "").trim();
      return inner.split("\n").map((l) => indent + "> " + l + "\n").join("") + "\n";
    }
    case "panel": {
      const kind = str(attrs.panelType).toUpperCase();
      const inner = renderBlocks(content, "").trim();
      return indent + "┌ " + kind + "\n" + inner.split("\n").map((l) => indent + "│ " + l + "\n").join("") + "\n";
    }
    case "rule":
      return indent + "────────────\n\n";
    case "table":
      return (
        content
          .map((row) => {
            const cells = (row.content ?? []).map((cell) =>
              renderBlocks(cell.content ?? [], "").split(/\s+/).filter(Boolean).join(" "),
            );
            return indent + "| " + cells.join(" | ") + " |\n";
          })
          .join("") + "\n"
      );
    case "mediaSingle":
    case "mediaGroup":
    case "media":
      return indent + "[attachment]\n\n";
    case "expand":
    case "nestedExpand":
      return indent + "▸ " + str(attrs.title) + "\n" + renderBlocks(content, indent + "  ");
    case "extension":
    case "bodiedExtension":
    case "inlineExtension":
      return indent + "[macro]\n\n";
    default:
      if (content.length === 0) return "";
      return isInlineOnly(content) ? indent + inline(content) + "\n\n" : renderBlocks(content, indent);
  }
}

function renderListItem(li: Node, bullet: string, cont: string): string {
  let out = "";
  let first = true;
  for (const c of li.content ?? []) {
    const text = renderBlock(c, "").replace(/\n+$/, "");
    text.split("\n").forEach((line, i) => {
      out += (first && i === 0 ? bullet : cont) + line + "\n";
    });
    first = false;
  }
  return out;
}

const INLINE_TYPES = new Set(["text", "hardBreak", "mention", "emoji", "inlineCard", "status", "date"]);

function isInlineOnly(nodes: Node[]): boolean {
  return nodes.every((n) => INLINE_TYPES.has(n.type));
}

function inline(nodes: Node[]): string {
  let out = "";
  for (const n of nodes) {
    const attrs = n.attrs ?? {};
    switch (n.type) {
      case "text": {
        let t = n.text ?? "";
        let href = "";
        for (const m of n.marks ?? []) {
          if (m.type === "code") t = "`" + t + "`";
          else if (m.type === "strong") t = "*" + t + "*";
          else if (m.type === "link") href = str(m.attrs?.href);
        }
        if (href && href !== n.text) t += ` (${href})`;
        out += t;
        break;
      }
      case "hardBreak":
        out += "\n";
        break;
      case "mention": {
        const t = str(attrs.text);
        if (t) out += t.startsWith("@") ? t : "@" + t;
        break;
      }
      case "emoji":
        out += str(attrs.text) || str(attrs.shortName);
        break;
      case "inlineCard":
        out += str(attrs.url);
        break;
      case "status":
        if (attrs.text) out += `[${str(attrs.text)}]`;
        break;
      case "date":
        out += str(attrs.timestamp);
        break;
      default:
        out += inline(n.content ?? []);
    }
  }
  return out;
}
