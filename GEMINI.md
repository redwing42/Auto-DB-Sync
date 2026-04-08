# RedWing DB Automation V2 - Master Rules

## 1. Project Identity & HITL
- This is a transition from V1 (passive Google Forms) to V2 (integrated operations platform).
- **Mandatory HITL:** Every state transition (e.g., SUBMITTED → WAYPOINT_VERIFIED) must be initiated by the human architect.

## 2. Token-Saving Protocol (8GB RAM Optimization)
- **Lazy Loading:** Only read documentation in `/docs` when explicitly @mentioned.
- **Micro-Commits:** Propose code changes in blocks of <100 lines to avoid memory spikes.
- **Workflow-Aware:** Always check `docs/SYSTEM_DESIGN.md` before suggesting infrastructure changes.

## 3. Core Tech Stack
- **Backend:** FastAPI (Python), SQLite (`submissions.db`, `audit.db`, `flights.db`).
- **Frontend:** React 18, Vite 5, Tailwind CSS v4, CesiumJS.
- **Auth:** Firebase Auth + Firestore for role-based access.