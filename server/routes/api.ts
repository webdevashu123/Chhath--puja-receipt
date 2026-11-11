import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import db, { getNextBillNo, findOrCreateDonor } from '../db/database.ts';
import { renderReceiptPDF, saveReceiptPDF, getReceiptPath } from '../services/pdfService.ts';
import { requireAdminAuth, generateAdminToken, loginRateLimiter } from '../middleware/auth.ts';
import { getWhatsAppMessage, sendWhatsAppReceiptCloud } from '../services/whatsappService.ts';

const router = express.Router();

// ---------- Validation Schemas ----------
const createDonationSchema = z.object({
  donorName: z.string().trim().min(1, 'Donor name is required'),
  phone: z.string().trim().regex(/^\d{10}$/, 'Phone number must be exactly 10 digits'),
  amount: z.number().int().positive('Amount must be a positive integer'),
  paymentMode: z.enum(['Cash', 'Online', 'PhonePe', 'GPay', 'Cheque']),
  note: z.string().optional().default(''),
  clientId: z.string().optional(),
});

const adminLoginSchema = z.object({
  pin: z.string().min(1, 'PIN is required'),
});

function getPublicBaseUrl(req: Request): string {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

router.post('/admin/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = adminLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid PIN' });
      return;
    }

    const { pin } = parseResult.data;
    const adminHash = process.env.ADMIN_PIN_HASH;

    if (!adminHash) {
      console.error('[Admin Login] ADMIN_PIN_HASH environment variable is not configured');
      res.status(500).json({ error: 'Server authentication configuration missing' });
      return;
    }

    const isMatch = await bcrypt.compare(pin, adminHash);
    if (!isMatch) {
      res.status(401).json({ error: 'Incorrect PIN. Access denied.' });
      return;
    }

    const token = generateAdminToken();
    const isProduction = process.env.NODE_ENV === 'production';

    res.cookie('cps_auth', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'lax',
      maxAge: 12 * 60 * 60 * 1000, // 12 hours
      path: '/',
    });

    res.json({ success: true, message: 'Admin authenticated successfully' });
  } catch (error) {
    console.error('[Admin Login Error]:', error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

router.post('/admin/logout', (req: Request, res: Response) => {
  res.clearCookie('cps_auth', { path: '/' });
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/admin/check', (req: Request, res: Response) => {
  const token = req.cookies?.cps_auth || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
  if (!token) {
    res.json({ authenticated: false });
    return;
  }
  try {
    const jwtSecret = process.env.JWT_SECRET || 'chhath-puja-samiti-super-secret-jwt-key-2026';
    jwt.verify(token, jwtSecret);
    res.json({ authenticated: true });
  } catch {
    res.json({ authenticated: false });
  }
});

// ==========================================
// 2. DONATION CREATION (Public / Volunteer)
// ==========================================

router.post('/donations', async (req: Request, res: Response) => {
  try {
    const parseResult = createDonationSchema.safeParse(req.body);
    if (!parseResult.success) {
      res.status(400).json({ error: parseResult.error.errors[0]?.message || 'Invalid input data' });
      return;
    }

    const { donorName, phone, amount, paymentMode, note, clientId } = parseResult.data;
    const publicBaseUrl = getPublicBaseUrl(req);

    // Idempotency check: if clientId already exists, return previous record immediately
    if (clientId) {
      const existing = db.prepare(`
        SELECT id, bill_no, share_token, pdf_path
        FROM donations
        WHERE client_id = ?
      `).get(clientId) as { id: number; bill_no: string; share_token: string; pdf_path: string } | undefined;

      if (existing) {
        res.json({
          id: existing.id,
          billNo: existing.bill_no,
          pdfUrl: `/api/donations/${existing.id}/receipt.pdf`,
          shareUrl: `${publicBaseUrl}/r/${existing.share_token}`,
        });
        return;
      }
    }

    // Generate unique unguessable share token
    const shareToken = crypto.randomBytes(16).toString('hex');

    // Run DB transaction: atomic sequential bill_no, find/create donor, insert donation
    const insertResult = db.transaction(() => {
      const billNoNumber = getNextBillNo();
      const billNo = String(billNoNumber);

      const donor = findOrCreateDonor(phone, donorName);

      const info = db.prepare(`
        INSERT INTO donations (
          donor_id, bill_no, amount, payment_mode, note, share_token, client_id, pdf_path
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        donor.id,
        billNo,
        amount,
        paymentMode,
        note || '',
        shareToken,
        clientId || null,
        getReceiptPath(billNo)
      );

      return {
        id: Number(info.lastInsertRowid),
        billNo,
        donor,
      };
    })();

    const { id, billNo, donor } = insertResult;
    const shareUrl = `${publicBaseUrl}/r/${shareToken}`;

    // Generate and persist receipt PDF
    const pdfPath = await saveReceiptPDF({
      billNo,
      donorName: donor.name,
      phone: donor.phone,
      amount,
      paymentMode,
      note,
      date: new Date(),
    });

    // Optional WhatsApp Cloud API message send
    sendWhatsAppReceiptCloud({
      phone: donor.phone,
      name: donor.name,
      amount,
      billNo,
      shareUrl,
      pdfPath,
    }).catch((e) => console.warn('[WhatsApp Cloud Background]:', e));

    res.status(201).json({
      id,
      billNo,
      pdfUrl: `/api/donations/${id}/receipt.pdf`,
      shareUrl,
    });
  } catch (error) {
    console.error('[Donation Create Error]:', error);
    res.status(500).json({ error: 'Failed to process donation' });
  }
});

// ==========================================
// 3. ADMIN DONATION LIST & FILTERS
// ==========================================

router.get('/donations', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const { search, mode, from, to, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const conditions: string[] = ['donations.deleted_at IS NULL'];
    const params: any[] = [];

    if (search && String(search).trim()) {
      const q = `%${String(search).trim()}%`;
      conditions.push('(donors.name LIKE ? OR donors.phone LIKE ? OR donations.bill_no LIKE ?)');
      params.push(q, q, q);
    }

    if (mode && String(mode).trim() && String(mode) !== 'All') {
      conditions.push('donations.payment_mode = ?');
      params.push(String(mode).trim());
    }

    if (from && String(from).trim()) {
      conditions.push('donations.created_at >= ?');
      params.push(`${String(from).trim()} 00:00:00`);
    }

    if (to && String(to).trim()) {
      conditions.push('donations.created_at <= ?');
      params.push(`${String(to).trim()} 23:59:59`);
    }

    const whereClause = conditions.join(' AND ');

    // Aggregate totals
    const totalsQuery = `
      SELECT COUNT(*) as totalCount, COALESCE(SUM(donations.amount), 0) as totalAmount
      FROM donations
      JOIN donors ON donations.donor_id = donors.id
      WHERE ${whereClause}
    `;
    const totals = db.prepare(totalsQuery).get(...params) as { totalCount: number; totalAmount: number };

    // Paginated list
    const listQuery = `
      SELECT 
        donations.id,
        donations.bill_no as billNo,
        donations.amount,
        donations.payment_mode as paymentMode,
        donations.note,
        donations.created_at as createdAt,
        donations.share_token as shareToken,
        donors.id as donorId,
        donors.name as donorName,
        donors.phone
      FROM donations
      JOIN donors ON donations.donor_id = donors.id
      WHERE ${whereClause}
      ORDER BY donations.id DESC
      LIMIT ? OFFSET ?
    `;

    const donations = db.prepare(listQuery).all(...params, limitNum, offset) as any[];
    const publicBaseUrl = getPublicBaseUrl(req);

    const formattedDonations = donations.map((d) => ({
      ...d,
      pdfUrl: `/api/donations/${d.id}/receipt.pdf`,
      shareUrl: `${publicBaseUrl}/r/${d.shareToken}`,
    }));

    res.json({
      donations: formattedDonations,
      totalAmount: totals.totalAmount,
      totalCount: totals.totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totals.totalCount / limitNum) || 1,
    });
  } catch (error) {
    console.error('[Donations List Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve donations' });
  }
});

// ==========================================
// 4. RECEIPT PDF STREAM / DOWNLOAD
// ==========================================

router.get('/donations/:id/receipt.pdf', async (req: Request, res: Response) => {
  try {
    const donationId = parseInt(req.params.id, 10);
    if (!donationId) {
      res.status(400).json({ error: 'Invalid donation ID' });
      return;
    }

    const donation = db.prepare(`
      SELECT 
        donations.id,
        donations.bill_no as billNo,
        donations.amount,
        donations.payment_mode as paymentMode,
        donations.note,
        donations.created_at as createdAt,
        donations.deleted_at as deletedAt,
        donors.name as donorName,
        donors.phone
      FROM donations
      JOIN donors ON donations.donor_id = donors.id
      WHERE donations.id = ?
    `).get(donationId) as any;

    if (!donation || donation.deletedAt) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    const targetPdfPath = getReceiptPath(donation.billNo);

    // If file missing on disk, regenerate on-the-fly
    if (!fs.existsSync(targetPdfPath)) {
      console.log(`[Receipt] PDF missing on disk for bill #${donation.billNo}. Regenerating...`);
      await saveReceiptPDF({
        billNo: donation.billNo,
        donorName: donation.donorName,
        phone: donation.phone,
        amount: donation.amount,
        paymentMode: donation.paymentMode,
        note: donation.note,
        date: donation.createdAt,
      });
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="receipt_${donation.billNo}.pdf"`);
    fs.createReadStream(targetPdfPath).pipe(res);
  } catch (error) {
    console.error('[Receipt PDF Error]:', error);
    res.status(500).json({ error: 'Could not stream receipt PDF' });
  }
});

// ==========================================
// 5. SOFT DELETE DONATION (Admin)
// ==========================================

router.delete('/donations/:id', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const donationId = parseInt(req.params.id, 10);
    if (!donationId) {
      res.status(400).json({ error: 'Invalid donation ID' });
      return;
    }

    const result = db.prepare(`
      UPDATE donations
      SET deleted_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(donationId);

    if (result.changes === 0) {
      res.status(404).json({ error: 'Donation not found or already deleted' });
      return;
    }

    res.json({ success: true, message: 'Donation soft-deleted successfully' });
  } catch (error) {
    console.error('[Donation Delete Error]:', error);
    res.status(500).json({ error: 'Failed to delete donation' });
  }
});

// ==========================================
// 6. DONORS SEARCH & PROFILE (Reach Portal)
// ==========================================

router.get('/donors/search', (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ donors: [] });
      return;
    }

    const queryWildcard = `%${q}%`;
    const donors = db.prepare(`
      SELECT id, name, phone, created_at as createdAt
      FROM donors
      WHERE phone LIKE ? OR name LIKE ?
      ORDER BY id DESC
      LIMIT 20
    `).all(queryWildcard, queryWildcard) as any[];

    const publicBaseUrl = getPublicBaseUrl(req);

    const results = donors.map((donor) => {
      const stats = db.prepare(`
        SELECT COALESCE(SUM(amount), 0) as totalDonated, COUNT(*) as donationCount
        FROM donations
        WHERE donor_id = ? AND deleted_at IS NULL
      `).get(donor.id) as { totalDonated: number; donationCount: number };

      const history = db.prepare(`
        SELECT 
          id,
          bill_no as billNo,
          amount,
          payment_mode as paymentMode,
          note,
          created_at as createdAt,
          share_token as shareToken
        FROM donations
        WHERE donor_id = ? AND deleted_at IS NULL
        ORDER BY id DESC
      `).all(donor.id) as any[];

      const formattedHistory = history.map((item) => ({
        ...item,
        pdfUrl: `/api/donations/${item.id}/receipt.pdf`,
        shareUrl: `${publicBaseUrl}/r/${item.shareToken}`,
      }));

      return {
        id: donor.id,
        name: donor.name,
        phone: donor.phone,
        createdAt: donor.createdAt,
        totalDonated: stats.totalDonated,
        donationCount: stats.donationCount,
        history: formattedHistory,
      };
    });

    res.json({ donors: results });
  } catch (error) {
    console.error('[Donor Search Error]:', error);
    res.status(500).json({ error: 'Donor search failed' });
  }
});

// ==========================================
// 7. STATS (Home / Dashboard / Admin)
// ==========================================

router.get('/stats', (req: Request, res: Response) => {
  try {
    // Total collected and donation count
    const overall = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as totalCollected, COUNT(*) as totalDonations
      FROM donations
      WHERE deleted_at IS NULL
    `).get() as { totalCollected: number; totalDonations: number };

    // Today's total (using local time)
    const today = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as todayTotal
      FROM donations
      WHERE deleted_at IS NULL AND date(created_at, 'localtime') = date('now', 'localtime')
    `).get() as { todayTotal: number };

    // Unique active donors count
    const uniqueDonors = db.prepare(`
      SELECT COUNT(DISTINCT donor_id) as donorCount
      FROM donations
      WHERE deleted_at IS NULL
    `).get() as { donorCount: number };

    // Split by payment mode
    const modes = db.prepare(`
      SELECT payment_mode as mode, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM donations
      WHERE deleted_at IS NULL
      GROUP BY payment_mode
    `).all() as { mode: string; total: number; count: number }[];

    const splitByMode: Record<string, { total: number; count: number }> = {
      Cash: { total: 0, count: 0 },
      Online: { total: 0, count: 0 },
      PhonePe: { total: 0, count: 0 },
      GPay: { total: 0, count: 0 },
      Cheque: { total: 0, count: 0 },
    };

    for (const m of modes) {
      if (splitByMode[m.mode]) {
        splitByMode[m.mode] = { total: m.total, count: m.count };
      } else {
        splitByMode[m.mode] = { total: m.total, count: m.count };
      }
    }

    res.json({
      totalCollected: overall.totalCollected,
      todayTotal: today.todayTotal,
      donorCount: uniqueDonors.donorCount,
      totalDonations: overall.totalDonations,
      splitByMode,
    });
  } catch (error) {
    console.error('[Stats Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// ==========================================
// 8. CSV EXPORT (Admin, UTF-8 BOM)
// ==========================================

router.get('/export.csv', requireAdminAuth, (req: Request, res: Response) => {
  try {
    const rows = db.prepare(`
      SELECT 
        donations.bill_no as billNo,
        donations.created_at as createdAt,
        donors.name as donorName,
        donors.phone,
        donations.amount,
        donations.payment_mode as paymentMode,
        donations.note
      FROM donations
      JOIN donors ON donations.donor_id = donors.id
      WHERE donations.deleted_at IS NULL
      ORDER BY donations.id DESC
    `).all() as any[];

    // CSV Escape helper
    const escapeCsv = (val: unknown) => {
      const s = String(val ?? '');
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };

    const headers = ['Bill No', 'Date', 'Time', 'Donor Name', 'Phone', 'Amount', 'Payment Mode', 'Note'];
    const lines = [headers.join(',')];

    for (const r of rows) {
      const dateObj = new Date(r.createdAt);
      const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

      lines.push([
        escapeCsv(r.billNo),
        escapeCsv(dateStr),
        escapeCsv(timeStr),
        escapeCsv(r.donorName),
        escapeCsv(r.phone),
        escapeCsv(r.amount),
        escapeCsv(r.paymentMode),
        escapeCsv(r.note || ''),
      ].join(','));
    }

    // Prepend UTF-8 BOM (\uFEFF) so Excel opens Hindi characters properly
    const csvContent = '\uFEFF' + lines.join('\r\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="donations_export.csv"');
    res.send(csvContent);
  } catch (error) {
    console.error('[CSV Export Error]:', error);
    res.status(500).json({ error: 'Failed to generate CSV export' });
  }
});

export default router;
