---
name: implement
description: Developer implements an approved task spec. Use from the Developer terminal.
model: sonnet
effort: medium
---

# Implement task

$ARGUMENTS

## Instructions

You are the Developer. Follow this process:

1. **Read the task**: Open and read the specified task file in `tasks/` completely. If $ARGUMENTS is a number, read `tasks/TASK-{number}.md`. If no number given, list all APPROVED tasks and ask which one.

2. **Verify**: Confirm the task status is APPROVED. If it's DRAFT, stop and tell Giacomo.

3. **Update status**: Change the task status from APPROVED to IN_PROGRESS.

4. **Implement**: Follow the implementation steps in the task spec precisely. For each step:
   - Write or modify the specified files
   - Check against CLAUDE.md critical rules
   - Verify TypeScript compiles cleanly

5. **Self-test**:
   - Run `npx tsc --noEmit` to check types
   - Verify all i18n keys are present in all 35 locale files
   - Check no hardcoded pixel values were introduced

6. **Document**: Add an `## Implementation notes` section to the task file with a brief summary of what was done and any decisions made.

7. **Complete**: Update task status to DONE. Commit all changes:
   ```
   git add -A
   git commit -m "feat(TASK-xxx): [description from task]"
   ```
