import db from '../db/database.ts';

export interface DonationRecord {
  id: number;
  bill: string;
  donor_id: number;
  name: string;
  phone: string;
  amount: number;
  mode: 'Cash' | 'Online' | 'PhonePe' | 'GPay' | 'Cheque';
  reference_no: string;
  date: string;
  time: string;
  timestamp: number;
  note?: string;
  status: 'verified' | 'pending' | 'reconciled' | 'cancelled';
  collector_name: string;
  created_at: string;
}

export interface DonorRecord {
  id: number;
  name: string;
  phone: string;
  address: string;
  total_donated: number;
  donation_count: number;
  created_at: string;
  donations?: DonationRecord[];
}

export interface StatsResponse {
  totalCollected: number;
  targetGoal: number;
  goalPercentage: number;
  todayCollected: number;
  donorCount: number;
  donationCount: number;
  cashSplit: {
    cashAmount: number;
    onlineAmount: number;
    cashPercent: number;
    onlinePercent: number;
  };
  modeBreakdown: {
    label: string;
    amount: number;
    count: number;
    percentage: number;
  }[];
}

// Helper to format date in "08 Nov 2026" style
export function formatAppDate(d: Date = new Date()): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = String(d.getDate()).padStart(2, '0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  return `${day} ${month} ${year}`;
}

// Helper to format time in "10:42 AM" style
export function formatAppTime(d: Date = new Date()): string {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12;
  const strHours = String(hours).padStart(2, '0');
  return `${strHours}:${minutes} ${ampm}`;
}

export const donationService = {
  getSetting(key: string, defaultValue: string = ''): string {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : defaultValue;
  },

  setSetting(key: string, value: string, description?: string): void {
    db.prepare(`
      INSERT INTO settings (key, value, description, updated_at)
      VALUES (?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP
    `).run(key, value, description || null);
  },

  getAllSettings(): Record<string, string> {
    const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const res: Record<string, string> = {};
    for (const r of rows) {
      res[r.key] = r.value;
    }
    return res;
  },

  getStats(): StatsResponse {
    // Total collected
    const totalRow = db.prepare(`
      SELECT 
        COALESCE(SUM(amount), 0) as total,
        COUNT(DISTINCT donor_id) as donor_count,
        COUNT(*) as donation_count
      FROM donations 
      WHERE status != 'cancelled'
    `).get() as { total: number; donor_count: number; donation_count: number };

    // Today's actual date check
    const todayStr = formatAppDate();

    const todayRow = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as today_total
      FROM donations
      WHERE status != 'cancelled' AND date = ?
    `).get(todayStr) as { today_total: number };

    // Goal
    const goalStr = this.getSetting('target_goal', '251000');
    const targetGoal = parseFloat(goalStr) || 251000;
    const totalCollected = totalRow.total;
    const goalPercentage = targetGoal > 0 ? Math.min(100, Math.round((totalCollected / targetGoal) * 100)) : 0;

    // Cash vs Online split
    // Cash includes 'Cash'
    // Online includes 'Online', 'PhonePe', 'GPay', 'Cheque'
    const splitRow = db.prepare(`
      SELECT
        COALESCE(SUM(CASE WHEN mode = 'Cash' THEN amount ELSE 0 END), 0) as cash_total,
        COALESCE(SUM(CASE WHEN mode != 'Cash' THEN amount ELSE 0 END), 0) as online_total
      FROM donations
      WHERE status != 'cancelled'
    `).get() as { cash_total: number; online_total: number };

    const cashAmount = splitRow.cash_total;
    const onlineAmount = splitRow.online_total;
    const cashPercent = totalCollected > 0 ? Math.round((cashAmount / totalCollected) * 100) : 0;
    const onlinePercent = totalCollected > 0 ? 100 - cashPercent : 0;

    // Mode breakdown
    const modes: ('Cash' | 'Online' | 'PhonePe' | 'GPay' | 'Cheque')[] = [
      'Cash', 'Online', 'PhonePe', 'GPay', 'Cheque'
    ];

    const modeTotals = db.prepare(`
      SELECT mode, COALESCE(SUM(amount), 0) as total, COUNT(*) as count
      FROM donations
      WHERE status != 'cancelled'
      GROUP BY mode
    `).all() as { mode: string; total: number; count: number }[];

    const modeMap = new Map(modeTotals.map(m => [m.mode, m]));

    // Find max for scaling bar heights
    let maxModeAmount = 0;
    for (const m of modeTotals) {
      if (m.total > maxModeAmount) maxModeAmount = m.total;
    }

    const modeBreakdown = modes.map(mode => {
      const found = modeMap.get(mode);
      const amount = found ? found.total : 0;
      const count = found ? found.count : 0;
      const percentage = (maxModeAmount > 0 && amount > 0)
        ? Math.max(15, Math.round((amount / maxModeAmount) * 92))
        : 0;
      return {
        label: mode,
        amount,
        count,
        percentage,
      };
    });

    return {
      totalCollected,
      targetGoal,
      goalPercentage,
      todayCollected: todayRow.today_total,
      donorCount: totalRow.donor_count,
      donationCount: totalRow.donation_count,
      cashSplit: {
        cashAmount,
        onlineAmount,
        cashPercent,
        onlinePercent,
      },
      modeBreakdown,
    };
  },

  getDonations(params: {
    search?: string;
    filter?: string;
    mode?: string;
    limit?: number;
    offset?: number;
  } = {}): { items: DonationRecord[]; total: number } {
    let query = `SELECT * FROM donations WHERE status != 'cancelled'`;
    const args: any[] = [];

    if (params.search && params.search.trim()) {
      const term = `%${params.search.trim()}%`;
      query += ` AND (name LIKE ? OR phone LIKE ? OR bill_no LIKE ? OR reference_no LIKE ?)`;
      args.push(term, term, term, term);
    }

    if (params.filter) {
      if (params.filter === 'Today') {
        const todayStr = formatAppDate();
        query += ` AND date = ?`;
        args.push(todayStr);
      } else if (params.filter === 'Cash') {
        query += ` AND mode = 'Cash'`;
      } else if (params.filter === 'Online') {
        query += ` AND mode != 'Cash' AND mode != 'Cheque'`;
      }
    }

    if (params.mode && params.mode !== 'All') {
      query += ` AND mode = ?`;
      args.push(params.mode);
    }

    // Count total matching
    const countSql = query.replace('SELECT *', 'SELECT COUNT(*) as cnt');
    const totalCount = (db.prepare(countSql).get(...args) as { cnt: number }).cnt;

    // Order by timestamp DESC
    query += ` ORDER BY timestamp DESC, id DESC`;

    if (params.limit && params.limit > 0) {
      query += ` LIMIT ? OFFSET ?`;
      args.push(params.limit, params.offset || 0);
    }

    const rows = db.prepare(query).all(...args) as any[];

    const items: DonationRecord[] = rows.map(r => ({
      id: r.id,
      bill: r.bill_no,
      donor_id: r.donor_id,
      name: r.name,
      phone: r.phone,
      amount: r.amount,
      mode: r.mode,
      reference_no: r.reference_no,
      date: r.date,
      time: r.time,
      timestamp: r.timestamp,
      note: r.note,
      status: r.status,
      collector_name: r.collector_name,
      created_at: r.created_at,
    }));

    return { items, total: totalCount };
  },

  getDonationById(id: number): DonationRecord | null {
    const r = db.prepare(`SELECT * FROM donations WHERE id = ?`).get(id) as any;
    if (!r) return null;
    return {
      id: r.id,
      bill: r.bill_no,
      donor_id: r.donor_id,
      name: r.name,
      phone: r.phone,
      amount: r.amount,
      mode: r.mode,
      reference_no: r.reference_no,
      date: r.date,
      time: r.time,
      timestamp: r.timestamp,
      note: r.note,
      status: r.status,
      collector_name: r.collector_name,
      created_at: r.created_at,
    };
  },

  getDonationByBill(billNo: string): DonationRecord | null {
    const r = db.prepare(`SELECT * FROM donations WHERE bill_no = ?`).get(billNo) as any;
    if (!r) return null;
    return {
      id: r.id,
      bill: r.bill_no,
      donor_id: r.donor_id,
      name: r.name,
      phone: r.phone,
      amount: r.amount,
      mode: r.mode,
      reference_no: r.reference_no,
      date: r.date,
      time: r.time,
      timestamp: r.timestamp,
      note: r.note,
      status: r.status,
      collector_name: r.collector_name,
      created_at: r.created_at,
    };
  },

  createDonation(data: {
    name: string;
    phone: string;
    amount: number;
    mode: 'Cash' | 'Online' | 'PhonePe' | 'GPay' | 'Cheque';
    reference_no?: string;
    note?: string;
    address?: string;
    collector_name?: string;
  }): DonationRecord {
    const createTx = db.transaction(() => {
      // 1. Generate next sequential bill number
      const prefix = this.getSetting('bill_prefix', 'CP-2026-');
      const nextSeqRow = db.prepare("SELECT value FROM settings WHERE key = 'next_bill_number'").get() as { value: string };
      let seq = parseInt(nextSeqRow?.value || '1', 10);
      const bill_no = `${prefix}${String(seq).padStart(3, '0')}`;
      
      // Update next bill number in settings
      db.prepare("UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'next_bill_number'")
        .run(String(seq + 1));

      // 2. Format phone cleanly
      const rawPhone = data.phone.replace(/\D/g, '');
      const formattedPhone = rawPhone.length === 10
        ? `${rawPhone.slice(0, 5)} ${rawPhone.slice(5)}`
        : data.phone.trim();

      // 3. Find or insert donor
      let donor = db.prepare('SELECT id, total_donated, donation_count FROM donors WHERE phone = ?').get(formattedPhone) as any;
      let donorId: number;
      if (!donor) {
        const info = db.prepare(`
          INSERT INTO donors (name, phone, address, total_donated, donation_count)
          VALUES (?, ?, ?, ?, 1)
        `).run(data.name.trim(), formattedPhone, data.address || '', data.amount);
        donorId = Number(info.lastInsertRowid);
      } else {
        donorId = donor.id;
        db.prepare(`
          UPDATE donors SET
            name = ?,
            total_donated = total_donated + ?,
            donation_count = donation_count + 1,
            updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(data.name.trim(), data.amount, donorId);
      }

      // 4. Current date and time
      const now = new Date();
      const dateStr = formatAppDate(now);
      const timeStr = formatAppTime(now);
      const timestamp = now.getTime();

      // Reference number generation if empty
      let refNo = data.reference_no?.trim() || '';
      if (!refNo) {
        if (data.mode === 'Cash') {
          refNo = `CS-${prefix.replace(/[^0-9]/g, '')}-${String(seq).padStart(3, '0')}`;
        } else if (data.mode === 'Cheque') {
          refNo = `CHQ-${Math.floor(100000 + Math.random() * 900000)}`;
        } else {
          refNo = `UPI/${now.getFullYear().toString().slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}${Math.floor(100000 + Math.random() * 900000)}`;
        }
      }

      const collector = data.collector_name || this.getSetting('authorized_signatory', 'A. Prasad');

      // 5. Insert donation record
      const result = db.prepare(`
        INSERT INTO donations (
          bill_no, donor_id, name, phone, amount, mode, reference_no, date, time, timestamp, note, status, collector_name
        ) VALUES (
          ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?
        )
      `).run(
        bill_no,
        donorId,
        data.name.trim(),
        formattedPhone,
        data.amount,
        data.mode,
        refNo,
        dateStr,
        timeStr,
        timestamp,
        data.note?.trim() || '',
        collector
      );

      const insertedId = Number(result.lastInsertRowid);

      // 6. Audit log
      db.prepare(`
        INSERT INTO audit_logs (action, entity_type, entity_id, bill_no, details)
        VALUES ('CREATE_DONATION', 'donation', ?, ?, ?)
      `).run(
        insertedId,
        bill_no,
        `Created donation of ₹${data.amount} for ${data.name.trim()} via ${data.mode}`
      );

      return {
        id: insertedId,
        bill: bill_no,
        donor_id: donorId,
        name: data.name.trim(),
        phone: formattedPhone,
        amount: data.amount,
        mode: data.mode,
        reference_no: refNo,
        date: dateStr,
        time: timeStr,
        timestamp,
        note: data.note?.trim() || '',
        status: 'verified' as const,
        collector_name: collector,
        created_at: new Date().toISOString(),
      };
    });

    return createTx();
  },

  deleteDonation(id: number): boolean {
    const deleteTx = db.transaction(() => {
      const existing = db.prepare('SELECT * FROM donations WHERE id = ?').get(id) as any;
      if (!existing) return false;

      // Soft delete: set status to 'cancelled'
      db.prepare("UPDATE donations SET status = 'cancelled' WHERE id = ?").run(id);

      // Update donor totals in SQL
      db.prepare(`
        UPDATE donors SET
          total_donated = (SELECT COALESCE(SUM(amount), 0) FROM donations WHERE donor_id = ? AND status != 'cancelled'),
          donation_count = (SELECT COUNT(*) FROM donations WHERE donor_id = ? AND status != 'cancelled'),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(existing.donor_id, existing.donor_id, existing.donor_id);

      // Log in audit logs
      db.prepare(`
        INSERT INTO audit_logs (action, entity_type, entity_id, bill_no, details)
        VALUES ('DELETE_DONATION', 'donation', ?, ?, ?)
      `).run(
        id,
        existing.bill_no,
        `Cancelled donation of ₹${existing.amount} for ${existing.name}`
      );

      return true;
    });

    return deleteTx();
  },

  searchDonors(query: string): DonorRecord[] {
    if (!query || query.trim().length < 2) return [];

    const term = `%${query.trim()}%`;
    const donors = db.prepare(`
      SELECT * FROM donors
      WHERE name LIKE ? OR phone LIKE ?
      ORDER BY total_donated DESC
      LIMIT 20
    `).all(term, term) as any[];

    return donors.map(d => {
      const donations = db.prepare(`
        SELECT * FROM donations
        WHERE donor_id = ? AND status != 'cancelled'
        ORDER BY timestamp DESC
      `).all(d.id) as any[];

      return {
        id: d.id,
        name: d.name,
        phone: d.phone,
        address: d.address,
        total_donated: d.total_donated,
        donation_count: d.donation_count,
        created_at: d.created_at,
        donations: donations.map(r => ({
          id: r.id,
          bill: r.bill_no,
          donor_id: r.donor_id,
          name: r.name,
          phone: r.phone,
          amount: r.amount,
          mode: r.mode,
          reference_no: r.reference_no,
          date: r.date,
          time: r.time,
          timestamp: r.timestamp,
          note: r.note,
          status: r.status,
          collector_name: r.collector_name,
          created_at: r.created_at,
        })),
      };
    });
  },

  // Record Reconciliation / Matching feature
  // Compares recorded sums in SQLite with actual tally and records matching status
  reconcileBatch(data: {
    batch_date: string;
    mode_category: 'Cash' | 'Online' | 'All';
    actual_amount: number;
    reconciled_by?: string;
    notes?: string;
  }): {
    system_amount: number;
    actual_amount: number;
    discrepancy: number;
    status: 'matched' | 'discrepancy';
    reconciliation_id: number;
  } {
    let modeCondition = '';
    if (data.mode_category === 'Cash') {
      modeCondition = "AND mode = 'Cash'";
    } else if (data.mode_category === 'Online') {
      modeCondition = "AND mode != 'Cash'";
    }

    const row = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as system_total
      FROM donations
      WHERE (date = ? OR date LIKE ?) AND status != 'cancelled' ${modeCondition}
    `).get(data.batch_date, `%${data.batch_date}%`) as { system_total: number };

    const systemAmount = row.system_total;
    const discrepancy = data.actual_amount - systemAmount;
    const status = Math.abs(discrepancy) < 0.01 ? 'matched' : 'discrepancy';
    const reconciledBy = data.reconciled_by || 'A. Prasad';

    const info = db.prepare(`
      INSERT INTO reconciliations (
        batch_date, mode_category, system_amount, physical_or_bank_amount, discrepancy, status, reconciled_by, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      data.batch_date,
      data.mode_category,
      systemAmount,
      data.actual_amount,
      discrepancy,
      status,
      reconciledBy,
      data.notes || ''
    );

    // If perfectly matched, mark those donations as 'reconciled'
    if (status === 'matched') {
      db.prepare(`
        UPDATE donations SET status = 'reconciled'
        WHERE (date = ? OR date LIKE ?) AND status = 'verified' ${modeCondition}
      `).run(data.batch_date, `%${data.batch_date}%`);
    }

    db.prepare(`
      INSERT INTO audit_logs (action, entity_type, entity_id, details)
      VALUES ('RECONCILE', 'reconciliation', ?, ?)
    `).run(
      Number(info.lastInsertRowid),
      `Reconciled ${data.mode_category} for ${data.batch_date}: System ₹${systemAmount}, Actual ₹${data.actual_amount}, Discrepancy ₹${discrepancy}`
    );

    return {
      system_amount: systemAmount,
      actual_amount: data.actual_amount,
      discrepancy,
      status,
      reconciliation_id: Number(info.lastInsertRowid),
    };
  },

  getReconciliations() {
    return db.prepare(`SELECT * FROM reconciliations ORDER BY created_at DESC`).all();
  },

  // Export records to CSV
  exportCSV(): string {
    const rows = db.prepare(`
      SELECT 
        bill_no, name, phone, amount, mode, reference_no, date, time, note, status, collector_name
      FROM donations
      WHERE status != 'cancelled'
      ORDER BY timestamp DESC
    `).all() as any[];

    const headers = [
      'Bill Number',
      'Donor Name',
      'Phone Number',
      'Amount (INR)',
      'Payment Mode',
      'Reference / UTR',
      'Date',
      'Time',
      'Status',
      'Authorized Signatory',
      'Note'
    ];

    const escapeCsv = (val: any) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const csvLines = [headers.map(escapeCsv).join(',')];

    for (const r of rows) {
      csvLines.push([
        escapeCsv(r.bill_no),
        escapeCsv(r.name),
        escapeCsv(r.phone),
        escapeCsv(r.amount),
        escapeCsv(r.mode),
        escapeCsv(r.reference_no),
        escapeCsv(r.date),
        escapeCsv(r.time),
        escapeCsv(r.status),
        escapeCsv(r.collector_name),
        escapeCsv(r.note)
      ].join(','));
    }

    // Add UTF-8 BOM so Excel opens Hindi/special characters correctly
    return '\uFEFF' + csvLines.join('\r\n');
  },

  // Admin PIN verification
  verifyPin(pin: string): boolean {
    const savedPin = this.getSetting('admin_pin', '2026');
    return pin.trim() === savedPin.trim();
  },

  changePin(oldPin: string, newPin: string): boolean {
    if (!this.verifyPin(oldPin)) return false;
    if (!newPin || newPin.length !== 4) return false;
    this.setSetting('admin_pin', newPin, 'Admin access PIN');
    db.prepare(`
      INSERT INTO audit_logs (action, entity_type, details)
      VALUES ('CHANGE_PIN', 'security', 'Admin PIN was updated')
    `).run();
    return true;
  },

  getAuditLogs(limit: number = 50) {
    return db.prepare(`
      SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT ?
    `).all(limit);
  }
};
