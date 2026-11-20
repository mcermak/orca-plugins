// A small sample forest shared by the panel test and the check scenarios: one orchestrator with
// two child worktrees across repos, plus an idle standalone repo that "active" mode hides.
import type { Forest } from './protocol.ts'

export const SAMPLE_FOREST: Forest = {
  roots: ['r::contacts', 'r::ansible'],
  nodes: {
    'r::contacts': {
      id: 'r::contacts',
      displayName: 'orchestrator',
      repo: 'contacts',
      branch: 'feat/cross-repo',
      host: 'local',
      status: 'in-progress',
      linkedPR: null,
      parentId: null,
      childIds: ['r::integrations', 'r::phone'],
      agents: [{ sessionId: 's1', agent: 'claude', kind: 'chat', state: 'working', title: 'Lead change' }],
      pr: null,
      loop: null
    },
    'r::integrations': {
      id: 'r::integrations',
      displayName: 'int-4527',
      repo: 'integrations',
      branch: 'int-4527',
      host: 'local',
      status: 'in-progress',
      linkedPR: 1375,
      parentId: 'r::contacts',
      childIds: [],
      agents: [{ sessionId: 's2', agent: 'claude', kind: 'chat', state: 'working', title: 'Wire contract' }],
      pr: {
        number: 1375,
        url: 'https://github.com/CloudTalk-io/integrations/pull/1375',
        state: 'OPEN',
        isDraft: false,
        reviewDecision: 'REVIEW_REQUIRED',
        mergeable: 'BLOCKED',
        checks: { passed: 8, failed: 0, pending: 1 },
        commented: false
      },
      loop: {
        phase: 'review_loop',
        parkedFrom: null,
        rabbitRounds: 2,
        reviewCycles: 1,
        needsHuman: 0,
        reviewRequestedAt: '2026-11-20T17:23:12Z',
        slackUrl: 'https://slack.com/archives/C0ABC123/p179519537990581'
      }
    },
    'r::phone': {
      id: 'r::phone',
      displayName: 'fix-csp',
      repo: 'phone',
      branch: 'fix-csp',
      host: 'local',
      status: 'in-progress',
      linkedPR: null,
      parentId: 'r::contacts',
      childIds: [],
      agents: [{ sessionId: 's3', agent: 'codex', kind: 'terminal', state: 'done', title: 'CSP header' }],
      pr: {
        number: 980,
        url: 'https://github.com/CloudTalk-io/phone/pull/980',
        state: 'OPEN',
        isDraft: true,
        reviewDecision: null,
        mergeable: 'UNKNOWN',
        checks: { passed: 3, failed: 1, pending: 0 },
        commented: false
      },
      loop: null
    },
    'r::ansible': {
      id: 'r::ansible',
      displayName: 'main',
      repo: 'ansible',
      branch: 'main',
      host: 'local',
      status: 'in-progress',
      linkedPR: 812,
      parentId: null,
      childIds: [],
      agents: [],
      pr: {
        number: 812,
        url: 'https://github.com/CloudTalk-io/ansible/pull/812',
        state: 'MERGED',
        isDraft: false,
        reviewDecision: 'APPROVED',
        mergeable: 'UNKNOWN',
        checks: { passed: 5, failed: 0, pending: 0 },
        commented: false
      },
      loop: null
    }
  },
  generatedAt: 1795198000000,
  stats: { worktrees: 4, agents: 3, roots: 2, withLineage: 2 }
}
