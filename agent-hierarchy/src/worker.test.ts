// Unit tests for the pure forest assembly (worker.ts itself only adds the orca CLI calls).
import { assert, mockHost, mountWorker, test } from 'orca/testing'
import * as worker from './worker.ts'
import {
  buildForest,
  deriveRepo,
  deriveStatus,
  loopFromState,
  agentStateDot,
  ownerRepoFromUrl,
  prFromGh,
  prStatus,
  repoName,
  slackUrl,
  summarizeChecks,
  toneDot,
  type RawAgent,
  type RawWorktree
} from './forest.ts'
import type { WorktreeNode } from './protocol.ts'

function node(partial: Partial<WorktreeNode>): WorktreeNode {
  return {
    id: 'x',
    displayName: 'x',
    repo: 'x',
    branch: 'b',
    host: 'local',
    status: null,
    linkedPR: null,
    parentId: null,
    childIds: [],
    agents: [],
    pr: null,
    loop: null,
    ...partial
  }
}

test('repoName reads forge ids only', () => {
  assert.equal(repoName('github:cloudtalk-io/contacts'), 'contacts')
  assert.equal(repoName('repo:ffb41460-uuid'), null) // local id has no human name
  assert.equal(repoName(null), null)
})

test('deriveRepo falls back to the path basename for local repos', () => {
  assert.equal(deriveRepo('github:org/phone', '/x/y'), 'phone')
  assert.equal(deriveRepo('repo:uuid', '/Users/m/orca/projects/orca-pluggins'), 'orca-pluggins')
  assert.equal(deriveRepo(null, '/a/b/'), 'b')
})

test('nests children under their parent and groups agents by worktree', () => {
  const worktrees: RawWorktree[] = [
    { id: 'p', projectId: 'github:org/contacts', branch: 'refs/heads/main', childWorktreeIds: ['c'] },
    { id: 'c', projectId: 'github:org/phone', parentWorktreeId: 'p' },
    { id: 'orphan', projectId: 'github:org/lost', parentWorktreeId: 'gone' }
  ]
  const agents: RawAgent[] = [
    { orcaSessionId: 's1', worktreeId: 'p', agent: 'claude', state: 'working', title: 'Lead' },
    { orcaSessionId: 's2', worktreeId: 'c', agent: 'codex', state: 'done', title: 'Child' }
  ]
  const f = buildForest(worktrees, agents, 123)

  assert.deepEqual(f.roots.sort(), ['orphan', 'p']) // a parent that is not in the set falls back to root
  assert.equal(f.nodes['p'].repo, 'contacts')
  assert.equal(f.nodes['p'].branch, 'main')
  assert.equal(f.nodes['p'].agents.length, 1)
  assert.equal(f.nodes['c'].parentId, 'p')
  assert.deepEqual(f.stats, { worktrees: 3, agents: 2, roots: 2, withLineage: 1 })
  assert.equal(f.generatedAt, 123)
})

test('ownerRepoFromUrl preserves case', () => {
  assert.deepEqual(ownerRepoFromUrl('https://github.com/CloudTalk-io/contacts/pull/394'), {
    owner: 'CloudTalk-io',
    name: 'contacts'
  })
  assert.equal(ownerRepoFromUrl('nope'), null)
})

test('summarizeChecks buckets conclusions and states', () => {
  assert.deepEqual(
    summarizeChecks([{ conclusion: 'SUCCESS' }, { conclusion: 'FAILURE' }, { state: 'PENDING' }, { state: 'SUCCESS' }]),
    { passed: 2, failed: 1, pending: 1 }
  )
  assert.equal(summarizeChecks(undefined), null)
})

test('slackUrl prefers permalink, else builds from channel + ts', () => {
  assert.equal(slackUrl({ permalink: 'https://x/thread' }), 'https://x/thread')
  assert.equal(
    slackUrl({ channel: 'C9', message_ts: '1795195379.905819' }),
    'https://slack.com/archives/C9/p1795195379905819'
  )
  assert.equal(slackUrl({ message_ts: '1' }), null) // no channel, no link
  assert.equal(slackUrl(null), null)
})

test('loopFromState maps the state.json shape', () => {
  const loop = loopFromState({
    phase: 'review_loop',
    rabbit_rounds: 2,
    review_cycles: 1,
    needs_human: [{ item: 'x' }],
    review_request: { posted_at: '2026-11-20T17:23:12Z', channel: 'C9', message_ts: '1.2' }
  })
  assert.equal(loop.phase, 'review_loop')
  assert.equal(loop.needsHuman, 1)
  assert.equal(loop.reviewRequestedAt, '2026-11-20T17:23:12Z')
  assert.equal(loop.slackUrl, 'https://slack.com/archives/C9/p12')
})

test('deriveStatus prioritises needs-human, then loop phase, then raw PR', () => {
  assert.equal(deriveStatus(node({ loop: loopFromState({ phase: 'review_loop', needs_human: [{}] }) }))?.label, 'Needs human')
  assert.equal(deriveStatus(node({ loop: loopFromState({ phase: 'rabbit_loop', rabbit_rounds: 1 }) }))?.label, 'CodeRabbit (round 1)')
  assert.equal(deriveStatus(node({ loop: loopFromState({ phase: 'done' }) }))?.tone, 'success')
  assert.equal(
    deriveStatus(node({ pr: prFromGh({ number: 1, url: 'u', state: 'OPEN', isDraft: true }) }))?.label,
    'Draft PR'
  )
  assert.equal(
    deriveStatus(node({ pr: prFromGh({ number: 1, url: 'u', state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) }))?.tone,
    'warning'
  )
  assert.equal(deriveStatus(node({}))?.label, undefined) // no pr, no loop -> null
})

test('prStatus reports the PR review state in the requested vocabulary', () => {
  assert.deepEqual(prStatus(node({ pr: null })), { label: 'N/A', tone: 'neutral' })
  assert.equal(prStatus(node({ pr: prFromGh({ state: 'OPEN', isDraft: true }) })).label, 'Draft')
  assert.equal(prStatus(node({ pr: prFromGh({ state: 'OPEN' }) })).label, 'Open')
  assert.equal(prStatus(node({ pr: prFromGh({ state: 'OPEN', reviewDecision: 'APPROVED' }) })).label, 'Approved')
  assert.equal(prStatus(node({ pr: prFromGh({ state: 'OPEN', reviewDecision: 'CHANGES_REQUESTED' }) })).label, 'Comments')
  // A plain comment review (no decision) still surfaces as "Comments".
  assert.equal(prStatus(node({ pr: prFromGh({ state: 'OPEN', reviews: [{ state: 'COMMENTED' }] }) })).label, 'Comments')
  assert.equal(prStatus(node({ pr: prFromGh({ state: 'MERGED' }) })).label, 'Merged')
})

test('status carries an icon, and CI failure overrides it to error', () => {
  assert.equal(deriveStatus(node({ loop: loopFromState({ phase: 'review_loop' }) }))?.icon, 'search')
  assert.equal(deriveStatus(node({ loop: loopFromState({ phase: 'done' }) }))?.icon, 'check')
  // A failing CI check overrides whatever icon the phase/state picked.
  const ciFail = deriveStatus(
    node({
      loop: loopFromState({ phase: 'done' }),
      pr: prFromGh({ number: 1, url: 'u', state: 'OPEN', statusCheckRollup: [{ conclusion: 'FAILURE' }] })
    })
  )
  assert.equal(ciFail?.icon, 'error')
  assert.equal(ciFail?.tone, 'warning')
})

test('dots map tone and agent state to a colored glyph', () => {
  assert.equal(toneDot('success'), '🟢')
  assert.equal(toneDot('danger'), '🔴')
  assert.equal(agentStateDot('working'), '🔵')
  assert.equal(agentStateDot('done'), '🟢')
  assert.equal(agentStateDot('whatever'), '⚪')
})

test('navigate.focus focuses the agent terminal when resolvable', async () => {
  const host = mockHost({
    results: {
      'agents.list': { agents: [{ terminalId: 't9', sessionId: 's2', agent: 'claude', state: 'working', stateStartedAt: 0, title: null }] },
      'terminal.focus': { focused: true },
      'workspace.open': { opened: true }
    }
  })
  const w = await mountWorker(worker, { host })
  const r = await w.request('navigate.focus', { worktreeId: 'wt1', sessionId: 's2' })
  assert.deepEqual(r, { ok: true, via: 'terminal' })
  assert.ok(host.calls.some((c) => c.method === 'terminal.focus'))
  await w.deactivate()
})

test('navigate.focus falls back to opening the workspace', async () => {
  const host = mockHost({
    results: {
      'agents.list': { agents: [] }, // session not found -> no terminal to focus
      'workspace.open': { opened: true }
    }
  })
  const w = await mountWorker(worker, { host })
  const r = await w.request('navigate.focus', { worktreeId: 'wt1', sessionId: 'missing' })
  assert.deepEqual(r, { ok: true, via: 'workspace' })
  assert.ok(host.calls.some((c) => c.method === 'workspace.open'))
  await w.deactivate()
})
