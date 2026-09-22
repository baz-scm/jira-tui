import { expect, it } from "vitest";
import { parseKeys } from "./keys.js";

it("parses printable, control and escape sequences", () => {
  expect(parseKeys("jk")).toEqual(["j", "k"]);
  expect(parseKeys("\x1b[A\x1b[B\r")).toEqual(["up", "down", "enter"]);
  expect(parseKeys("\x1b")).toEqual(["esc"]);
  expect(parseKeys("\x03\x04\x15")).toEqual(["ctrl+c", "ctrl+d", "ctrl+u"]);
  expect(parseKeys("\x7f")).toEqual(["backspace"]);
  expect(parseKeys("\x1b[5~\x1b[6~")).toEqual(["pgup", "pgdown"]);
});
