# orca-plugins

Personal collection of [Orca](https://orca.do) plugins.

## Plugins

### [`agent-hierarchy`](./agent-hierarchy)

A sidebar panel that visualizes **which agents and sub-agents belong to one parent** when work is
spread across multiple repos. It joins Orca's worktree lineage (`parentWorktreeId` /
`childWorktreeIds`) with the agents running in each worktree, and renders the forest as a tree —
each node showing its PR status (`N/A · Draft · Open · Comments · Approved · Merged`), the
finish-task loop phase, CI, and a link to the review Slack thread. Double-click a node to jump to
the agent's terminal; select one for a detail card with **Open PR** / **Open Slack thread**.

See [`agent-hierarchy/README.md`](./agent-hierarchy/README.md) for how it works, develop/test, and
capabilities.

## Working on a plugin

```sh
cd agent-hierarchy
orca plugin dev watch . --check --shot ./.orca/shots --json   # live reload + render checks
orca plugin test .                                            # unit tests
orca plugin check .                                           # render every scenario
orca plugin validate .                                        # manifest check
```
