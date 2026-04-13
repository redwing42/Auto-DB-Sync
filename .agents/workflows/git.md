---
description: 
---

# V2 Git Workflows

## /push (SDE Approval Step)
1. [cite_start]Determine branch name: `db-update/add-routes-for-{SHORTFORM}` or `db-update/update-route-{SHORTFORM}`[cite: 277, 278].
2. [cite_start]Verify if same-name branch exists; if so, append `{YYYYMMDD}`[cite: 282, 498].
3. Run `git push origin {branch_name}`.
4. [cite_start]Update the submission's audit log with the branch name[cite: 134, 499].

## /status
1. Run `git status`.
2. Check `submissions.db` for the current workflow state.