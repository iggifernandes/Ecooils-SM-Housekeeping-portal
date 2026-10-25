# Mentari Housekeeping

Installable web app (PWA) for the Mentari Project housekeeping team, PT EcoOils Jaya Indonesia.
English, Bahasa Indonesia and Bahasa Melayu. No APK needed: staff open the link and choose "Add to Home screen".

**What it does**
- Every room has a QR label. Anyone who scans it with a normal phone camera sees that room's cleaning record for the month and can report a concern (no login).
- Cleaners log in with a PIN and scan the same QR inside the app to start an inspection.
- Concerns, missed rounds and a daily summary go by email (from the housekeeping Gmail) to the housekeeping office, plus a pop-up in the app.
- Anyone who scans a room QR also gets a **Call housekeeping** button: normal call, WhatsApp, or escalate to HR (call or WhatsApp). The WhatsApp message is pre-filled with the room name.
- The stock list is shown as-is (snacks and drinks, and other requirements). Stock counting comes in the next version.

## Setup (about 30 minutes)

### 1. Housekeeping Gmail
Create a separate Gmail account for housekeeping (for example `mentari.housekeeping@gmail.com`). Do all steps below while signed in to it. Emails are sent from this account.

### 2. Google Sheet and script
1. In Google Drive create a new Google Sheet named **Mentari Housekeeping**.
2. Open **Extensions > Apps Script**.
3. Delete the default code and paste the full contents of `apps-script/Code.gs`.
4. Click the gear icon (Project Settings) and tick **Show "appsscript.json" manifest file in editor**. Open `appsscript.json` and replace it with the file of the same name in this repo.
5. Save, then reload the Sheet. A **Housekeeping** menu appears.

### 3. First run
1. **Housekeeping > 1. Setup (first time only)**. Approve the permissions (Sheets, Drive, Mail). Google shows an "unverified app" warning for your own script: Advanced > Go to project.
2. A message lists the **PINs** of the 5 starter users. Write them down. Rename people and set roles in the **Users** sheet (roles: cleaner, supervisor, admin). Use **Set or reset a PIN** for new PINs.
3. In the **Config** sheet fill in `OFFICE_EMAILS` (housekeeping office staff, comma separated). `REMINDER_EMAILS` is optional (people who should get round reminders by email).
4. **Housekeeping > 2. Install reminders and alerts** (round check every 10 minutes, daily summary at 18:00).
5. **Housekeeping > Send a test email** to confirm mail works, then **Check everything**.

### 4. Publish the backend
1. **Deploy > New deployment > Web app**. Execute as: **Me**. Who has access: **Anyone**.
2. Copy the web app URL (ends in `/exec`).
3. After any later code change use **Deploy > Manage deployments > Edit > New version**.

### 5. GitHub Pages
1. Create a repository (for example `mentari-housekeeping`) and upload everything in this folder.
2. Edit `config.js`: `window.HK_CONFIG = { API_URL: 'PASTE THE /exec URL HERE' };`
3. Settings > Pages > Deploy from branch `main`, folder `/ (root)`.
4. Your app address will be `https://<account>.github.io/mentari-housekeeping/`. Put it in the **Config** sheet as `APP_URL` (used in emails).

### 6. Print the QR labels
1. Open the app, log in as the admin (Iggy), **More > QR labels**.
2. Check that the address in the box is your GitHub Pages address, press **Update**, then **Print labels**. Laminate and stick inside each room, away from the door.
3. If the address changes, print the labels again.

### 7. Staff phones
Open the app address in Chrome (Android) or Safari (iPhone) and **Add to Home screen**. In **More** tap **Turn on phone alerts**.

## Adjusting the content (no coding)
- **Rooms**: names, location, photo required yes/no, which rounds apply, active yes/no. The 13 rooms are placeholders: rename and add yours. Run **Setup** again to give new rooms their keys.
- **Rounds**: times of each round (corridors 3 times a day, toilets, MMC morning and afternoon check-only visits).
- **Checklists**: the items per room type. Day and round columns restrict an item (cobwebs only on Friday).
- **Holidays**: dates with no rounds. **Inventory**: the stock list.
- **Config**: dwell time, early and late limits, email addresses, and the contact numbers for the Call button: `HK_PHONE`, `HK_WHATSAPP`, `HR_PHONE`, `HR_WHATSAPP` (leave a number empty to hide it; WhatsApp falls back to the phone number).

## Anti-fake measures
- The QR holds a secret key per room. Wrong key means no inspection.
- A minimum of 60 seconds between scanning and submitting, checked by the server.
- A photo and a note are mandatory for "not done / needs action" and for rooms marked photo required.
- A round is credited once. Scans more than 2 hours late count as "Extra" with no credit.
- The dashboard flags inspections finished suspiciously close together.
- Limit: software cannot fully stop someone photographing a QR and scanning it from elsewhere. The timer, photos and spot checks make it hard and visible.

## Notifications
- Email works whether or not anyone has the app open.
- Pop-ups, beep and phone alerts work **only while the app is open** (it checks every 45 seconds). A web app cannot alert when fully closed without a push service. Option: **Housekeeping > Telegram alerts (optional)** gives alerts with the app closed.

## Files
`index.html` app, `config.js` backend address, `sw.js` offline shell, `manifest.json`, `icons/`, `fonts/`, `vendor/` (jsQR, qrcode-generator), `apps-script/Code.gs` and `appsscript.json` backend.
