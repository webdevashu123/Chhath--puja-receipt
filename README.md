# 🪔 Chhath Puja Donation App (2026)

Full-stack donation and accounting portal for **Chhath Puja Samiti (Yogidih, Dudhari · 2026)** built with React 19, TypeScript, Tailwind CSS v4, Express, and SQLite.

---

## 🌟 Key Features

- **Relational SQL Database (SQLite)**: 100% Free, zero-configuration, ACID-compliant database stored locally on disk (`server/data/donations.db`). No cloud account or external database signup required.
- **Sequential Bill Generation**: Automatic numbering starting from `CP-2026-001`.
- **Live Aggregated Statistics**: Real-time total funds collected, goal progress (Goal: ₹2,51,000), today's collection, unique donors, and cash vs. online split.
- **Donation Receipts**:
  - Instant digital receipt generation.
  - **Download PDF**: Standard formatted receipt.
  - **WhatsApp Sharing**: 1-click WhatsApp message to donor with complete bill details.
  - **Print**: Clean printable receipt layout.
- **Record Reconciliation (Tally Matching)**:
  - Match physical cash box collections or bank statement UPI credits against recorded donations.
  - Automatic discrepancy tracking.
- **CSV / Excel Export**: Full download of records formatted for Excel and Google Sheets.
- **Donor Directory & History**: Search donors by full name or 10-digit mobile number with total contributions and historical timeline.
- **Admin Passcode**: Protected administration access (Default PIN: `2026`).

---

## 🚀 Local Development

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Both Backend & Frontend
```bash
npm run dev
```
- **Frontend App**: [http://localhost:5173](http://localhost:5173)
- **Backend API Server**: [http://localhost:5000](http://localhost:5000)

---

## 🌐 Deploy Live (Free Cloud Hosting)

This project is a complete full-stack app (Express serves the built React frontend in production). You can deploy it for **FREE** in 2 minutes on **Render** or **Railway**:

### Option A: Deploy on Render (Recommended - 100% Free)
1. Go to [render.com](https://render.com) and sign in with GitHub.
2. Click **New +** -> **Web Service**.
3. Select your repository: `webdevashu123/Chhath--puja-receipt`.
4. Configure settings:
   - **Environment**: `Node`
   - **Build Command**: `npm install && npm run build`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
5. Click **Create Web Service**. Your app is live with a public URL (e.g. `https://chhath-puja-receipt.onrender.com`)!

### Option B: Deploy on Railway
1. Go to [railway.app](https://railway.app) and sign in with GitHub.
2. Click **New Project** -> **Deploy from GitHub repo**.
3. Select `webdevashu123/Chhath--puja-receipt`.
4. Railway will automatically detect Node.js, run `npm install && npm run build`, and launch `npm start`.

---

## 🧪 Verification Test Suite

To run the automated verification checks:
```bash
node server/scripts/verify.js
```
