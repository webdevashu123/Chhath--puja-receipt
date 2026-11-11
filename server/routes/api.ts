import { Router, Request, Response } from 'express';
import { donationService } from '../services/donationService.ts';
import { clearAllData } from '../db/database.ts';

const router = Router();

// Health check
router.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'Chhath Puja Samiti Donation API',
  });
});

// Statistics
router.get('/stats', (req: Request, res: Response) => {
  try {
    const stats = donationService.getStats();
    res.json(stats);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch statistics' });
  }
});

// List donations with search and filters
router.get('/donations', (req: Request, res: Response) => {
  try {
    const search = req.query.search as string | undefined;
    const filter = req.query.filter as string | undefined;
    const mode = req.query.mode as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : undefined;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : undefined;

    const result = donationService.getDonations({ search, filter, mode, limit, offset });
    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch donations' });
  }
});

// Get single donation by id
router.get('/donations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const donation = donationService.getDonationById(id);
    if (!donation) {
      return res.status(404).json({ error: 'Donation record not found' });
    }
    res.json(donation);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch donation' });
  }
});

// Create donation
router.post('/donations', (req: Request, res: Response) => {
  try {
    const { name, phone, amount, mode, note, reference_no, address, collector_name } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return res.status(400).json({ error: 'Please enter a valid donor name (min 2 chars)' });
    }
    const cleanPhone = (phone || '').replace(/\D/g, '');
    if (cleanPhone.length !== 10) {
      return res.status(400).json({ error: 'Please enter a valid 10-digit phone number' });
    }
    const numAmount = Number(amount);
    if (isNaN(numAmount) || numAmount < 1) {
      return res.status(400).json({ error: 'Please enter a valid donation amount' });
    }
    const validModes = ['Cash', 'Online', 'PhonePe', 'GPay', 'Cheque'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: `Invalid payment mode. Must be one of: ${validModes.join(', ')}` });
    }

    const created = donationService.createDonation({
      name,
      phone,
      amount: numAmount,
      mode,
      note,
      reference_no,
      address,
      collector_name,
    });

    res.status(201).json(created);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to create donation' });
  }
});

// Delete donation
router.delete('/donations/:id', (req: Request, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    const success = donationService.deleteDonation(id);
    if (!success) {
      return res.status(404).json({ error: 'Donation record not found' });
    }
    res.json({ success: true, message: 'Donation record removed successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to delete donation' });
  }
});

// CSV Export
router.get('/donations/export/csv', (req: Request, res: Response) => {
  try {
    const csvData = donationService.exportCSV();
    const filename = `chhath-puja-donations-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csvData);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to export CSV' });
  }
});

// Search donors & history
router.get('/donors/search', (req: Request, res: Response) => {
  try {
    const q = req.query.q as string || '';
    const donors = donationService.searchDonors(q);
    res.json(donors);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to search donors' });
  }
});

// Reconciliations (Record matching)
router.get('/reconciliation', (req: Request, res: Response) => {
  try {
    const logs = donationService.getReconciliations();
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch reconciliation records' });
  }
});

router.post('/reconciliation/match', (req: Request, res: Response) => {
  try {
    const { batch_date, mode_category, actual_amount, notes, reconciled_by } = req.body;
    if (!batch_date || !mode_category || actual_amount === undefined) {
      return res.status(400).json({ error: 'batch_date, mode_category, and actual_amount are required' });
    }

    const result = donationService.reconcileBatch({
      batch_date,
      mode_category,
      actual_amount: Number(actual_amount),
      notes,
      reconciled_by,
    });

    res.json(result);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to reconcile records' });
  }
});

// PIN Verification
router.post('/auth/verify-pin', (req: Request, res: Response) => {
  try {
    const { pin } = req.body;
    if (!pin) {
      return res.status(400).json({ valid: false, error: 'PIN is required' });
    }
    const isValid = donationService.verifyPin(String(pin));
    res.json({ valid: isValid });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to verify PIN' });
  }
});

// Change PIN
router.post('/auth/change-pin', (req: Request, res: Response) => {
  try {
    const { oldPin, newPin } = req.body;
    const success = donationService.changePin(String(oldPin), String(newPin));
    if (!success) {
      return res.status(400).json({ success: false, error: 'Invalid current PIN or invalid new 4-digit PIN' });
    }
    res.json({ success: true, message: 'Admin PIN updated successfully' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to change PIN' });
  }
});

// Settings
router.get('/settings', (req: Request, res: Response) => {
  try {
    const settings = donationService.getAllSettings();
    // Exclude admin PIN from exposed settings
    delete settings.admin_pin;
    res.json(settings);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch settings' });
  }
});

router.post('/settings', (req: Request, res: Response) => {
  try {
    const { key, value } = req.body;
    if (!key || value === undefined) {
      return res.status(400).json({ error: 'key and value are required' });
    }
    if (key === 'admin_pin') {
      return res.status(403).json({ error: 'Use /auth/change-pin to change admin PIN' });
    }
    donationService.setSetting(key, String(value));
    res.json({ success: true, key, value });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to update setting' });
  }
});

// Audit logs
router.get('/audit-logs', (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const logs = donationService.getAuditLogs(limit);
    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to fetch audit logs' });
  }
});

// Clear all records (Reset database)
router.post('/admin/clear-data', (req: Request, res: Response) => {
  try {
    const { pin } = req.body;
    if (!pin || !donationService.verifyPin(String(pin))) {
      return res.status(403).json({ error: 'Valid admin PIN required to clear data' });
    }
    clearAllData();
    res.json({ success: true, message: 'All donation records cleared successfully.' });
  } catch (error: any) {
    res.status(500).json({ error: error.message || 'Failed to clear database' });
  }
});

export default router;
