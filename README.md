# jt — Jira in your terminal

Minimal TUI for your Jira sprint. Shows issues assigned to you in the active sprint by default; switch to team/company scope, browse sprints, search the workspace, open issue details, change status.

```
 jt  ·  Mine  ·  Sprint 42  ·  Fixer  ·  7 issues

▸ Story  CR-1412  In Progress    5  Fixer: retry on sandbox timeout
  Bug    CR-1398  To Do          3  Add ADO thread resolution
  Task   CR-1377  Done           2  Skills manager: skip archived repos

 ↑↓ move  ⏎ open  s status  m/t/c mine/team/company  b sprints  / search  ? help  q quit
```

## Install

Requires Node.js 20+.

```sh
npm install -g @baz-scm/jira-tui     # then run: jt
```

Or run without installing:

```sh
npx @baz-scm/jira-tui
```

## One-time setup

1. Create an API token: <https://id.atlassian.com/manage-profile/security/api-tokens>.
2. Run `jt`. Enter your site (`acme` or `acme.atlassian.net`), Atlassian email, and the token. Or set `JT_SITE`, `JT_EMAIL`, `JT_API_TOKEN`.
3. Pick your scrum board. Done.

Config lives in `~/.config/jt/config.json` (mode 0600, contains the token).

## Keys

| Key | List | Key | Details |
|---|---|---|---|
| `j`/`k` `↑`/`↓` | move | `j`/`k` | scroll |
| `⏎` | open issue | `n`/`p` | next / prev issue |
| `s` | change status | `s` | change status |
| `m` `t` `c` | mine / team / company (open sprints) | `o` | open in browser |
| `b` | browse sprints on board | `esc` | back |
| `B` | change board | | |
| `/` | search workspace (text or issue key) | | |
| `esc` | leave search results | | |
| `r` | refresh | | |
| `o` | open in browser | | |
| `?` | full help | | |
| `q` | quit | | |

## Commands

```
jt          open the TUI
jt auth     re-enter site / email / token
jt board    pick a different board
jt reset    drop config
```

## Development

```sh
npm install
npm run dev        # run from source
npm test           # vitest
npm run build      # emit dist/
```

## Release

Bump `version` in `package.json` and merge to `main`. The **Release** workflow runs on every push to `main`; when the version isn't on npm yet it publishes via Trusted Publishing (OIDC, no token), tags `vX.Y.Z`, and creates a GitHub release. Merges without a bump are no-ops.
