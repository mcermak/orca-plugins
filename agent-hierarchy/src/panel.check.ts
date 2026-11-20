// `orca plugin check` renders the panel once per scenario. Stub the worker's hierarchy.get so the
// render is deterministic (the real worker would shell out to the orca CLI).
import { defineCheck } from 'orca/testing'
import { SAMPLE_FOREST } from './sample.ts'

const empty = {
  roots: [],
  nodes: {},
  generatedAt: 0,
  stats: { worktrees: 0, agents: 0, roots: 0, withLineage: 0 }
}

export default defineCheck({
  populated: { requests: { 'hierarchy.get': () => SAMPLE_FOREST } },
  all: {
    requests: { 'hierarchy.get': () => SAMPLE_FOREST },
    storage: { filter: 'all' }
  },
  expanded: {
    requests: { 'hierarchy.get': () => SAMPLE_FOREST },
    storage: { expanded: ['wt:r::contacts'] }
  },
  detail: {
    requests: { 'hierarchy.get': () => SAMPLE_FOREST },
    storage: { expanded: ['wt:r::contacts'] },
    persisted: { plugin: { selected: 'wt:r::integrations' } }
  },
  empty: { requests: { 'hierarchy.get': () => empty } },
  failed: {
    requests: { 'hierarchy.get': () => ({ ...empty, error: 'orca: command not found' }) }
  }
})
