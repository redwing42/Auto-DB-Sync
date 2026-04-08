---
trigger: always_on
---

---
trigger: always_on
---
# RedWing V2 Workflow Enforcement

## Workflow States
[cite_start]The agent must facilitate transitions through these exact states:
1. DRAFT -> SUBMITTED (Operator)
2. [cite_start]SUBMITTED -> FILES_DOWNLOADED (Auto-download on open) [cite: 435, 468]
3. [cite_start]FILES_DOWNLOADED -> WAYPOINT_VERIFIED (Reviewer/SDE Gate 1) [cite: 438, 451]
4. [cite_start]WAYPOINT_VERIFIED -> ID_RESOLUTION_CONFIRMED (SDE Gate 2) [cite: 439, 457]
5. [cite_start]ID_RESOLUTION_CONFIRMED -> APPROVED (SDE/Admin) [cite: 441, 460]

## Audit Trail Requirements
[cite_start]Every action must be logged to `audit_store.py`[cite: 126, 288, 672]. 
- If implementing an endpoint, ensure it includes a call to `audit_store.append_record()`.