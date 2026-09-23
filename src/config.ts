import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Persisted at $XDG_CONFIG_HOME/jt/config.json (default ~/.config/jt). */
export interface Config {
  site_url: string;
  email: string;
  api_token: string;
  board_id: number;
  board_name: string;
  story_points_fields: string[];
  /** Values picked for required create fields (e.g. Squad), per project key then field id. */
  create_defaults: Record<string, Record<string, SavedOption>>;
}

export interface SavedOption {
  /** Field display name, for `jt defaults`. */
  field: string;
  id: string;
  value: string;
}

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  return xdg ? join(xdg, "jt") : join(homedir(), ".config", "jt");
}

export function configPath(): string {
  return join(configDir(), "config.json");
}

export function emptyConfig(): Config {
  return { site_url: "", email: "", api_token: "", board_id: 0, board_name: "", story_points_fields: [], create_defaults: {} };
}

export function loadConfig(): Config {
  let raw: string;
  try {
    raw = readFileSync(configPath(), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyConfig();
    throw e;
  }
  return { ...emptyConfig(), ...(JSON.parse(raw) as Partial<Config>) };
}

export function saveConfig(c: Config): void {
  mkdirSync(configDir(), { recursive: true, mode: 0o700 });
  writeFileSync(configPath(), JSON.stringify(c, null, 2) + "\n", { mode: 0o600 });
}

export function removeConfig(): void {
  rmSync(configPath(), { force: true });
}
