---
trigger: always_on
---

---
trigger: model_decision
description: Apply during Gate 2 review or when resolving entity IDs
---
# Gate 2: ID Resolution Standards

## 1. Entity Preview Requirement
- [cite_start]The agent must use the `GET /submissions/{id}/resolve-preview` endpoint to fetch a dry-run of the Excel resolution for all 7 entities. [cite: 455, 660]
- [cite_start]**Match Policy:** Existing entities must show their matched ID; new entities MUST be explicitly flagged for human checkbox confirmation. [cite: 456]

## 2. SDE Ownership
- [cite_start]Only users with the **SDE** or **Admin** role can confirm ID resolution. [cite: 358, 359, 454]
- [cite_start]Transition to the next state (`id_resolution_reviewed: true`) is strictly forbidden without a confirmed entity dictionary from the human user. [cite: 457]