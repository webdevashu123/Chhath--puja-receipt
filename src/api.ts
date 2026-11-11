export type PaymentMode = 'Cash' | 'Online' | 'PhonePe' | 'GPay' | 'Cheque';

export interface Donation {
  id: number;
  bill: string;
  billNo: string;
  donor_id?: number;
  donorId?: number;
  name: string;
  donorName: string;
  phone: string;
  amount: number;
  mode: PaymentMode;
  paymentMode: PaymentMode;
  reference_no?: string;
  date: string;
  time: string;
  createdAt?: string;
  note?: string;
  pdfUrl: string;
  shareUrl: string;
}

export interface DonorProfile {
  id: number;
  name: string;
  phone: string;
  totalDonated: number;
  total_donated: number;
  donationCount: number;
  donation_count: number;
  donations: Donation[];
  history?: Donation[];
}

export interface Stats {
  totalCollected: number;
  targetGoal: number;
  goalPercentage: number;
  todayCollected: number;
  todayTotal: number;
  donorCount: number;
  totalDonations: number;
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

const API_BASE = '/api';

export const api = {
  async pingServer(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/admin/check`, { credentials: 'include' });
      return res.ok;
    } catch {
      return false;
    }
  },

  async adminLogin(pin: string): Promise<boolean> {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pin }),
      });
    } catch {
      throw new Error('Cannot reach the admin server. Check the connection and try again.');
    }

    if (res.ok) return true;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) return false;
    throw new Error(data.error || `Admin login failed (${res.status}). Please try again.`);
  },

  async verifyPin(pin: string): Promise<boolean> {
    return this.adminLogin(pin);
  },

  async adminLogout(): Promise<void> {
    await fetch(`${API_BASE}/admin/logout`, {
      method: 'POST',
      credentials: 'include',
    }).catch(() => {});
  },

  async checkAdminAuth(): Promise<boolean> {
    try {
      const res = await fetch(`${API_BASE}/admin/check`, { credentials: 'include' });
      if (!res.ok) return false;
      const data = await res.json();
      return Boolean(data.authenticated);
    } catch {
      return false;
    }
  },

  async getStats(): Promise<Stats> {
    const res = await fetch(`${API_BASE}/stats`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to load stats');
    const data = await res.json();

    const totalCollected = Number(data.totalCollected) || 0;
    const targetGoal = 251000;
    const goalPercentage = targetGoal > 0 ? Math.min(100, Math.round((totalCollected / targetGoal) * 100)) : 0;
    const todayCollected = Number(data.todayTotal) || 0;
    const donorCount = Number(data.donorCount) || 0;
    const totalDonations = Number(data.totalDonations) || 0;

    const split = data.splitByMode || {};
    const cashAmount = (split.Cash?.total || 0);
    const onlineAmount = totalCollected - cashAmount;
    const cashPercent = totalCollected > 0 ? Math.round((cashAmount / totalCollected) * 100) : 0;
    const onlinePercent = totalCollected > 0 ? 100 - cashPercent : 0;

    const modes = ['Cash', 'Online', 'PhonePe', 'GPay', 'Cheque'] as const;
    const modeBreakdown = modes.map((m) => {
      const info = split[m] || { total: 0, count: 0 };
      const percentage = totalCollected > 0 ? Math.round((info.total / totalCollected) * 100) : 0;
      return {
        label: m,
        amount: info.total,
        count: info.count,
        percentage,
      };
    });

    return {
      totalCollected,
      targetGoal,
      goalPercentage,
      todayCollected,
      todayTotal: todayCollected,
      donorCount,
      totalDonations,
      donationCount: totalDonations,
      cashSplit: {
        cashAmount,
        onlineAmount,
        cashPercent,
        onlinePercent,
      },
      modeBreakdown,
    };
  },

  async getDonations(params: {
    search?: string;
    mode?: string;
    filter?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  } = {}): Promise<{ items: Donation[]; total: number; totalAmount: number }> {
    const query = new URLSearchParams();
    if (params.search) query.set('search', params.search);

    // Support both filter ('Today', 'Cash', 'Online') and direct mode
    let modeVal = params.mode;
    if (params.filter && params.filter !== 'All') {
      if (params.filter === 'Today') {
        const todayStr = new Date().toISOString().split('T')[0];
        query.set('from', todayStr);
        query.set('to', todayStr);
      } else {
        modeVal = params.filter;
      }
    }
    if (modeVal && modeVal !== 'All') query.set('mode', modeVal);
    if (params.from) query.set('from', params.from);
    if (params.to) query.set('to', params.to);
    if (params.page) query.set('page', String(params.page));
    if (params.limit) query.set('limit', String(params.limit));

    const res = await fetch(`${API_BASE}/donations?${query.toString()}`, { credentials: 'include' });
    if (!res.ok) {
      if (res.status === 401) throw new Error('Admin authentication required');
      throw new Error('Failed to load donations');
    }
    const data = await res.json();

    const items: Donation[] = (data.donations || []).map((d: any) => {
      const dateObj = new Date(d.createdAt);
      const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
      const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

      return {
        id: d.id,
        bill: d.billNo,
        billNo: d.billNo,
        donor_id: d.donorId,
        donorId: d.donorId,
        name: d.donorName,
        donorName: d.donorName,
        phone: d.phone,
        amount: d.amount,
        mode: d.paymentMode,
        paymentMode: d.paymentMode,
        date: dateStr,
        time: timeStr,
        createdAt: d.createdAt,
        note: d.note,
        pdfUrl: d.pdfUrl,
        shareUrl: d.shareUrl,
      };
    });

    return {
      items,
      total: data.totalCount || 0,
      totalAmount: data.totalAmount || 0,
    };
  },

  async createDonation(data: {
    donorName: string;
    phone: string;
    amount: number;
    paymentMode: PaymentMode;
    note?: string;
    clientId?: string;
  }): Promise<Donation> {
    const res = await fetch(`${API_BASE}/donations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(data),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to create donation');
    }

    const created = await res.json();
    const dateObj = new Date();
    const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
    const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });

    return {
      id: created.id,
      bill: created.billNo,
      billNo: created.billNo,
      donor_id: 0,
      donorId: 0,
      name: data.donorName,
      donorName: data.donorName,
      phone: data.phone,
      amount: data.amount,
      mode: data.paymentMode,
      paymentMode: data.paymentMode,
      date: dateStr,
      time: timeStr,
      createdAt: dateObj.toISOString(),
      note: data.note,
      pdfUrl: created.pdfUrl,
      shareUrl: created.shareUrl,
    };
  },

  async deleteDonation(id: number): Promise<void> {
    const res = await fetch(`${API_BASE}/donations/${id}`, {
      method: 'DELETE',
      credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || 'Failed to delete donation');
    }
  },

  async searchDonors(q: string): Promise<DonorProfile[]> {
    if (!q || q.trim().length < 2) return [];
    const res = await fetch(`${API_BASE}/donors/search?q=${encodeURIComponent(q.trim())}`, { credentials: 'include' });
    if (!res.ok) throw new Error('Failed to search donors');
    const data = await res.json();

    return (data.donors || []).map((d: any) => {
      const historyList: Donation[] = (d.history || []).map((h: any) => {
        const dateObj = new Date(h.createdAt);
        const dateStr = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
        const timeStr = dateObj.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
        return {
          id: h.id,
          bill: h.billNo,
          billNo: h.billNo,
          donor_id: d.id,
          donorId: d.id,
          name: d.name,
          donorName: d.name,
          phone: d.phone,
          amount: h.amount,
          mode: h.paymentMode,
          paymentMode: h.paymentMode,
          date: dateStr,
          time: timeStr,
          createdAt: h.createdAt,
          note: h.note,
          pdfUrl: h.pdfUrl,
          shareUrl: h.shareUrl,
        };
      });

      return {
        id: d.id,
        name: d.name,
        phone: d.phone,
        totalDonated: d.totalDonated || 0,
        total_donated: d.totalDonated || 0,
        donationCount: d.donationCount || 0,
        donation_count: d.donationCount || 0,
        donations: historyList,
        history: historyList,
      };
    });
  },

  getCsvExportUrl(): string {
    return `${API_BASE}/export.csv`;
  },
};
