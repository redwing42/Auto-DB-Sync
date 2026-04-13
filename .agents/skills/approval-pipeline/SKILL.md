# Skill: Approval Pipeline Execution

## Pipeline Execution Policy
1. [cite_start]**Snapshots First:** Take a timestamped snapshot of `flights.db` and the Excel file before any writes. [cite: 477]
2. [cite_start]**Sequential Resolution:** Resolve IDs in this order: Network -> Source Location/LZ -> Destination Location/LZ. [cite: 479, 481, 483, 485]
3. [cite_start]**Atomic Save:** Save the Excel file to a temp file first, then rename it over the original to prevent partial writes. [cite: 489]
4. [cite_start]**Git Branching:** Create a dedicated branch (never `main`) using the `{SHORTFORM}` naming convention. [cite: 493, 496]

## Failure Handling
- [cite_start]If any step fails, log the `PIPELINE_STEP_FAILED` record to `audit.db` and trigger an SDE email. [cite: 474, 542]
- [cite_start]Support retries from specific failed steps (especially Step 10 or 11) using the retry endpoint. [cite: 506, 507]