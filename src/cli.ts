#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { configDir, loadConfig, removeConfig, saveConfig, type Config } from "./config.js";
import { JiraClient } from "./jira/client.js";
import { Model } from "./ui/model.js";
import { run } from "./ui/runtime.js";
import { renderDetailBody } from "./ui/view.js";

const usage = `jt — Jira in your terminal

  jt            open the TUI
  jt auth       re-enter site / email / API token
  jt board      pick a different board
  jt reset      remove config

Env overrides: JT_SITE, JT_EMAIL, JT_API_TOKEN
Config: ${configDir()}
`;

async function main(): Promise<void> {
  const cfg = loadConfig();
  const cmd = process.argv[2];

  switch (cmd) {
    case undefined:
      break;
    case "-h":
    case "--help":
    case "help":
      stdout.write(usage);
      return;
    case "reset":
      removeConfig();
      console.log("config removed");
      return;
    case "board":
      cfg.board_id = 0;
      cfg.board_name = "";
      saveConfig(cfg);
      break;
    case "auth":
    case "login":
      cfg.site_url = cfg.email = cfg.api_token = "";
      cfg.story_points_fields = [];
      await ensureCreds(cfg);
      console.log("saved");
      return;
    default:
      process.stderr.write(`unknown command "${cmd}"\n\n${usage}`);
      process.exit(2);
  }

  await ensureCreds(cfg);
  const client = new JiraClient({
    siteUrl: cfg.site_url,
    email: cfg.email,
    token: cfg.api_token,
    spFields: cfg.story_points_fields,
  });

  try {
    await client.myself();
  } catch (e) {
    die(`${e instanceof Error ? e.message : e}\n(check site/email/token — run \`jt auth\`)`);
  }
  if (cfg.story_points_fields.length === 0) {
    try {
      const ids = await client.discoverStoryPointFields();
      if (ids.length) {
        cfg.story_points_fields = ids;
        client.spFields = ids;
        saveConfig(cfg);
      }
    } catch {
      /* optional */
    }
  }

  await run(new Model(client, cfg, renderDetailBody));
}

async function ensureCreds(cfg: Config): Promise<void> {
  if (process.env.JT_SITE) cfg.site_url = process.env.JT_SITE;
  if (process.env.JT_EMAIL) cfg.email = process.env.JT_EMAIL;
  if (process.env.JT_API_TOKEN) cfg.api_token = process.env.JT_API_TOKEN;
  if (cfg.site_url && cfg.email && cfg.api_token) {
    cfg.site_url = normalizeSite(cfg.site_url);
    return;
  }
  stdout.write(`jt setup — needs an Atlassian API token:
  https://id.atlassian.com/manage-profile/security/api-tokens  →  Create API token

`);
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    if (!cfg.site_url) cfg.site_url = normalizeSite(await rl.question("Jira site (e.g. acme or acme.atlassian.net): "));
    if (!cfg.email) cfg.email = (await rl.question("Atlassian email: ")).trim();
    if (!cfg.api_token) cfg.api_token = (await rl.question("API token: ")).trim();
  } finally {
    rl.close();
  }
  if (!cfg.site_url || !cfg.email || !cfg.api_token) die("site, email and token are required");
  saveConfig(cfg);
}

export function normalizeSite(s: string): string {
  s = s.trim().replace(/\/+$/, "");
  if (!s) return "";
  if (!s.includes(".")) s += ".atlassian.net";
  if (!s.startsWith("http")) s = "https://" + s;
  return s;
}

function die(msg: string): never {
  process.stderr.write(`jt: ${msg}\n`);
  process.exit(1);
}

main().catch((e) => die(e instanceof Error ? e.message : String(e)));
