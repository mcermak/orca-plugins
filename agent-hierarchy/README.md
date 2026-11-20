# Agent Hierarchy

An Orca sidebar panel that shows **which agents and subagents belong to one parent** when a change
is spread across multiple repos. It reads Orca's own worktree lineage and the agents running in each
worktree, and draws the forest as a tree.

## What it shows

```
contacts / orchestrator        feat/cross-repo
  ├─ 🤖 Lead change             claude · ● working
  ├─ integrations / int-4527    int-4527 · PR #1375
  │    └─ 🤖 Wire contract      claude · ● working
  └─ phone / fix-csp            fix-csp
       └─ 🤖 CSP header         codex · ✓ done
```

- Each **worktree** is a node (repo / name, with its branch, linked PR, host and status).
- Child worktrees — the ones Orca records when you fan a change out with
  `orca worktree create --parent-worktree …` (orchestration does this automatically) — nest under
  their parent.
- Each **agent** (chat or terminal) running in a worktree appears as a leaf with its live state
  (`working` / `blocked` / `waiting` / `done`).
- Each first-level row leads with the **PR status**: `PR: N/A · Draft · Open · Comments · Approved`
  (plus `Merged` / `Closed`). `Comments` means a reviewer commented or requested changes.
- When a finish-task loop is running, its phase follows: `CodeRabbit (round N)` · `Review requested` ·
  `In review (r·c)` · `Needs human` · `Ready to merge`, with a `· CI ✗` marker when checks fail. The
  node icon + dot reflect this overall status; the detail card shows both as colored badges.

Status is shown two ways at once (shape + color, not color alone): a per-node **icon**
(`check` ready · `search` in review · `bell` review requested · `bot` CodeRabbit · `flag` needs human ·
`error` CI failing · `file` draft/readying) and a colored **dot** in the label
(🟢 success · 🟠 warning · 🔴 danger · 🔵 in progress · ⚪ neutral). Agent leaves carry a state dot too
(🔵 working · 🟠 waiting · 🔴 blocked · 🟢 done).

**Detail + links:** select a node to open a detail card with the PR state, mergeability, review
decision, CI tally, and buttons to **Open PR** and **Open Slack thread** (the review-request thread
finish-task posted). The Slack link needs `finish-task` to record the channel (see below).

**Active & linked** (default) hides idle standalone repos and shows only worktrees that run an agent
or sit in a parent/child tree. **All worktrees** shows everything. The panel reloads itself on
`agent.status.changed` and `workspace.changed`, and has a manual Refresh.

**Navigate:** double-click (or select + Enter) any node to jump to it. On an agent, the panel focuses
that agent's exact terminal pane; if it can't be resolved (e.g. a chat agent with no terminal), it
opens the agent's workspace instead. A worktree node opens that workspace.

## How it works

Orca's plugin host API exposes workspaces (`workspace.list`) and agents (`agents.list`) but **not**
the worktree lineage. Only the CLI carries `parentWorktreeId` / `childWorktreeIds`, so the
`trusted-worker` (`src/worker.ts`) shells out to `orca worktree list --json` and
`orca agent list --json`, joins agents onto worktrees by id, and builds the forest
(`src/forest.ts`, pure and unit-tested). The components panel (`src/panel.tsx`) renders it with the
native `Tree` component.

PR + loop status is enrichment, added per worktree (bounded to the ones with a PR link or a live
agent, cap `ENRICH_CAP = 40`):

- **PR** — `gh pr view --json number,url,state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup`,
  run in the worktree.
- **Loop** — read from `~/.claude/finish-task/<owner>__<name>/<pr>/state.json` (the finish-task
  skill's state), for `phase`, round counters, `needs_human`, and the Slack review-request.
- **Slack thread** — built from `review_request.permalink`, else `channel` + `message_ts`. This
  requires the small `finish-task` patch that records `channel`/`permalink` when it posts the review
  request (state files written before that patch have no channel, so the link is omitted for them).

## Develop

```sh
orca plugin dev watch . --check --shot ./.orca/shots   # live reload + render checks + screenshots
orca plugin test .                                      # unit tests (forest logic + panel render)
orca plugin check .                                     # render every scenario in src/panel.check.ts
orca plugin open local.agent-hierarchy --panel agent-hierarchy
```

## Capabilities

- `trusted-worker` — the worker runs Node and invokes the `orca` CLI to read lineage.
- `agent:read`, `workspace:read` — so the panel reloads on agent/workspace events (read-only).
- `workspace:write` — to focus a terminal / open a workspace when you click a node (navigation only;
  the plugin calls `terminal.focus` and `workspace.open`, nothing else). Desktop app only.
- `storage:own` — remembers the filter and which nodes are expanded.

## Known limits / next steps

- Lineage only appears once worktrees are created with a parent (orchestration / `--parent-worktree`).
  A flat set of top-level repos shows as separate roots.
- Scope is the local host (plus SSH targets on the same runtime). Paired environments would need a
  per-environment `orca … --environment` pass.
- If Orca later exposes lineage in the host API, the worker can drop the CLI shell-out.
