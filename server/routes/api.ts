import express, { type Request, type Response } from 'express';
import crypto from 'node:crypto';
import fs from 'node:fs';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { ObjectId } from 'mongodb';
import { z } from 'zod';
import { getCollection, nextSequence, normalizeName, type DonationDocument, type DonorDocument, type ExpenseDocument } from '../db/database.ts';
import { saveReceiptPDF, getReceiptPath, isValidReceiptPDF, renderPrintableReceiptHTML } from '../services/pdfService.ts';
import { requireAdminAuth, generateAdminToken, loginRateLimiter } from '../middleware/auth.ts';
import { sendWhatsAppReceiptCloud } from '../services/whatsappService.ts';

const router = express.Router();

// ---------- Validation Schemas (Strict English-only rules) ----------
const NAME_REGEX = /^[A-Za-z][A-Za-z .'-]{1,59}$/;
const NOTE_REGEX = /^[\x20-\x7E]{0,120}$/;

const createDonationSchema = z.object({
  donorName: z
    .string()
    .trim()
    .regex(NAME_REGEX, 'Please enter the name in English'),
  phone: z
    .string()
    .trim()
    .regex(/^\d{10}$/, 'Phone number must be exactly 10 digits'),
  amount: z
    .number()
    .int()
    .positive('Amount must be a positive integer'),
  paymentMode: z.enum(['Cash', 'Online', 'PhonePe', 'GPay', 'Cheque']),
  note: z
    .string()
    .regex(NOTE_REGEX, 'Please enter the note in English (letters, numbers and symbols only)')
    .optional()
    .default(''),
  clientId: z.string().optional(),
});

const adminLoginSchema = z.object({
  pin: z.string().min(1, 'PIN is required'),
});

const expenseSchema = z.object({
  category: z.string().trim().min(1, 'Choose or enter an expense category').max(60),
  description: z.string().trim().min(1, 'Enter what was purchased or paid for').max(160),
  amount: z.number().int().positive('Amount must be a positive integer'),
  spentOn: z.string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid expense date')
    .refine((value) => {
      const parsed = new Date(`${value}T00:00:00Z`);
      return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
    }, 'Enter a real calendar date'),
  note: z.string().trim().max(250).optional().default(''),
});

function getPublicBaseUrl(req: Request): string {
  return process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`;
}

const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const activeDonations = { deleted_at: null };

// ==========================================
// 1. ADMIN AUTHENTICATION
// ==========================================

router.post('/admin/login', loginRateLimiter, async (req: Request, res: Response) => {
  try {
    const parseResult = adminLoginSchema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.issues?.[0]?.message || 'Invalid PIN';
      res.status(400).json({ error: errorMsg });
      return;
    }

    const { pin } = parseResult.data;
    const adminHash = process.env.ADMIN_PIN_HASH;
    if (!adminHash) {
      console.error('[Admin Login] ADMIN_PIN_HASH is missing. Set it in the server environment.');
      res.status(500).json({ error: 'Server authentication configuration missing. Set ADMIN_PIN_HASH on the backend.' });
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
      const errorMsg = parseResult.error.issues?.[0]?.message || 'Invalid input data';
      res.status(400).json({ error: errorMsg });
      return;
    }

    const { donorName, phone, amount, paymentMode, note, clientId } = parseResult.data;
    const publicBaseUrl = getPublicBaseUrl(req);

    const donations = getCollection<DonationDocument>('donations');
    const donors = getCollection<DonorDocument>('donors');

    // Idempotency check: if clientId already exists, return previous record immediately
    if (clientId) {
      const existing = await donations.findOne({ client_id: clientId });

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

    const { titleCase, lowercase } = normalizeName(donorName);
    const now = new Date();

    // Donors and donations are stored as native MongoDB documents.
    let donor = await donors.findOne({ phone });
    if (!donor) {
      const donorId = await nextSequence('donor_id');
      const candidate: DonorDocument = {
        id: donorId,
        name: titleCase,
        name_normalized: lowercase,
        phone,
        address: '',
        total_donated: 0,
        donation_count: 0,
        created_at: now,
        updated_at: now,
      };
      try {
        await donors.updateOne({ phone }, { $setOnInsert: candidate }, { upsert: true });
      } catch (error: any) {
        if (error?.code !== 11000) throw error;
      }
      donor = await donors.findOne({ phone });
    }
    if (!donor) throw new Error('Could not find or create donor record.');
    if (!donor.name?.trim()) {
      await donors.updateOne({ id: donor.id }, { $set: { name: titleCase, name_normalized: lowercase } });
      donor.name = titleCase;
    }

    // Generate unique unguessable share token and allocate atomic bill/document IDs.
    const shareToken = crypto.randomBytes(16).toString('hex');
    const billNo = String(await nextSequence('bill_no'));
    const id = await nextSequence('donation_id');
    const donation: DonationDocument = {
      id,
      donor_id: donor.id,
      name_on_receipt: titleCase,
      bill_no: billNo,
      amount,
      payment_mode: paymentMode,
      note: note || '',
      created_at: now,
      deleted_at: null,
      pdf_path: getReceiptPath(billNo),
      share_token: shareToken,
      client_id: clientId || null,
      phone,
    };

    try {
      await donations.insertOne(donation);
    } catch (error: any) {
      if (error?.code === 11000 && clientId) {
        const existing = await donations.findOne({ client_id: clientId });
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
      throw error;
    }
    await donors.updateOne({ id: donor.id }, { $inc: { total_donated: amount, donation_count: 1 }, $set: { updated_at: now } });

    const shareUrl = `${publicBaseUrl}/r/${shareToken}`;

    // Generate and persist receipt PDF safely
    let pdfPath: string | null = null;
    try {
      pdfPath = await saveReceiptPDF({
        billNo,
        donorName: titleCase,
        phone: donor.phone,
        amount,
        paymentMode,
        note,
        date: new Date(),
      });
    } catch (pdfErr) {
      console.warn(`[Donation Create] Pre-render PDF notice for bill #${billNo}:`, pdfErr);
      // The donation is safely saved in MongoDB. PDF will be generated on demand.
    }

    // Optional WhatsApp Cloud API message send
    if (pdfPath) {
      sendWhatsAppReceiptCloud({
        phone: donor.phone,
        name: titleCase,
        amount,
        billNo,
        shareUrl,
        pdfPath,
      }).catch((e) => console.warn('[WhatsApp Cloud Background]:', e));
    }

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

router.get('/donations', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { search, mode, from, to, page = '1', limit = '20' } = req.query;

    const pageNum = Math.max(1, parseInt(String(page), 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 20));
    const offset = (pageNum - 1) * limitNum;

    const filter: Record<string, any> = { ...activeDonations };
    const donorFilter: Record<string, any> = {};

    if (search && String(search).trim()) {
      const q = String(search).trim();
      const pattern = new RegExp(escapeRegex(q), 'i');
      Object.assign(donorFilter, { $or: [{ phone: pattern }, { name_normalized: pattern }] });
      filter.$or = [{ name_on_receipt: pattern }, { bill_no: pattern }];
    }

    if (mode && String(mode).trim() && String(mode) !== 'All') {
      filter.payment_mode = String(mode).trim();
    }

    if (from && String(from).trim()) {
      filter.created_at = { ...filter.created_at, $gte: new Date(`${String(from).trim()}T00:00:00+05:30`) };
    }

    if (to && String(to).trim()) {
      filter.created_at = { ...filter.created_at, $lte: new Date(`${String(to).trim()}T23:59:59.999+05:30`) };
    }

    const donationCollection = getCollection<DonationDocument>('donations');
    if (Object.keys(donorFilter).length) {
      const matchingDonors = await getCollection<DonorDocument>('donors').find(donorFilter, { projection: { id: 1 } }).toArray();
      const donorIds = matchingDonors.map((donor) => donor.id);
      filter.$or.push({ donor_id: { $in: donorIds } });
    }
    const [totalCount, totals, pageDonations] = await Promise.all([
      donationCollection.countDocuments(filter),
      donationCollection.aggregate([{ $match: filter }, { $group: { _id: null, totalAmount: { $sum: '$amount' } } }]).next(),
      donationCollection.find(filter).sort({ id: -1 }).skip(offset).limit(limitNum).toArray(),
    ]);
    const donorIds = [...new Set(pageDonations.map((d) => d.donor_id))];
    const donors = await getCollection<DonorDocument>('donors').find({ id: { $in: donorIds } }).toArray();
    const phoneByDonor = new Map(donors.map((donor) => [donor.id, donor.phone]));
    const publicBaseUrl = getPublicBaseUrl(req);

    const formattedDonations = pageDonations.map((d) => ({
      id: d.id, billNo: d.bill_no, donorName: d.name_on_receipt, amount: d.amount,
      paymentMode: d.payment_mode, note: d.note, createdAt: d.created_at,
      shareToken: d.share_token, donorId: d.donor_id, phone: d.phone || phoneByDonor.get(d.donor_id),
      pdfUrl: `/api/donations/${d.id}/receipt.pdf`,
      shareUrl: `${publicBaseUrl}/r/${d.share_token}`,
    }));

    res.json({
      donations: formattedDonations,
      totalAmount: totals?.totalAmount || 0,
      totalCount,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(totalCount / limitNum) || 1,
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
    const language = 'en';
    const donationId = parseInt(String(req.params.id), 10);
    if (!donationId) {
      res.status(400).json({ error: 'Invalid donation ID' });
      return;
    }

    const donation = await getCollection<DonationDocument>('donations').findOne({ id: donationId });
    const donor = donation ? await getCollection<DonorDocument>('donors').findOne({ id: donation.donor_id }) : null;

    if (!donation || donation.deleted_at || !donor) {
      res.status(404).json({ error: 'Receipt not found' });
      return;
    }

    const targetPdfPath = getReceiptPath(donation.bill_no, language);

    // If file missing on disk, regenerate on-the-fly
    if (!isValidReceiptPDF(targetPdfPath)) {
      fs.rmSync(targetPdfPath, { force: true });
      try {
        console.log(`[Receipt] PDF missing on disk for bill #${donation.bill_no}. Regenerating...`);
        await saveReceiptPDF({
          billNo: donation.bill_no,
          donorName: donation.name_on_receipt,
          phone: donor.phone,
          amount: donation.amount,
          paymentMode: donation.payment_mode,
          note: donation.note,
          date: donation.created_at,
        }, language);
      } catch (genErr) {
        console.error(`[Receipt] PDF generation failed for bill #${donation.bill_no}:`, genErr);
        res.status(503).json({ error: 'PDF generation failed. Please try again shortly.' });
        return;
      }
    }

    if (isValidReceiptPDF(targetPdfPath)) {
      res.setHeader('Content-Type', 'application/pdf');
      const disposition = req.query.download === '1' ? 'attachment' : 'inline';
      res.setHeader('Content-Disposition', `${disposition}; filename="receipt_${donation.bill_no}_${language}.pdf"`);
      fs.createReadStream(targetPdfPath).pipe(res);
      return;
    }

    res.status(503).json({ error: 'PDF generation did not produce a valid PDF. Check the server Chromium setup.' });
  } catch (error) {
    console.error('[Receipt PDF Error]:', error);
    res.status(500).json({ error: 'Could not stream receipt PDF' });
  }
});

router.get('/donations/:id/receipt.html', async (req: Request, res: Response) => {
  try {
    const donationId = parseInt(String(req.params.id), 10);
    if (!donationId) {
      res.status(400).send('Invalid donation ID');
      return;
    }

    const donation = await getCollection<DonationDocument>('donations').findOne({ id: donationId });
    const donor = donation ? await getCollection<DonorDocument>('donors').findOne({ id: donation.donor_id }) : null;

    if (!donation || donation.deleted_at || !donor) {
      res.status(404).send('Receipt not found');
      return;
    }

    const html = renderPrintableReceiptHTML({
      billNo: donation.bill_no,
      donorName: donation.name_on_receipt,
      phone: donor.phone,
      amount: donation.amount,
      paymentMode: donation.payment_mode,
      note: donation.note,
      date: donation.created_at,
    });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (error) {
    console.error('[Receipt HTML Error]:', error);
    res.status(500).send('Could not render receipt HTML');
  }
});

// ==========================================
// 5. SOFT DELETE DONATION (Admin)
// ==========================================

router.delete('/donations/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const donationId = parseInt(String(req.params.id), 10);
    if (!donationId) {
      res.status(400).json({ error: 'Invalid donation ID' });
      return;
    }

    const donation = await getCollection<DonationDocument>('donations').findOneAndUpdate(
      { id: donationId, ...activeDonations }, { $set: { deleted_at: new Date() } }, { returnDocument: 'before' },
    );
    const result = donation ? { changes: 1 } : { changes: 0 };

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

router.get('/donors/search', async (req: Request, res: Response) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) {
      res.json({ donors: [] });
      return;
    }

    const pattern = new RegExp(escapeRegex(q), 'i');
    const donors = await getCollection<DonorDocument>('donors').find({ $or: [{ phone: pattern }, { name_normalized: pattern }] })
      .sort({ id: -1 }).limit(20).toArray();

    const publicBaseUrl = getPublicBaseUrl(req);

    const results = await Promise.all(donors.map(async (donor) => {
      const history = await getCollection<DonationDocument>('donations').find({ donor_id: donor.id, ...activeDonations }).sort({ id: -1 }).toArray();
      const stats = history.reduce((totals, item) => ({ totalDonated: totals.totalDonated + item.amount, donationCount: totals.donationCount + 1 }), { totalDonated: 0, donationCount: 0 });

      const formattedHistory = history.map((item) => ({
        id: item.id, billNo: item.bill_no, donorName: item.name_on_receipt, amount: item.amount,
        paymentMode: item.payment_mode, note: item.note, createdAt: item.created_at, shareToken: item.share_token,
        pdfUrl: `/api/donations/${item.id}/receipt.pdf`,
        shareUrl: `${publicBaseUrl}/r/${item.share_token}`,
      }));

      return {
        id: donor.id,
        name: donor.name,
        phone: donor.phone, // Always show phone with donor
        createdAt: donor.created_at,
        totalDonated: stats.totalDonated,
        donationCount: stats.donationCount,
        history: formattedHistory,
      };
    }));

    res.json({ donors: results });
  } catch (error) {
    console.error('[Donor Search Error]:', error);
    res.status(500).json({ error: 'Donor search failed' });
  }
});

// ==========================================
// 7. STATS (Home / Dashboard / Admin)
// ==========================================

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const donations = getCollection<DonationDocument>('donations');
    const todayInIndia = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
    const [year, month, day] = todayInIndia.split('-').map(Number);
    const startOfToday = new Date(`${todayInIndia}T00:00:00+05:30`);
    const tomorrowUTC = new Date(Date.UTC(year, month - 1, day + 1));
    const tomorrowInIndia = `${tomorrowUTC.getUTCFullYear()}-${String(tomorrowUTC.getUTCMonth() + 1).padStart(2, '0')}-${String(tomorrowUTC.getUTCDate()).padStart(2, '0')}`;
    const startOfTomorrow = new Date(`${tomorrowInIndia}T00:00:00+05:30`);
    const [overall, today, donorRows, modeRows] = await Promise.all([
      donations.aggregate([{ $match: activeDonations }, { $group: { _id: null, totalCollected: { $sum: '$amount' }, totalDonations: { $sum: 1 } } }]).next(),
      donations.aggregate([{ $match: { ...activeDonations, created_at: { $gte: startOfToday, $lt: startOfTomorrow } } }, { $group: { _id: null, todayTotal: { $sum: '$amount' } } }]).next(),
      donations.distinct('donor_id', activeDonations),
      donations.aggregate([{ $match: activeDonations }, { $group: { _id: '$payment_mode', total: { $sum: '$amount' }, count: { $sum: 1 } } }]).toArray(),
    ]);

    const splitByMode: Record<string, { total: number; count: number }> = {
      Cash: { total: 0, count: 0 },
      Online: { total: 0, count: 0 },
      PhonePe: { total: 0, count: 0 },
      GPay: { total: 0, count: 0 },
      Cheque: { total: 0, count: 0 },
    };

    for (const m of modeRows) {
      if (m._id) splitByMode[m._id] = { total: m.total, count: m.count };
    }

    res.json({
      totalCollected: overall?.totalCollected || 0,
      todayTotal: today?.todayTotal || 0,
      donorCount: donorRows.length,
      totalDonations: overall?.totalDonations || 0,
      splitByMode,
    });
  } catch (error) {
    console.error('[Stats Error]:', error);
    res.status(500).json({ error: 'Failed to retrieve statistics' });
  }
});

// ==========================================
// 8. EXPENSE TRACKER (separate from donations)
// ==========================================

router.get('/expenses', requireAdminAuth, async (_req: Request, res: Response) => {
  try {
    const expenses = await getCollection<ExpenseDocument>('expenses')
      .find({}).sort({ spent_on: -1, created_at: -1 }).limit(5000).toArray();
    const totalAmount = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    res.json({
      expenses: expenses.map((expense) => ({
        id: String(expense._id),
        category: expense.category,
        description: expense.description,
        amount: expense.amount,
        spentOn: expense.spent_on,
        note: expense.note,
        createdAt: expense.created_at,
        updatedAt: expense.updated_at,
      })),
      totalAmount,
    });
  } catch (error) {
    console.error('[Expense List Error]:', error);
    res.status(500).json({ error: 'Could not load expense records' });
  }
});

router.post('/expenses', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const parsed = expenseSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid expense details' });
      return;
    }
    const now = new Date();
    const { spentOn, ...details } = parsed.data;
    const expense: ExpenseDocument = {
      ...details,
      spent_on: spentOn,
      created_at: now,
      updated_at: now,
    };
    const result = await getCollection<ExpenseDocument>('expenses').insertOne(expense);
    res.status(201).json({ id: String(result.insertedId), message: 'Expense saved' });
  } catch (error) {
    console.error('[Expense Create Error]:', error);
    res.status(500).json({ error: 'Could not save expense' });
  }
});

router.put('/expenses/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const expenseId = String(req.params.id);
    const parsed = expenseSchema.extend({ editPin: z.string().min(1, 'Expense edit password is required') }).safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid expense details' });
      return;
    }
    if (!ObjectId.isValid(expenseId)) {
      res.status(400).json({ error: 'Invalid expense record' });
      return;
    }
    const editPinHash = process.env.EXPENSE_EDIT_PIN_HASH;
    if (!editPinHash) {
      res.status(500).json({ error: 'Expense edit password is not configured on the server' });
      return;
    }
    const { editPin, ...data } = parsed.data;
    if (!(await bcrypt.compare(editPin, editPinHash))) {
      res.status(401).json({ error: 'Incorrect expense edit password' });
      return;
    }
    const updated = await getCollection<ExpenseDocument>('expenses').findOneAndUpdate(
      { _id: new ObjectId(expenseId) },
      {
        $set: {
          category: data.category,
          description: data.description,
          amount: data.amount,
          spent_on: data.spentOn,
          note: data.note,
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      res.status(404).json({ error: 'Expense record not found' });
      return;
    }
    res.json({ message: 'Expense updated' });
  } catch (error) {
    console.error('[Expense Update Error]:', error);
    res.status(500).json({ error: 'Could not update expense' });
  }
});

// ==========================================
// 9. CSV EXPORT (Admin, English only)
// ==========================================

router.get('/export.csv', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const donations = await getCollection<DonationDocument>('donations').find(activeDonations).sort({ id: -1 }).toArray();
    const donorIds = [...new Set(donations.map((item) => item.donor_id))];
    const donors = await getCollection<DonorDocument>('donors').find({ id: { $in: donorIds } }).toArray();
    const phoneByDonor = new Map(donors.map((donor) => [donor.id, donor.phone]));
    const rows = donations.map((item) => ({
      billNo: item.bill_no, createdAt: item.created_at, donorName: item.name_on_receipt,
      phone: item.phone || phoneByDonor.get(item.donor_id), amount: item.amount,
      paymentMode: item.payment_mode, note: item.note,
    }));

    // Quote every cell, keep each donation on exactly one physical line, and
    // prevent user-entered text from being interpreted as an Excel formula.
    const escapeCsv = (val: unknown, text = false) => {
      let value = String(val ?? '').replace(/[\r\n]+/g, ' ').trim();
      if (text && /^[=+\-@\t]/.test(value)) value = `'${value}`;
      return `"${value.replace(/"/g, '""')}"`;
    };

    const headers = ['No.', 'Bill No.', 'Date', 'Time', 'Donor Name', 'Phone Number', 'Amount (INR)', 'Payment Mode', 'Note'];
    const lines = [headers.map((header) => escapeCsv(header)).join(',')];

    for (const [index, r] of rows.entries()) {
      const dateObj = new Date(r.createdAt);
      const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

      lines.push([
        escapeCsv(index + 1),
        escapeCsv(r.billNo, true),
        escapeCsv(dateStr),
        escapeCsv(timeStr),
        escapeCsv(r.donorName, true),
        escapeCsv(r.phone, true),
        escapeCsv(r.amount),
        escapeCsv(r.paymentMode, true),
        escapeCsv(r.note || '', true),
      ].join(','));
    }

    // Prepend UTF-8 BOM (\uFEFF) for standard Excel compatibility
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
