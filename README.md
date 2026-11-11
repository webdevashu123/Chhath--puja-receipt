# 🪔 Chhath Puja Donation Portal & A4 PDF Generator

A unified, mobile-first full-stack donation management portal and bilingual A4 PDF receipt generator for **Chhath Puja Samiti (Yogidih, Dudhari · 2026)**.

Built with **React 19**, **Tailwind CSS v4**, **Node.js (Express 5)**, **SQLite (better-sqlite3)** in WAL mode, and **Puppeteer** with embedded Indic fonts.

---

## 📋 Architecture & Highlights

- **Unified Single-Service App**: Express serves the React frontend (SPA) from `/dist` as static assets and powers all `/api/*` and `/r/:token` public endpoints.
- **SQLite query engine with MongoDB Atlas persistence**: The current synchronous SQLite query layer remains local for compatibility. A consistent SQLite snapshot is uploaded to Atlas before each write API response, then restored on service startup. This keeps donation, donor, setting, counter, and audit data durable across Render Free restarts.
- **Strictly Sequential Bill Numbers**: Atomic counter sequence starting at **1001** (`1001`, `1002`, `1003`...) handled inside an SQLite transaction. Guarantees no two simultaneous requests ever get the same bill number.
- **Donor Matching**: Donors are identified by their unique 10-digit phone number. Existing donors are reused; names are updated only if previously empty.
- **Official Bilingual A4 PDF Receipt Generator**:
  - Uses canonical `receipt.html` template with embedded Devanagari and Latin fonts (`Hind`, `Poppins`, `Tiro Devanagari`).
  - Rendered via a Puppeteer singleton with an automated concurrency limiter (max 2 concurrent renders).
  - Browser crash auto-recovery and relaunch.
  - Generates exact 1-page A4 receipts with custom decorative borders, watermarks, toran banners, and dual-language number words (Hindi and English).
- **WhatsApp PDF Sharing**:
  - **Primary (Mobile)**: Uses the **Web Share API Level 2** (`navigator.share({ files: [file], ... })`), downloading the generated PDF and attaching the actual document into WhatsApp chat.
  - **Fallback (Desktop / Unsupported Browsers)**: Opens `https://wa.me/91<phone>?text=...` with the prefilled bilingual message and an unguessable public share link (`/r/:token`).
  - **Optional (WhatsApp Cloud API)**: Configurable direct document transmission via Meta Graph API v19.0.
- **Automated Daily Backups**: Live online snapshot of `app.db` saved daily at midnight into `./data/backups/`, retaining the last 14 backups.
- **Security & Hardening**:
  - Admin login protected by bcrypt hash and rate-limited to 5 attempts per 10 minutes.
  - HttpOnly 12-hour session cookies (`cps_auth`).
  - Input validation with Zod.
  - Full UTF-8 support end-to-end (Hindi names and notes render flawlessly in PDF, DB, and Excel).
  - UTF-8 BOM (`\uFEFF`) included in CSV exports for direct opening in Microsoft Excel.
  - XSS mitigation via React JSX text escaping and sanitized template interpolation.

---

## ⚙️ Environment Variables

Create a `.env` file in the root directory (refer to `.env.example`):

```bash
# Server Port
PORT=5000
NODE_ENV=production

# CORS Origin
ORIGIN=http://localhost:5173

# Admin PIN Bcrypt Hash (Default corresponds to PIN: 2026)
# Generate a new hash with: node scripts/hash-pin.js <PIN>
ADMIN_PIN_HASH=$2b$10$tAsGY5oFYr7ehZKA8HTVN.EBBudbBjpH5Aom1eiUzEnyojhO/iWYi

# JWT Secret for Admin Session Cookies
JWT_SECRET=chhath-puja-samiti-super-secret-jwt-key-2026

# Public Base URL for Share Links (/r/:token)
PUBLIC_BASE_URL=http://localhost:5000

# MongoDB Atlas (required in production; local development can omit it)
MONGODB_URI=mongodb+srv://<db-user>:<password>@<cluster>.mongodb.net/?retryWrites=true&w=majority
MONGODB_DATABASE=chhath_puja

# Optional path to system Chromium/Chrome binary (required in Docker/Linux VPS)
CHROME_PATH=

# Optional WhatsApp Cloud API Integration
WHATSAPP_CLOUD_ENABLED=false
WHATSAPP_TOKEN=
WHATSAPP_PHONE_ID=
WHATSAPP_TEMPLATE_NAME=
```

### Generating a New Admin PIN Hash
Run the included hash generator script:
```bash
node scripts/hash-pin.js 1234
```
Copy the printed bcrypt hash into `ADMIN_PIN_HASH` in `.env`.

---

## 🚀 Running Locally

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Mode
Runs both the Express backend and the Vite dev server concurrently:
```bash
npm run dev
```
- Frontend UI: [http://localhost:5173](http://localhost:5173)
- Backend API: [http://localhost:5000](http://localhost:5000)

### 3. Production Build & Start
```bash
# Build Vite frontend assets into /dist
npm run build

# Start the full-stack server (serves frontend + API + PDF renderer)
npm start
```
Open [http://localhost:5000](http://localhost:5000) in your browser.

### Render Free + MongoDB Atlas

Create an Atlas database user and allow the Render service to connect in the Atlas Network Access settings. In Render, open **Environment** and set `MONGODB_URI` to the Atlas connection string (URL-encode special characters in the password). `MONGODB_DATABASE` defaults to `chhath_puja`. Production startup intentionally fails when `MONGODB_URI` is missing or Atlas cannot be reached, so the app cannot silently accept writes to Render's temporary disk.

Atlas stores SQLite snapshots in GridFS; the app uploads the current database at startup and after each write, retains the latest snapshot, and restores it before serving requests. Render's already-lost ephemeral data cannot be recovered by this migration.

---

## 🐳 Docker Deployment

The application includes a production-grade `Dockerfile` based on `node:20-bookworm-slim` pre-configured with Chromium, dumb-init, and Google Noto fonts (`fonts-noto-core`, `fonts-noto-cjk`, `fonts-indic`, `fonts-deva-extra`).

### With Docker Compose (Recommended)
```bash
# Build and run the container with persistent volume for ./data
docker compose up -d --build
```
This automatically mounts `./data` on the host to `/app/data` in the container, ensuring the SQLite database (`app.db`), generated receipts (`/data/receipts`), and backups (`/data/backups`) persist across restarts and updates.

### Manual Docker Build & Run
```bash
docker build -t chhath-puja-portal .
docker run -d -p 5000:5000 -v $(pwd)/data:/app/data --name chhath-portal chhath-puja-portal
```

> **Note on Serverless vs Containers**: Puppeteer runs headless Chromium and requires a container or real server (Docker, Render Web Service, Railway, Fly.io, or VPS). Pure serverless functions (like AWS Lambda without layers or Vercel standard) have execution limits and cannot run persistent Puppeteer browser singletons.

---

## 📱 WhatsApp Sharing Configuration

### 1. Mobile Web Share (Level 2)
On modern mobile browsers (iOS Safari, Android Chrome over HTTPS), clicking **Share on WhatsApp** fetches the rendered PDF, creates a `File` object, and invokes:
```js
navigator.share({
  files: [pdfFile],
  title: "Donation Receipt #1001",
  text: "नमस्ते श्री रामेश्वर प्रसाद सिंह जी..."
});
```
This directly attaches the generated A4 PDF file into the WhatsApp chat.

### 2. Fallback (Desktop / Unsupported Browsers)
Desktop browsers and non-HTTPS environments do not support file attachments via Web Share. In these cases, clicking WhatsApp opens:
`https://wa.me/91<phone>?text=<encoded_message>` with the public share link:
`http://localhost:5000/r/<unguessable_token>`
Devotees can view or download their A4 receipt directly from this link without logging in.

### 3. Optional: WhatsApp Cloud API (Automated)
To automatically push the PDF document from Meta's servers when a donation is submitted:
1. Set `WHATSAPP_CLOUD_ENABLED=true` in `.env`.
2. Provide your `WHATSAPP_TOKEN` (System User Access Token) and `WHATSAPP_PHONE_ID` from Meta for Developers.
3. **Important Note on Meta 24-Hour Messaging Window**: Freeform messages and media can only be initiated within an active 24-hour customer service window. For unsolicited initial messages, a Meta-approved Message Template is required.

---

## 💾 Database Backups & Restore

### Automated Backups
- The server automatically triggers a backup every midnight (`00:00`) via `node-cron`.
- Backups use `better-sqlite3`'s live backup API (`db.backup(...)`), which creates a lock-free snapshot even while donations are being submitted.
- Files are saved as `data/backups/app-YYYY-MM-DD-HHmmss.db`.
- The system automatically retains the **last 14 backups** and deletes older archives.

### Manual Backup
To create an immediate backup programmatically:
```bash
npx tsx -e "import { performBackup } from './server/services/backupService.ts'; performBackup();"
```

### Restoring from Backup
1. Stop the application server:
   ```bash
   # If running via systemd or node
   pkill -f "server/index.ts"
   # Or with Docker
   docker compose down
   ```
2. Copy the desired backup file over `data/app.db`:
   ```bash
   cp data/backups/app-<TIMESTAMP>.db data/app.db
   ```
3. Restart the server:
   ```bash
   npm start # or docker compose up -d
   ```

---

## 🧪 Verification & Test Results

Run the full automated end-to-end verification suite:
```bash
npx tsx scripts/verify-all.ts
```

### Verification Checklist & Results:
- [x] **Test 1: 3 Sequential Donations**: Created donations with Hindi name (`श्री रामेश्वर प्रसाद सिंह`), note (`घाट निर्माण एवं दीप सेवा`), and large amount (`₹1,51,000`). Confirmed sequential bill numbers `1001` -> `1002` -> `1003` in DB.
- [x] **Test 2: 10 Parallel POSTs**: Dispatched 10 concurrent requests simultaneously. Confirmed all 10 received unique sequential numbers (`1004` through `1013`) with 0 duplicates.
- [x] **Test 3: Generated A4 PDFs**: Verified on-disk files in `./data/receipts/`. Verified valid PDF header `%PDF-`, 1 page A4 layout, embedded Hindi and English typography, and border frames.
- [x] **Test 4: Share Link, Search, Soft Delete, CSV Export**:
  - Public `/r/:token` link served PDF without authentication.
  - Admin login verified with bcrypt hash (`ADMIN_PIN_HASH`) and set secure `cps_auth` cookie.
  - Donor search by Hindi substring (`रामेश्वर`) and phone (`9876543210`) returned matching profile and donation histories.
  - Soft delete confirmed: `deleted_at` set to current timestamp; record excluded from active statistics and listings.
  - CSV export verified: starts with UTF-8 BOM (`0xEF, 0xBB, 0xBF`), preserves Hindi characters in Excel.
- [x] **Test 5: 390px Mobile Viewport**: Tested mobile flow from donation form to receipt screen and WhatsApp share link resolution.

---

## 📌 Items Not Done / Notes

All core deliverables requested in the prompt have been fully implemented and verified.
- **WhatsApp Cloud API Template Approval**: The Cloud API integration is coded and ready behind `WHATSAPP_CLOUD_ENABLED=true`. Because Meta requires business verification and template registration for unsolicited messages outside the 24-hour window, it is disabled by default in favor of the instant client-side Web Share API Level 2 and `wa.me` share links.
