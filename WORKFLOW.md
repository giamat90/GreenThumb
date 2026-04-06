# Two-Instance Workflow — Quick Start

## Setup (one time)

```bash
# Copy these files into your GreenThumb repo:
cp CLAUDE.md /path/to/GreenThumb/CLAUDE.md
cp -r .claude/ /path/to/GreenThumb/.claude/
cp -r tasks/ /path/to/GreenThumb/tasks/

# Add tasks/ to git
cd /path/to/GreenThumb
git add CLAUDE.md .claude/ tasks/
git commit -m "chore: add two-instance workflow setup"
```

## Daily workflow

### Terminal 1 — Tech Lead (left side of screen)

```bash
cd /path/to/GreenThumb

# Option A: Use the agent directly
claude --model opus --permission-mode plan
> @tech-lead I want to add a "how much water per session" feature

# Option B: Use the slash command
claude --model opus --permission-mode plan
> /plan add a "how much water per session" calculator that combines formula + AI

# Option C: Use opusplan (saves Opus tokens)
claude --model opusplan
> /plan RevenueCat billing integration
```

**What happens**: Tech Lead explores the codebase, asks you clarifying questions,
then writes `tasks/TASK-001.md` with a detailed spec. You review and approve.

### Terminal 2 — Developer (right side of screen)

```bash
cd /path/to/GreenThumb

# Option A: Use the agent
claude --model sonnet --worktree dev-task-001
> @developer implement TASK-001

# Option B: Use the slash command
claude --model sonnet --worktree dev-task-001
> /implement 001

# Option C: With auto-accept for faster execution (careful!)
claude --model sonnet --worktree dev-task-001 --dangerously-skip-permissions
> /implement 001
```

**What happens**: Developer reads the task spec, implements step by step,
runs type checks, commits on the worktree branch.

### After Developer finishes — Review

Back in **Terminal 1** (Tech Lead):

```bash
> /review TASK-001
```

Or you test directly on your Moto G:

```bash
# In the developer worktree
cd .claude/worktrees/dev-task-001
npx expo run:android --device ZY22BHCRLG
```

### Merge when satisfied

```bash
git checkout main
git merge dev-task-001
git worktree remove .claude/worktrees/dev-task-001
```

## Flow summary

```
You: "I want feature X"
    ↓
Tech Lead (Terminal 1): explores code → asks questions → writes TASK-xxx.md
    ↓
You: review spec → approve
    ↓
Developer (Terminal 2): reads spec → implements → commits
    ↓
Tech Lead (Terminal 1): /review TASK-xxx
    ↓
You: test on Moto G → merge or request changes
```

## Tips

- **Use /clear** between different features in the same terminal
- **Use /plan** for big features, just talk normally for small questions
- **Tech Lead can run while Developer works** — plan the next task while
  the current one is being implemented
- **If Developer has questions**, they write them in the task file under
  "Developer questions" — you relay to Tech Lead
- **Keep task numbers sequential** — check `ls tasks/` for the latest number
- **The task file is the source of truth** — if it's not in the spec,
  the Developer shouldn't build it

## Parallel work

You can absolutely run both simultaneously:
- Tech Lead plans TASK-002 while Developer implements TASK-001
- Each is in its own terminal, its own context, its own worktree
- No conflicts because worktrees are isolated branches

## When things go wrong

- **Developer goes off-spec**: Stop them, point to the specific spec line
- **Spec is wrong**: Update the task file, change status back to APPROVED,
  tell Developer to re-read
- **Feature needs rethinking**: Set task status to CANCELLED, start fresh
  with a new /plan
