// Agent Hierarchy panel: renders the worktree/agent forest the worker builds, and reloads itself
// when Orca reports a workspace or agent change. Components panels have no DOM and no hooks; state
// lives in atoms and all writes happen in handlers or setup (never while rendering).
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  EmptyState,
  Heading,
  KeyValue,
  on,
  plugin,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  Tree,
  type IconName,
  type PanelContext,
  type TreeItem
} from 'orca'
import { agentStateDot, deriveStatus, prStatus, toneDot } from './forest.ts'
import type { Forest, WorktreeNode } from './protocol.ts'

const forestAtom = atom<Forest | null>('forest', null)
const loadingAtom = atom('loading', false)
const errorAtom = atom<string | null>('error', null)
const noteAtom = atom<string | null>('note', null)
const filterAtom = atom<'active' | 'all'>('filter', 'active', { persist: 'storage' })
const expandedAtom = atom<readonly string[]>('expanded', [], { persist: 'storage' })
const selectedAtom = atom<string | null>('selected', null, { persist: 'plugin' })

async function load(): Promise<void> {
  set(loadingAtom, true)
  try {
    const forest = await plugin.request('hierarchy.get')
    set(forestAtom, forest)
    set(errorAtom, forest.error ?? null)
  } catch (e) {
    set(errorAtom, String((e as Error)?.message ?? e))
  } finally {
    set(loadingAtom, false)
  }
}

// A tree key -> what the worker needs to focus it. `wt:<id>` is a worktree; `ag:<sessionId>` is an
// agent, whose worktree we find by scanning the forest.
function keyToTarget(key: string, forest: Forest): { worktreeId: string; sessionId?: string } | null {
  if (key.startsWith('wt:')) return { worktreeId: key.slice(3) }
  if (key.startsWith('ag:')) {
    const sessionId = key.slice(3)
    for (const node of Object.values(forest.nodes)) {
      if (node.agents.some((a) => a.sessionId === sessionId)) return { worktreeId: node.id, sessionId }
    }
  }
  return null
}

async function navigate(target: { worktreeId: string; sessionId?: string }): Promise<void> {
  set(noteAtom, null)
  try {
    const res = await plugin.request('navigate.focus', target)
    if (!res.ok) set(noteAtom, res.error ?? 'Could not navigate to that agent.')
  } catch (e) {
    set(noteAtom, String((e as Error)?.message ?? e))
  }
}

// Debounce the burst of events Orca fires as agents start/stop.
let reloadTimer: ReturnType<typeof setTimeout> | undefined
function scheduleReload(): void {
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => void load(), 250)
}

export function setup(ctx: PanelContext): void {
  void load()
  ctx.subscriptions.push(on('agent.status.changed', scheduleReload))
  ctx.subscriptions.push(on('workspace.changed', scheduleReload))
}

function nodeLabel(n: WorktreeNode): string {
  return n.repo && n.repo !== n.displayName ? `${n.repo} / ${n.displayName}` : n.displayName
}

function worktreeDescription(n: WorktreeNode): string {
  const prNum = n.pr?.number ?? n.linkedPR
  // Lead with the PR status (the thing to read on the first level), then the loop, then branch.
  const bits: string[] = [`PR: ${prStatus(n).label}`]
  const loop = deriveStatus(n)
  if (loop && n.loop) bits.push(loop.label) // loop phase, only when a finish-task loop exists
  if (prNum) bits.push(`#${prNum}`)
  if (n.branch) bits.push(n.branch)
  if (n.host && n.host !== 'local') bits.push(n.host)
  return bits.join('  ·  ')
}

// A selected tree key -> its worktree (an agent leaf resolves to the worktree it runs in).
function selectedWorktree(key: string | null, forest: Forest): WorktreeNode | null {
  if (!key) return null
  if (key.startsWith('wt:')) return forest.nodes[key.slice(3)] ?? null
  if (key.startsWith('ag:')) {
    const sessionId = key.slice(3)
    for (const n of Object.values(forest.nodes)) {
      if (n.agents.some((a) => a.sessionId === sessionId)) return n
    }
  }
  return null
}

const DECISION_LABEL: Record<string, string> = {
  APPROVED: 'Approved',
  CHANGES_REQUESTED: 'Changes requested',
  REVIEW_REQUIRED: 'Review required'
}

function renderDetail(n: WorktreeNode) {
  const status = deriveStatus(n)
  const pstat = prStatus(n)
  const { pr, loop } = n
  return (
    <Card title={nodeLabel(n)} description={n.branch ?? undefined}>
      <Stack gap="sm">
        <Row gap="xs" wrap>
          <Badge tone={pstat.tone}>{`PR: ${pstat.label}`}</Badge>
          {status ? <Badge tone={status.tone}>{status.label}</Badge> : null}
        </Row>
        {pr ? (
          <Stack gap="xs">
            <KeyValue
              items={[
                { label: 'PR', value: `#${pr.number} · ${pr.state}${pr.isDraft ? ' · draft' : ''}` },
                ...(pr.reviewDecision ? [{ label: 'Review', value: DECISION_LABEL[pr.reviewDecision] ?? pr.reviewDecision }] : []),
                ...(pr.mergeable ? [{ label: 'Mergeable', value: pr.mergeable }] : []),
                ...(pr.checks ? [{ label: 'CI', value: `${pr.checks.passed}✓  ${pr.checks.failed}✗  ${pr.checks.pending}…` }] : [])
              ]}
            />
            <Row>
              <Button icon="open-external" variant="outline" size="sm" onPress={() => shell.openExternal(pr.url)}>
                Open PR
              </Button>
            </Row>
          </Stack>
        ) : null}
        {loop ? (
          <Stack gap="xs">
            <Text size="xs" muted>
              {`Loop: ${loop.phase}${loop.parkedFrom ? ` (from ${loop.parkedFrom})` : ''} · rabbit ${loop.rabbitRounds} · review ${loop.reviewCycles}${loop.needsHuman ? ` · ${loop.needsHuman} need human` : ''}`}
            </Text>
            {loop.reviewRequestedAt ? (
              <Row gap="xs" align="center">
                <Text size="xs" muted>Review requested</Text>
                <RelativeTime at={Date.parse(loop.reviewRequestedAt)} muted />
              </Row>
            ) : null}
            {loop.slackUrl ? (
              <Row>
                <Button icon="open-external" variant="outline" size="sm" onPress={() => shell.openExternal(loop.slackUrl as string)}>
                  Open Slack thread
                </Button>
              </Row>
            ) : null}
          </Stack>
        ) : null}
        {!pr && !loop ? <Text size="xs" muted>No PR for this branch.</Text> : null}
      </Stack>
    </Card>
  )
}

// A worktree is worth showing in "active" mode if it runs an agent or sits in a lineage tree.
function isActive(n: WorktreeNode): boolean {
  return n.agents.length > 0 || n.childIds.length > 0 || !!n.parentId
}

function buildItem(id: string, forest: Forest, filter: 'active' | 'all'): TreeItem | null {
  const n = forest.nodes[id]
  if (!n) return null

  const childItems: TreeItem[] = []
  for (const childId of n.childIds) {
    const item = buildItem(childId, forest, filter)
    if (item) childItems.push(item)
  }

  const agentItems: TreeItem[] = n.agents.map((a) => ({
    key: `ag:${a.sessionId}`,
    label: `${agentStateDot(a.state)} ${a.title || a.agent || 'agent'}`,
    description: `${a.agent ?? 'agent'} · ${a.state}`,
    icon: 'bot' as const
  }))

  if (filter === 'active' && !isActive(n) && childItems.length === 0) return null

  const status = deriveStatus(n)
  return {
    key: `wt:${id}`,
    label: status ? `${toneDot(status.tone)} ${nodeLabel(n)}` : nodeLabel(n),
    description: worktreeDescription(n),
    icon: (status?.icon ?? 'branch') as IconName,
    children: [...agentItems, ...childItems]
  }
}

function buildItems(forest: Forest, filter: 'active' | 'all'): TreeItem[] {
  const items: TreeItem[] = []
  for (const rootId of forest.roots) {
    const item = buildItem(rootId, forest, filter)
    if (item) items.push(item)
  }
  return items
}

export default function Panel() {
  const forest = read(forestAtom)
  const loading = read(loadingAtom)
  const error = read(errorAtom)
  const note = read(noteAtom)
  const filter = read(filterAtom)
  const expanded = read(expandedAtom)
  const selected = read(selectedAtom)

  const header = (
    <Row justify="between" align="center" gap="sm">
      <Row gap="sm" align="center">
        <Heading level={3}>Agent Hierarchy</Heading>
        {loading ? <Spinner label="Loading" labelHidden /> : null}
      </Row>
      <Row gap="xs" align="center">
        <Select
          label="Show"
          labelHidden
          value={filter}
          options={[
            { value: 'active', label: 'Active & linked' },
            { value: 'all', label: 'All worktrees' }
          ]}
          onChange={(v) => set(filterAtom, v as 'active' | 'all')}
        />
        <Button icon="refresh" variant="ghost" size="sm" tooltip="Refresh" onPress={() => void load()}>
          Refresh
        </Button>
      </Row>
    </Row>
  )

  if (error) {
    return (
      <Stack gap="md">
        {header}
        <Callout tone="danger" title="Could not read the hierarchy" icon="error">
          <Text>{error}</Text>
        </Callout>
      </Stack>
    )
  }

  if (!forest) {
    return (
      <Stack gap="md">
        {header}
        <Spinner label="Reading worktrees and agents…" />
      </Stack>
    )
  }

  const items = buildItems(forest, filter)
  const { stats } = forest

  const summary = (
    <Row gap="xs" align="center" wrap>
      <Badge tone="accent">{`${stats.agents} agents`}</Badge>
      <Badge>{`${stats.roots} roots`}</Badge>
      <Badge tone={stats.withLineage ? 'success' : 'neutral'}>{`${stats.withLineage} linked`}</Badge>
      <Text muted size="xs">{`${stats.worktrees} worktrees total`}</Text>
    </Row>
  )

  return (
    <Stack gap="md">
      {header}
      {summary}
      {note ? (
        <Callout tone="warning" icon="warning">
          <Text>{note}</Text>
        </Callout>
      ) : null}
      {items.length === 0 ? (
        <EmptyState
          title={filter === 'active' ? 'No active or linked trees' : 'No worktrees'}
          description={
            filter === 'active'
              ? 'Nothing is running and no parent/child worktrees exist yet. Switch to “All worktrees”, or fan a change out across repos via Orca to see the tree light up.'
              : 'Orca reported no worktrees.'
          }
          icon="blocks"
        />
      ) : (
        <Tree
          label="Worktree and agent hierarchy"
          items={items}
          expanded={expanded}
          maxHeight="none"
          onToggle={({ key, expanded: isOpen }) =>
            set(
              expandedAtom,
              isOpen ? [...read(expandedAtom), key] : read(expandedAtom).filter((k) => k !== key)
            )
          }
          onSelect={({ key }) => set(selectedAtom, key)}
          onAction={({ key }) => {
            const target = keyToTarget(key, forest)
            if (target) void navigate(target)
          }}
        />
      )}
      {selectedWorktree(selected, forest) ? renderDetail(selectedWorktree(selected, forest) as WorktreeNode) : null}
    </Stack>
  )
}
