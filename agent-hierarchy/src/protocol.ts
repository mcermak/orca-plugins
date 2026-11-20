// The panel <-> worker contract, declared once: src/panel.tsx and src/worker.ts both read it.
export {}

/** One agent (chat or terminal) running inside a worktree. */
export type AgentNode = {
  sessionId: string
  agent: string | null
  kind: string
  state: 'working' | 'blocked' | 'waiting' | 'done' | string
  title: string | null
}

/** The open PR for a worktree's branch, from `gh`. */
export type PrInfo = {
  number: number
  url: string
  state: string // OPEN | MERGED | CLOSED
  isDraft: boolean
  reviewDecision: string | null // APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null
  mergeable: string | null // CLEAN | BLOCKED | DIRTY | UNSTABLE | BEHIND | UNKNOWN
  checks: { passed: number; failed: number; pending: number } | null
  commented: boolean // a reviewer left comments or requested changes (not just approvals)
}

/** The finish-task loop state for a PR, from ~/.claude/finish-task/<slug>/<pr>/state.json. */
export type LoopInfo = {
  phase: string // readying | rabbit_loop | review_requested | review_loop | done | parked
  parkedFrom: string | null
  rabbitRounds: number
  reviewCycles: number
  needsHuman: number
  reviewRequestedAt: string | null
  slackUrl: string | null
}

/** One Orca-managed worktree, with its agents and its place in the lineage. */
export type WorktreeNode = {
  id: string
  displayName: string
  repo: string | null
  branch: string | null
  host: string | null
  status: string | null
  linkedPR: number | null
  parentId: string | null
  childIds: string[]
  agents: AgentNode[]
  pr: PrInfo | null
  loop: LoopInfo | null
}

/** The whole forest: a node map plus the ids that have no (resolvable) parent. */
export type Forest = {
  roots: string[]
  nodes: Record<string, WorktreeNode>
  generatedAt: number
  stats: { worktrees: number; agents: number; roots: number; withLineage: number }
  error?: string
}

declare module 'orca' {
  interface PluginRequests {
    /** Build the worktree/agent forest from the Orca CLI. */
    'hierarchy.get': { output: Forest }
    /** Focus an agent's terminal (if resolvable), else open its workspace. */
    'navigate.focus': {
      input: { worktreeId: string; sessionId?: string }
      output: { ok: boolean; via: 'terminal' | 'workspace' | 'none'; error?: string }
    }
  }
  // No worker->panel posts yet; the panel reloads on Orca's own agent/workspace events.
  interface PluginPanelEvents {}
}
