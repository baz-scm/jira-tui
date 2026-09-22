import { describe, expect, it } from "vitest";
import { adfToText } from "./adf.js";

describe("adfToText", () => {
  it("renders headings, marks, mentions, lists, code and links", () => {
    const doc = JSON.parse(`{"type":"doc","version":1,"content":[
     {"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Goal"}]},
     {"type":"paragraph","content":[{"type":"text","text":"Fix "},{"type":"text","text":"login","marks":[{"type":"code"}]},{"type":"text","text":" for "},{"type":"mention","attrs":{"text":"@Dana"}}]},
     {"type":"bulletList","content":[
       {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]},
       {"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"two"}]},
         {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"nested"}]}]}]}]}
     ]},
     {"type":"codeBlock","attrs":{"language":"go"},"content":[{"type":"text","text":"x := 1\\ny := 2"}]},
     {"type":"paragraph","content":[{"type":"text","text":"docs","marks":[{"type":"link","attrs":{"href":"https://x.y"}}]}]}
    ]}`);
    const got = adfToText(doc);
    for (const want of ["## Goal", "Fix `login` for @Dana", "• one", "• two", "  • nested", "```go\nx := 1\ny := 2\n```", "docs (https://x.y)"]) {
      expect(got).toContain(want);
    }
  });

  it("passes legacy plain strings through", () => {
    expect(adfToText("legacy wiki text")).toBe("legacy wiki text");
  });
});
