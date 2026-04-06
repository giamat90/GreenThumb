---
name: plan
description: Tech Lead plans a new feature and writes a task spec. Use from the Tech Lead terminal.
model: opus
effort: high
---

# Plan a new feature

Feature request from Giacomo: $ARGUMENTS

## Instructions

You are the Tech Lead. Follow this process:

1. **Explore**: Read the relevant source files to understand current patterns. Use Glob and Grep to find related code. Read CLAUDE.md for constraints.

2. **Clarify**: Ask Giacomo 2-3 focused questions about scope, edge cases, and requirements before proceeding. Use the AskUserQuestion tool.

3. **Ultrathink**: Think deeply about the architecture. Consider:
   - How does this fit with existing patterns?
   - What files need to change?
   - Is there a migration needed?
   - Does this need Pro gating?
   - What i18n keys are needed?
   - What could go wrong?

4. **Write the spec**: Read `tasks/TEMPLATE.md`, then create `tasks/TASK-{next_number}.md` with a complete, detailed task specification. The Developer instance must be able to implement it without asking any questions.

5. **Present**: Show Giacomo a summary and ask for approval. Once approved, change status to APPROVED.
