# Changing the Google Sheet Link

If you want to use a different Google Sheet for your flight route submissions, follow these steps to ensure the new sheet is correctly connected to the backend.

### 1. Copy the Apps Script
1. Open your **new Google Sheet**.
2. Go to **Extensions** > **Apps Script**.
3. Copy the code from `./google_apps_script/webhook_trigger.gs` and paste it into the script editor in your new sheet.

### 2. Update Configuration
In the script editor of the new sheet, check these variables at the top:
* `WEBHOOK_URL`: Ensure this matches your backend's current deployment URL.
* `WEBHOOK_SECRET`: Ensure this matches the `WEBHOOK_SECRET` in your backend's `.env` file.

### 3. Set Up the Trigger
1. In the Apps Script editor, click on the **Triggers** icon (clock shape) on the left sidebar.
2. Click **+ Add Trigger** (bottom right).
3. Choose the following settings:
   * **Choose which function to run**: `onFormSubmit`
   * **Choose which deployment should run**: `Head`
   * **Select event source**: `From spreadsheet`
   * **Select event type**: `On form submit`
4. Click **Save** and authorize the script when prompted.

### 4. Verify Column Names
Ensure the column headers in your new Google Sheet exactly match the keys in the `COLUMN_MAP` at the top of the script (e.g., "Network Name", "Source Location Name", etc.).

### 5. (Optional) Manual Sync
The script adds a custom "🦅 RedWing" menu to your Google Sheet. You can use this to manually sync a specific row by selecting it and clicking **Sync Selected Row**.

> [!IMPORTANT]
> If you change the Google Account used for the new sheet, and the backend needs to download files that aren't "Public (Anyone with link)", you will need to update the `GNOME_GOA_ACCOUNT_PATH` in your backend's `.env` to match the new account.
