// Pure forest assembly, kept out of worker.ts so it can be unit-tested without the orca CLI.
import type { AgentNode, Forest, LoopInfo, PrInfo, WorktreeNode } from './protocol.ts'

// `github:cloudtalk-io/contacts` -> `contacts`; forge-style ids only. A local `repo:<uuid>` id has
// no human name, so this returns null and the caller falls back to the path basename.
export function repoName(projectId: string | null | undefined): string | null {
  if (!projectId) return null
  const slash = projectId.lastIndexOf('/')
  return slash >= 0 ? projectId.slice(slash + 1) : null
}

// The repo's human name: from the forge id when it has one, else the worktree path's last segment.
export function deriveRepo(projectId: string | null | undefined, path: string | null | undefined): string | null {
  const fromId = repoName(projectId)
  if (fromId) return fromId
  if (!path) return null
  const trimmed = path.replace(/[/\\]+$/, '')
  const seg = trimmed.split(/[/\\]/).pop()
  return seg || null
}

// Shape of the rows `orca worktree list --json` / `orca agent list --json` return (the fields used).
export type RawWorktree = {
  id: string
  displayName?: string
  projectId?: string | null
  path?: string
  branch?: string | null
  hostId?: string | null
  workspaceStatus?: string | null
  linkedPR?: number | null
  parentWorktreeId?: string | null
  childWorktreeIds?: string[] | null
}
export type RawAgent = {
  orcaSessionId: string
  worktreeId?: string
  agent?: string | null
  kind?: string
  state?: string
  title?: string | null
}

export function buildForest(worktrees: RawWorktree[], agents: RawAgent[], now: number): Forest {
  const forest: Forest = {
    roots: [],
    nodes: {},
    generatedAt: now,
    stats: { worktrees: 0, agents: 0, roots: 0, withLineage: 0 }
  }

  const agentsByWorktree: Record<string, AgentNode[]> = {}
  for (const a of agents) {
    const wid = a.worktreeId
    if (!wid) continue
    ;(agentsByWorktree[wid] ||= []).push({
      sessionId: a.orcaSessionId,
      agent: a.agent ?? null,
      kind: a.kind ?? 'chat',
      state: a.state ?? 'done',
      title: a.title ?? null
    })
  }

  for (const w of worktrees) {
    const node: WorktreeNode = {
      id: w.id,
      displayName: w.displayName || deriveRepo(w.projectId, w.path) || w.path || w.id,
      repo: deriveRepo(w.projectId, w.path),
      branch: typeof w.branch === 'string' ? w.branch.replace('refs/heads/', '') : null,
      host: w.hostId ?? null,
      status: w.workspaceStatus ?? null,
      linkedPR: w.linkedPR ?? null,
      parentId: w.parentWorktreeId ?? null,
      childIds: Array.isArray(w.childWorktreeIds) ? w.childWorktreeIds : [],
      agents: agentsByWorktree[w.id] ?? [],
      pr: null,
      loop: null
    }
    forest.nodes[node.id] = node
  }

  // A root is anything whose parent is absent or not in this set (keeps orphans visible).
  for (const id of Object.keys(forest.nodes)) {
    const n = forest.nodes[id]
    if (!n.parentId || !forest.nodes[n.parentId]) forest.roots.push(id)
    else forest.stats.withLineage++
  }

  forest.stats.worktrees = worktrees.length
  forest.stats.agents = agents.length
  forest.stats.roots = forest.roots.length
  return forest
}

// ---- PR + loop enrichment (pure parsers; the worker feeds them gh/fs output) ----

export type StatusTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'
// `icon` is an Orca IconName (typed loosely here so forest.ts stays UI-free).
export type Status = { label: string; tone: StatusTone; icon: string }

const TONE_DOT: Record<StatusTone, string> = {
  danger: '🔴',
  warning: '🟠',
  success: '🟢',
  accent: '🔵',
  neutral: '⚪'
}
export function toneDot(tone: StatusTone): string {
  return TONE_DOT[tone]
}

// A colored dot for an agent's live state, so leaves read at a glance too.
export function agentStateDot(state: string): string {
  if (state === 'working') return '🔵'
  if (state === 'blocked') return '🔴'
  if (state === 'waiting') return '🟠'
  if (state === 'done') return '🟢'
  return '⚪'
}

// `https://github.com/CloudTalk-io/contacts/pull/394` -> { owner, name } (case preserved).
export function ownerRepoFromUrl(url: string | undefined): { owner: string; name: string } | null {
  if (!url) return null
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/)
  return m ? { owner: m[1], name: m[2] } : null
}

export function summarizeChecks(
  rollup: unknown
): { passed: number; failed: number; pending: number } | null {
  if (!Array.isArray(rollup)) return null
  let passed = 0
  let failed = 0
  let pending = 0
  for (const c of rollup) {
    const s = String(c?.conclusion || c?.state || '').toUpperCase()
    if (['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(s)) passed++
    else if (['FAILURE', 'ERROR', 'CANCELLED', 'TIMED_OUT', 'ACTION_REQUIRED', 'STARTUP_FAILURE'].includes(s)) failed++
    else pending++
  }
  return { passed, failed, pending }
}

export function prFromGh(raw: any): PrInfo {
  const reviews = Array.isArray(raw.reviews) ? raw.reviews : []
  const commented = reviews.some((r: any) => {
    const s = String(r?.state || '').toUpperCase()
    return s === 'COMMENTED' || s === 'CHANGES_REQUESTED'
  })
  return {
    number: raw.number,
    url: raw.url,
    state: raw.state,
    isDraft: !!raw.isDraft,
    reviewDecision: raw.reviewDecision || null,
    mergeable: raw.mergeStateStatus || null,
    checks: summarizeChecks(raw.statusCheckRollup),
    commented
  }
}

// The PR's own review status, in the requested vocabulary. Independent of the finish-task loop.
export function prStatus(n: WorktreeNode): { label: string; tone: StatusTone } {
  const pr = n.pr
  if (!pr) return { label: 'N/A', tone: 'neutral' }
  if (pr.state === 'MERGED') return { label: 'Merged', tone: 'success' }
  if (pr.state === 'CLOSED') return { label: 'Closed', tone: 'neutral' }
  if (pr.isDraft) return { label: 'Draft', tone: 'neutral' }
  if (pr.reviewDecision === 'APPROVED') return { label: 'Approved', tone: 'success' }
  if (pr.reviewDecision === 'CHANGES_REQUESTED' || pr.commented) return { label: 'Comments', tone: 'warning' }
  return { label: 'Open', tone: 'accent' }
}

// state.review_request -> a thread URL: prefer the stored permalink, else build from channel + ts.
export function slackUrl(rr: any): string | null {
  if (!rr) return null
  if (rr.permalink) return String(rr.permalink)
  if (rr.channel && rr.message_ts) {
    return `https://slack.com/archives/${rr.channel}/p${String(rr.message_ts).replace('.', '')}`
  }
  return null
}

export function loopFromState(raw: any): LoopInfo {
  return {
    phase: raw?.phase ?? 'unknown',
    parkedFrom: raw?.parked_from ?? null,
    rabbitRounds: raw?.rabbit_rounds ?? 0,
    reviewCycles: raw?.review_cycles ?? 0,
    needsHuman: Array.isArray(raw?.needs_human) ? raw.needs_human.length : 0,
    reviewRequestedAt: raw?.review_request?.posted_at ?? null,
    slackUrl: slackUrl(raw?.review_request)
  }
}

// The one-line status for a worktree, from its loop phase first, then its raw PR state.
// `icon` is an Orca IconName; a failing CI overrides it to `error` so a red build always stands out.
export function deriveStatus(n: WorktreeNode): Status | null {
  const { loop, pr } = n
  const ciFail = !!pr?.checks && pr.checks.failed > 0
  let s: Status | null = null

  if (loop?.phase === 'parked' || (loop && loop.needsHuman > 0)) {
    s = { label: 'Needs human', tone: 'danger', icon: 'flag' }
  } else if (loop) {
    switch (loop.phase) {
      case 'done':
        s = { label: ciFail ? 'Ready · CI ✗' : 'Ready to merge', tone: ciFail ? 'warning' : 'success', icon: 'check' }
        break
      case 'review_loop':
        s = { label: `In review (r${loop.rabbitRounds}·c${loop.reviewCycles})`, tone: 'accent', icon: 'search' }
        break
      case 'review_requested':
        s = { label: 'Review requested', tone: 'accent', icon: 'bell' }
        break
      case 'rabbit_loop':
        s = { label: `CodeRabbit (round ${loop.rabbitRounds})`, tone: 'accent', icon: 'bot' }
        break
      case 'readying':
        s = { label: 'Readying', tone: 'neutral', icon: 'file' }
        break
    }
  }
  if (!s && pr) {
    if (pr.state === 'MERGED') s = { label: 'Merged', tone: 'success', icon: 'check' }
    else if (pr.state === 'CLOSED') s = { label: 'Closed', tone: 'neutral', icon: 'close' }
    else if (pr.isDraft) s = { label: 'Draft PR', tone: 'neutral', icon: 'file' }
    else if (pr.reviewDecision === 'APPROVED')
      s = { label: ciFail ? 'Approved · CI ✗' : 'Approved', tone: ciFail ? 'warning' : 'success', icon: 'check' }
    else if (pr.reviewDecision === 'CHANGES_REQUESTED') s = { label: 'Changes requested', tone: 'warning', icon: 'warning' }
    else s = { label: ciFail ? 'Open · CI ✗' : 'Open PR', tone: ciFail ? 'warning' : 'accent', icon: 'branch' }
  }

  if (s && ciFail) s.icon = 'error'
  return s
}
