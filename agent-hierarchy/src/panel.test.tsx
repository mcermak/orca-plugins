// `orca plugin test .` runs this in Node with the same runtime and checks Orca uses.
import { assert, mockHost, mount, test } from 'orca/testing'
import * as panel from './panel'
import { SAMPLE_FOREST } from './sample.ts'

test('renders the forest the worker returns, and the active filter hides idle repos', async () => {
  let calls = 0
  const navs: Array<{ worktreeId: string; sessionId?: string }> = []
  const host = mockHost({
    requests: {
      'hierarchy.get': () => {
        calls++
        return SAMPLE_FOREST
      },
      'navigate.focus': (input) => {
        navs.push(input)
        return { ok: true, via: 'terminal' as const }
      }
    }
  })
  const view = await mount(panel, { host })

  // The summary badges reflect the stats.
  assert.ok(view.find({ text: /3 agents/ }), 'shows the agent count')
  assert.ok(view.find({ text: /2 linked/ }), 'shows the linked count')

  // Active mode shows the two linked trees but not the idle standalone "ansible" repo.
  assert.ok(view.findAll({ text: /orchestrator/ }).length > 0, 'orchestrator root is shown')
  assert.ok(view.findAll({ text: /ansible/ }).length === 0, 'idle repo hidden in active mode')

  // Switching to "all" reveals the idle repo.
  await view.select({ type: 'Select' }, 'all')
  assert.ok(view.findAll({ text: /ansible/ }).length > 0, 'idle repo shown in all mode')

  // An agent status change triggers a reload (debounced).
  const before = calls
  await view.emit('agent.status.changed', {
    workspaceId: null,
    paneKey: 'x',
    state: 'done',
    receivedAt: 1
  })
  await new Promise((r) => setTimeout(r, 400))
  await view.settled()
  assert.ok(calls > before, 'reloaded after an agent status change')

  // Activating an agent leaf asks the worker to focus that agent (by worktree + session).
  await view.expand({ type: 'Tree' }, 'wt:r::contacts')
  await view.expand({ type: 'Tree' }, 'wt:r::integrations')
  await view.activateItem({ type: 'Tree' }, 'ag:s2')
  assert.deepEqual(navs, [{ worktreeId: 'r::integrations', sessionId: 's2' }])

  // Selecting a PR worktree opens a detail card with the derived status and the links.
  await view.selectItem({ type: 'Tree' }, 'wt:r::integrations')
  assert.ok(view.find({ text: /In review/ }), 'detail card shows the derived loop status')
  assert.ok(view.find({ text: 'Open PR' }), 'detail card has an Open PR button')
  assert.ok(view.find({ text: 'Open Slack thread' }), 'detail card has an Open Slack thread button')

  assert.deepEqual(view.errors, [])
  assert.deepEqual(view.refusals, [])
  await view.unmount()
})
