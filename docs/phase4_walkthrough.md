# RedWing DB Automation V2 - Phase 4 Walkthrough: Advanced Operator Workflows

Phase 4 transitions the platform from a simple submission tool to a robust management system for Operators. It introduces local draft persistence, rejected entry hydration for easy resubmission, and differentiated submission types for existing routes.

---

## 🚀 Key Features Overview

### 1. Draft CRUD System
Operators can now save their work-in-progress submissions.
- **Save/Update**: Save a draft at any step of the `UpdateRouteStepper`.
- **List/Retrieve**: View all your personal drafts in the Dashboard.
- **Soft Delete**: Remove drafts when they are no longer needed.
- **Auto-Cleanup**: The system automatically purges drafts older than 7 days on startup to keep the storage optimized.

### 2. Resubmission Hydration
When a submission is **REJECTED**, Operators no longer need to start from scratch.
- **Hydration Endpoint**: Fetch all data from the rejected record.
- **Pre-filled Stepper**: Launch the submission flow with all original fields (and the rejection reason) pre-filled.
- **Fix & Submit**: Correct the flagged issues and submit with a link to the original ID.

### 3. Submission Architectures
The system now explicitly distinguishes between two types of submissions:
- **`NEW_ROUTE`**: Standard creation of a new flight path.
- **`UPDATE`**: Modifying an existing route (e.g., updating waypoints, changing directions).
  - Includes **Changed Fields Tracking**: Only fields that differ from the current flights DB are highlighted for reviewers.

---

## 🛠️ Technical Implementation Details

### API Endpoints
- `POST /drafts`: Create or update a draft.
- `GET /drafts`: List active drafts for the authenticated user.
- `GET /drafts/{id}`: Fetch draft payload.
- `DELETE /drafts/{id}`: Soft-delete a draft.
- `GET /submissions/{id}/resubmit-data`: Extract payload from a rejected submission.

### Database Changes
The `submissions.db` schema has been extended to include:
- `submission_type`: Enum (`NEW_ROUTE`, `UPDATE`).
- `parent_submission_id`: Links resubmissions to their predecessors.
- `changed_fields`: JSON field storing the diff for updates.
- `drafts` table: Stores `user_uid`, `payload_json`, and `label`.

### State Management
The `UpdateRouteStepper` now utilizes a `draftId` context.
- If a `draftId` exists, every "Next" action triggers an background autosave.
- Upon successful submission, the draft is automatically converted to a submission and deleted.

---

## 🚦 Testing Phase 4

### 1. Draft Scenarios
1. Open the **New Route** flow.
2. Fill out the "Location" step.
3. Click "Save Draft".
4. Go back to Dashboard -> Check "My Drafts".
5. Resume the draft and verify data persistence.

### 2. Resubmission Scenarios
1. As an **SDE**, reject a submission with a reason "Waypoints are too close to LZ".
2. As an **Operator**, find the rejected submission in the dashboard.
3. Click "Resubmit".
4. Verify all fields are pre-filled and the rejection reason is visible.
5. Fix the waypoints and submit.

### 3. Update Scenarios
1. Select an existing route from the **Network Explorer**.
2. Click "Update Route".
3. Change just the "Takeoff Direction".
4. Submit and verify that `changed_fields` only contains the direction field in the backend logs.
