---
trigger: always_on
---

---
trigger: glob
pattern: "**/*.{py,js,ts,tsx}"
---

# RedWing V2 Coding Standards

## 1. Backend Logic (FastAPI / Python)
- **Database Preparation:** All primary keys must use UUIDs, not auto-increment integers[cite: 293, 701].
- **Audit Logging:** Every write operation must be wrapped in a transaction and recorded in the append-only `audit_log` table[cite: 288, 299, 712].
- **Soft Deletes:** Nothing is ever hard deleted. Use `deleted_at` and `deleted_by_uid` columns[cite: 295, 701].
- **Metadata:** Every table must include `created_at`, `updated_at`, `created_by_uid`, and `updated_by_uid`[cite: 294, 702].
- **Normalization:** `populate_data.py` must handle mixed types for the `status` column (boolean, string 'true'/'false', or 0/1) gracefully[cite: 298, 680].

## 2. Frontend Logic (React / Tailwind V4)
- **Role Enforcement:** UI elements (buttons, tabs) must be hidden—not just disabled—if the user's role level is insufficient[cite: 367].
- **State Management:** Theme preferences and session persistence must be saved per user in Firestore[cite: 262, 650].
- **Animations:** Use Tailwind CSS v4 utilities for sidebar transitions, tab switching (fade), and toast notifications[cite: 265, 269, 653].
- **Performance:** Use skeleton screens for loading states instead of spinners where possible[cite: 272, 657].

## 3. Validation Logic
- **Pre-Submission:** Enforce QGC WPL 1.1 format for waypoint files and perform "Null Island" (0,0) coordinate checks[cite: 81, 82, 86, 389].
- **Direction Sanity:** Flag warnings if takeoff and approach directions differ by <30° or >330°[cite: 92, 391].
- **Duplicates:** Check for identical Network + Source/Destination Location/LZ combinations before finalizing any "New Route"[cite: 101, 395].

## 4. Git Operations
- **Branching:** All DB updates must go to `db-update/` branches. Never push directly to `main`[cite: 276, 346, 493].
- **Naming:** Follow the pattern `db-update/add-routes-for-{SHORTFORM}` for new routes[cite: 277, 496].