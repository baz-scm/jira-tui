import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JiraClient, parseDate, pointsStr } from "./client.js";

let server: Server;
let client: JiraClient;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/rest/api/3/search/jql") {
        const { jql } = JSON.parse(body) as { jql: string };
        if (!jql) {
          res.statusCode = 400;
          res.end(`{"errorMessages":["jql required"]}`);
          return;
        }
        res.end(`{"isLast":true,"issues":[
         {"key":"CR-1","fields":{"summary":"Do thing","status":{"name":"In Progress","statusCategory":{"key":"indeterminate"}},
           "assignee":{"displayName":"Yuval"},"issuetype":{"name":"Story"},"customfield_10016":3,
           "created":"2026-09-01T10:00:00.000+0000","labels":["a"],"parent":{"key":"CR-0","fields":{"summary":"Epic"}}}},
         {"key":"CR-2","fields":{"summary":"Other","status":{"name":"Done","statusCategory":{"key":"done"}},"customfield_10016":null}}
        ]}`);
        return;
      }
      if (req.url === "/rest/api/3/issue/CR-1/transitions") {
        if (req.method === "POST") {
          res.statusCode = 204;
          res.end();
          return;
        }
        res.end(`{"transitions":[{"id":"31","name":"Done","to":{"name":"Done"}}]}`);
        return;
      }
      res.statusCode = 404;
      res.end("{}");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  client = new JiraClient({
    siteUrl: "https://x.atlassian.net",
    base: `http://127.0.0.1:${port}`,
    spFields: ["customfield_10016"],
  });
});

afterAll(() => server.close());

describe("JiraClient", () => {
  it("parses search results", async () => {
    const issues = await client.search("x", 100);
    expect(issues).toHaveLength(2);
    const i = issues[0]!;
    expect(i.key).toBe("CR-1");
    expect(i.status).toBe("In Progress");
    expect(i.statusCategory).toBe("indeterminate");
    expect(i.assignee).toBe("Yuval");
    expect(pointsStr(i.points)).toBe("3");
    expect(i.parent).toBe("CR-0  Epic");
    expect(i.created).not.toBeNull();
    expect(pointsStr(issues[1]!.points)).toBe("-");
    expect(client.issueUrl("CR-1")).toBe("https://x.atlassian.net/browse/CR-1");
  });

  it("surfaces API errors and runs transitions", async () => {
    await expect(client.search("", 10)).rejects.toThrow("HTTP 400: jql required");
    const ts = await client.transitions("CR-1");
    expect(ts).toEqual([{ id: "31", name: "Done", to: "Done" }]);
    await expect(client.transition("CR-1", "31")).resolves.toBeUndefined();
  });

  it("parses Jira's +0000 offsets", () => {
    expect(parseDate("2026-09-01T10:00:00.000+0000")?.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(parseDate("garbage")).toBeNull();
  });
});
