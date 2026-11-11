export type PaymentMode = 'Cash' | 'Online' | 'PhonePe' | 'GPay' | 'Cheque';
export type DonationStatus = 'verified' | 'pending' | 'reconciled' | 'cancelled';

export interface Donation {
  id: number;
  bill: string;
  donor_id?: number;
  name: string;
  phone: string;
  amount: number;
  mode: PaymentMode;
  reference_no?: string;
  date: string;
  time: string;
  timestamp?: number;
  note?: string;
  status?: DonationStatus;
  collector_name?: string;
}

export interface DonorProfile {
  id: number;
  name: string;
  phone: string;
  address?: string;
  total_donated: number;
  donation_count: number;
  donations: Donation[];
}

export interface Stats {
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

export interface ReconciliationRecord {
  id: number;
  batch_date: string;
  mode_category: 'Cash' | 'Online' | 'All';
  system_amount: number;
  physical_or_bank_amount: number;
  discrepancy: number;
  status: 'matched' | 'discrepancy' | 'pending';
  reconciled_by: string;
  notes: string;
  created_at: string;
}

const API_BASE = '/api';

export const api = {
  async getStats(): Promise<Stats> {
    const res = await fetch(`${API_BASE}/stats`);
    if (!res.ok) throw new Error('Failed to load stats');
    return res.json();
  },

  async getDonations(params: {
    search?: string;
    filter?: string;
    mode?: string;
    limit?: number;
    offset?: number;
  } = {}): Promise<{ items: Donation[]; total: number }> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);
    if (params.filter) query.set('filter', params.filter);
    if (params.mode) query.set('mode', params.mode);
    if (params.limit) query.set('limit', String(params.limit));
    if (params.offset) query.set('offset', String(params.offset));

    const res = await fetch(`${API_BASE}/donations?${query.toString()}`);
    if (!res.ok) throw new Error('Failed to load donations');
    return res.json();
  },

  async getDonation(id: number): Promise<Donation> {
    const res = await fetch(`${API_BASE}/donations/${id}`);
    if (!res.ok) throw new Error('Failed to load donation');
    return res.json();
  },

  async createDonation(data: {
    name: string;
    phone: string;
    amount: number;
    mode: PaymentMode;
    note?: string;
    reference_no?: string;
  }): Promise<Donation> {
    const res = await fetch(`${API_BASE}/donations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create donation');
    }
    return res.json();
  },

  async deleteDonation(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/donations/${id}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete donation');
    }
  },

  async searchDonors(q: string): Promise<DonorProfile[]> {
    if (!q || q.trim().length < 2) return [];
    const res = await fetch(`${API_BASE}/donors/search?q=${encodeURIComponent(q.trim())}`);
    if (!res.ok) throw new Error('Failed to search donors');
    return res.json();
  },

  async verifyPin(pin: string): Promise<boolean> {
    const res = await fetch(`${API_BASE}/auth/verify-pin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    return Boolean(data.valid);
  },

  async getReconciliations(): Promise<ReconciliationRecord[]> {
    const res = await fetch(`${API_BASE}/reconciliation`);
    if (!res.ok) throw new Error('Failed to load reconciliations');
    return res.json();
  },

  async matchReconciliation(data: {
    batch_date: string;
    mode_category: 'Cash' | 'Online' | 'All';
    actual_amount: number;
    notes?: string;
  }): Promise<{
    system_amount: number;
    actual_amount: number;
    discrepancy: number;
    status: 'matched' | 'discrepancy';
  }> {
    const res = await fetch(`${API_BASE}/reconciliation/match`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to match records');
    }
    return res.json();
  },

  getCsvExportUrl(): string {
    return `${API_BASE}/donations/export/csv`;
  },
};
