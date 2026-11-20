// The plugin's own worker. Orca starts it on the panel's first plugin.request and transpiles
// this file when it loads (no build step). It shells out to the `orca` CLI, because Orca's plugin
// host API exposes workspaces and agents but not the worktree lineage (parent/child); only
// `orca worktree list --json` carries `parentWorktreeId` / `childWorktreeIds`.
import type { OrcaWorkerApi } from 'orca/worker'
import type { WorktreeNode } from './protocol.ts'
import { buildForest, loopFromState, ownerRepoFromUrl, prFromGh } from './forest.ts'

// `node:*` has no types under the plugin tsconfig; the worker runs in real Node, so these resolve.
// Non-literal specifiers keep tsc from trying (and failing) to resolve the builtins' types.
async function builtin(name: string): Promise<any> {
  return import(name)
}

// Run a CLI and parse its JSON stdout. Throws on a non-zero exit (e.g. `gh` when no PR exists).
async function runJson(cmd: string, args: string[], cwd?: string): Promise<any> {
  const cp = await builtin('node:child_process')
  const stdout: string = await new Promise((resolve, reject) => {
    cp.execFile(
      cmd,
      args,
      { cwd, timeout: 20000, maxBuffer: 64 * 1024 * 1024 },
      (err: unknown, out: string, errOut: string) =>
        err ? reject(new Error(`${err}: ${errOut}`)) : resolve(out)
    )
  })
  return JSON.parse(stdout)
}

const runOrca = (args: string[]) => runJson('orca', args)

// Enrich up to this many worktrees with gh/PR + loop state, to bound subprocess fan-out.
const ENRICH_CAP = 40

// The filesystem path of a worktree id (`<repoId>::<absolutePath>`).
function worktreePath(id: string): string {
  const i = id.indexOf('::')
  return i >= 0 ? id.slice(i + 2) : id
}

// Attach the open PR (via gh, run in the worktree) and the finish-task loop state (via its state.json).
async function enrich(node: WorktreeNode, home: string): Promise<void> {
  const cwd = worktreePath(node.id)
  // Query by PR number when Orca knows it (survives a deleted branch after merge), else by branch.
  const ref = node.linkedPR != null ? [String(node.linkedPR)] : []
  let raw: any
  try {
    raw = await runJson(
      'gh',
      ['pr', 'view', ...ref, '--json', 'number,url,state,isDraft,reviewDecision,mergeStateStatus,statusCheckRollup,reviews'],
      cwd
    )
  } catch {
    return // no PR for this branch, or gh unavailable here
  }
  node.pr = prFromGh(raw)

  const or = ownerRepoFromUrl(raw.url)
  if (!or) return
  try {
    const fs = await builtin('node:fs/promises')
    const statePath = `${home}/.claude/finish-task/${or.owner}__${or.name}/${raw.number}/state.json`
    const txt: string = await fs.readFile(statePath, 'utf8')
    node.loop = loopFromState(JSON.parse(txt))
  } catch {
    // no finish-task loop for this PR; PR info alone still shows.
  }
}

export default function activate(orca: OrcaWorkerApi): void {
  // Jump to an agent: focus its exact terminal pane when we can resolve it, else open the
  // workspace. Both are desktop-only and need workspace:write; terminal.focus also shows the
  // workspace, so it covers "navigate me to the agent" on its own.
  orca.panels.handle('navigate.focus', async ({ worktreeId, sessionId }) => {
    try {
      if (sessionId) {
        const listed = await orca.host.call('agents.list', { workspaceId: worktreeId })
        const match = listed.agents.find((a) => a.sessionId === sessionId)
        if (match?.terminalId) {
          const focus = await orca.host.call('terminal.focus', { terminalId: match.terminalId })
          if (focus.focused) return { ok: true, via: 'terminal' as const }
        }
      }
      await orca.host.call('workspace.open', { workspaceId: worktreeId })
      return { ok: true, via: 'workspace' as const }
    } catch (e) {
      return { ok: false, via: 'none' as const, error: String(e).slice(0, 200) }
    }
  })

  orca.panels.handle('hierarchy.get', async () => {
    try {
      const [wtRes, agRes, os] = await Promise.all([
        runOrca(['worktree', 'list', '--json']),
        runOrca(['agent', 'list', '--json']),
        builtin('node:os')
      ])
      const forest = buildForest(wtRes?.result?.worktrees ?? [], agRes?.result?.agents ?? [], Date.now())

      // Enrich the interesting worktrees (a PR link or a live agent) with PR + loop status.
      const home: string = os.homedir()
      const candidates = Object.values(forest.nodes)
        .filter((n) => n.linkedPR != null || n.agents.length > 0)
        .slice(0, ENRICH_CAP)
      await Promise.all(candidates.map((n) => enrich(n, home)))

      return forest
    } catch (e) {
      return {
        roots: [],
        nodes: {},
        generatedAt: Date.now(),
        stats: { worktrees: 0, agents: 0, roots: 0, withLineage: 0 },
        error: String(e).slice(0, 400)
      }
    }
  })
}
