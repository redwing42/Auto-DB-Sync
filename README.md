# Auto-DB-Updater

Internal pipeline for automating new flight route ingestion into the RedWing database.

## What it does

Bridges the Google Forms route submission process with central database management. When a pilot submits a new route, the system:
1. Catches the webhook from Google Workspace.
2. Downloads and parses the associated Mission Planner waypoint file from Google Drive.
3. Checks for exact duplicate routes against existing local data.
4. Queues the submission for human review on a React dashboard.
5. Previews the route in 3D using Cesium.
6. Upon approval, appends the data to `Flight_data_updated.xlsx` and synchronizes `instance/flights.db`.

## Structure

* `/backend` - FastAPI server handling validation, Google Drive downloads, and Excel/DB modifications.
* `/frontend` - React + Vite dashboard for reviewing and approving/rejecting routes.
* `/google_apps_script` - The webhook trigger to tie Google Sheets to the FastAPI backend.

## Local Setup

### 1. Environment
Copy `.env.example` to `.env` in the project root and configure your local paths. The most important variable is `REDWING_REPO_PATH`, which should point to your local clone of the main RedWingGCS repository.

### 2. Backend
```bash
cd backend
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### 3. Frontend
```bash
cd frontend
npm install
npm run dev
```

## Testing

Backend tests are written with `pytest`.

```bash
cd backend
pytest -v
```

## Google Apps Script

To connect the live Google Form:
1. Open the linked Google Sheet.
2. Go to Extensions > Apps Script.
3. Paste the contents of `google_apps_script/webhook_trigger.gs`.
4. Set up an `onFormSubmit` (or `onChange`) trigger pointing to the `onFormSubmit` function.
