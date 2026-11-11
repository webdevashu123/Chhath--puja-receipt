import { useState, useEffect, useMemo, type FormEvent, type ReactNode } from "react";
import { api, type Donation, type PaymentMode, type Stats, type DonorProfile, type ReconciliationRecord } from "./api.ts";

type Screen = "home" | "donate" | "receipt" | "records" | "search";

const formatAmount = (amount: number) => `₹${amount.toLocaleString("en-IN")}`;
const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .map((word) => word[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

const iconPaths: Record<string, ReactNode> = {
  home: (
    <>
      <path d="M3 10.8 12 3l9 7.8" />
      <path d="M5.5 9.5V21h13V9.5M9 21v-7h6v7" />
    </>
  ),
  donate: (
    <>
      <path d="M12 21s-7-3.8-7-10.2A4.3 4.3 0 0 1 12 7.5a4.3 4.3 0 0 1 7 3.3C19 17.2 12 21 12 21Z" />
      <path d="M12 10v6m-3-3h6" />
    </>
  ),
  records: (
    <>
      <path d="M6 3h12a2 2 0 0 1 2 2v16H4V5a2 2 0 0 1 2-2Z" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrowLeft: <path d="m15 18-6-6 6-6" />,
  wallet: (
    <>
      <path d="M4 6h15a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h13" />
      <path d="M16 11h5v4h-5a2 2 0 0 1 0-4Z" />
    </>
  ),
  users: (
    <>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8" />
    </>
  ),
  trend: (
    <>
      <path d="m3 17 6-6 4 4 8-9" />
      <path d="M15 6h6v6" />
    </>
  ),
  cash: (
    <>
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M7 9.5h.01M17 14.5h.01" />
    </>
  ),
  phone: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.8a2 2 0 0 1-.4 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4 13 13 0 0 0 2.8.7 2 2 0 0 1 1.7 2Z" />
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5" />
      <path d="M5 21h14" />
    </>
  ),
  print: (
    <>
      <path d="M6 9V3h12v6M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
      <path d="M6 14h12v7H6z" />
    </>
  ),
  share: (
    <>
      <circle cx="18" cy="5" r="3" />
      <circle cx="6" cy="12" r="3" />
      <circle cx="18" cy="19" r="3" />
      <path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M8 6V3h8v3M19 6l-1 15H6L5 6" />
      <path d="M10 11v5M14 11v5" />
    </>
  ),
  chevron: <path d="m9 18 6-6-6-6" />,
  check: <path d="m5 12 4 4L19 6" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M16 3v4M8 3v4M3 10h18" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  filter: <path d="M4 6h16M7 12h10M10 18h4" />,
  file: (
    <>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z" />
      <path d="M14 2v6h6M8 13h8M8 17h5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  refresh: (
    <>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </>
  ),
  shieldCheck: (
    <>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
};

function Icon({
  name,
  size = 22,
  strokeWidth = 1.8,
}: {
  name: string;
  size?: number;
  strokeWidth?: number;
}) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {iconPaths[name]}
    </svg>
  );
}

function TopBar({
  title = "Chhath Puja Samiti",
  back,
  onBack,
}: {
  title?: string;
  back?: boolean;
  onBack?: () => void;
}) {
  return (
    <header className="top-bar">
      {back ? (
        <button className="icon-button" onClick={onBack} aria-label="Go back">
          <Icon name="arrowLeft" />
        </button>
      ) : (
        <div className="brand-mark">
          <span className="sun-rays">✦</span>
          <span className="diya-flame" />
        </div>
      )}
      <div className="top-title">
        <strong>{title}</strong>
        <span>Yogidih, Dudhari · 2026</span>
      </div>
      <span className="year-pill">2026</span>
    </header>
  );
}

function BottomNav({ screen, navigate }: { screen: Screen; navigate: (screen: Screen) => void }) {
  const tabs: { id: Screen; label: string; icon: string }[] = [
    { id: "home", label: "Home", icon: "home" },
    { id: "donate", label: "Donate", icon: "donate" },
    { id: "records", label: "Records", icon: "records" },
    { id: "search", label: "Search", icon: "search" },
  ];
  return (
    <nav className="bottom-nav" aria-label="Main navigation">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          className={
            screen === tab.id || (screen === "receipt" && tab.id === "donate") ? "active" : ""
          }
          onClick={() => navigate(tab.id)}
        >
          <Icon name={tab.icon} size={21} />
          <span>{tab.label}</span>
        </button>
      ))}
    </nav>
  );
}

function ModeBadge({ mode }: { mode: PaymentMode }) {
  return <span className={`badge badge-${mode.toLowerCase()}`}>{mode}</span>;
}

function DonationRow({ donation, onClick }: { donation: Donation; onClick?: () => void }) {
  return (
    <button className="donation-row" onClick={onClick} type="button">
      <span className="avatar">{initials(donation.name)}</span>
      <span className="donation-person">
        <strong>{donation.name}</strong>
        <small>
          {donation.time} · {donation.mode}
        </small>
      </span>
      <span className="donation-amount">
        <strong>{formatAmount(donation.amount)}</strong>
        <small>{donation.bill}</small>
      </span>
    </button>
  );
}

function Home({
  stats,
  recentDonations,
  onRefresh,
  goDonate,
  goRecords,
  onSelectDonation,
}: {
  stats: Stats | null;
  recentDonations: Donation[];
  onRefresh: () => void;
  goDonate: () => void;
  goRecords: () => void;
  onSelectDonation: (donation: Donation) => void;
}) {
  const total = stats?.totalCollected ?? 0;
  const target = stats?.targetGoal ?? 251000;
  const percent = stats?.goalPercentage ?? (target > 0 ? Math.round((total / target) * 100) : 0);
  const today = stats?.todayCollected ?? 0;
  const donors = stats?.donorCount ?? 0;
  const cashPercent = stats?.cashSplit?.cashPercent ?? 0;
  const onlinePercent = stats?.cashSplit?.onlinePercent ?? 0;

  const modeBreakdown = stats?.modeBreakdown ?? [
    { label: "Cash", amount: 0, count: 0, percentage: 0 },
    { label: "PhonePe", amount: 0, count: 0, percentage: 0 },
    { label: "GPay", amount: 0, count: 0, percentage: 0 },
    { label: "Online", amount: 0, count: 0, percentage: 0 },
    { label: "Cheque", amount: 0, count: 0, percentage: 0 },
  ];

  return (
    <>
      <TopBar />
      <main className="screen-content home-screen">
        <section className="hero-card">
          <div className="hero-orb orb-one" />
          <div className="hero-orb orb-two" />
          <div className="hero-label">
            <Icon name="wallet" size={18} /> Total Collection
          </div>
          <h1>{formatAmount(total)}</h1>
          <div className="goal-row">
            <span>Goal {formatAmount(target)}</span>
            <strong>{percent}% Achieved</strong>
          </div>
          <div className="progress-track">
            <span style={{ width: `${Math.min(100, percent)}%` }} />
          </div>
        </section>

        <section className="stats-grid">
          <div className="stat-card">
            <span className="stat-icon gold">
              <Icon name="trend" size={18} />
            </span>
            <div>
              <small>Today</small>
              <strong>{formatAmount(today)}</strong>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-icon orange">
              <Icon name="users" size={18} />
            </span>
            <div>
              <small>Donors</small>
              <strong>{donors}</strong>
            </div>
          </div>
          <div className="stat-card wide">
            <span className="stat-icon blue">
              <Icon name="cash" size={18} />
            </span>
            <div>
              <small>Cash / Online Ratio</small>
              <strong>
                {cashPercent}% Cash / {onlinePercent}% Online
              </strong>
            </div>
            <div className="split-bar">
              <span style={{ width: `${cashPercent}%` }} />
              <i style={{ width: `${onlinePercent}%` }} />
            </div>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Payment Distribution</p>
              <h2>Payment modes</h2>
            </div>
            <button className="text-button" onClick={goRecords}>
              View details
            </button>
          </div>
          <div className="chart-card">
            <div className="chart-bars">
              {modeBreakdown.map((item) => (
                <div className="bar-group" key={item.label}>
                  <div className="bar-track" title={`${item.label}: ${formatAmount(item.amount)}`}>
                    <span style={{ height: `${item.percentage}%` }} />
                  </div>
                  <small>{item.label}</small>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="section-block">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Latest Activity</p>
              <h2>Recent donations</h2>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <button
                className="icon-button"
                style={{ width: "28px", height: "28px", padding: "4px" }}
                onClick={onRefresh}
                title="Refresh stats"
              >
                <Icon name="refresh" size={16} />
              </button>
              <button className="text-button" onClick={goRecords}>
                View all
              </button>
            </div>
          </div>
          <div className="list-card">
            {recentDonations.length > 0 ? (
              recentDonations.slice(0, 5).map((donation) => (
                <DonationRow
                  key={donation.id}
                  donation={donation}
                  onClick={() => onSelectDonation(donation)}
                />
              ))
            ) : (
              <p style={{ padding: "20px 16px", textAlign: "center", color: "var(--color-muted)", fontSize: "13px" }}>
                No donations recorded yet. Tap "New Donation" below to add your first record.
              </p>
            )}
          </div>
        </section>
      </main>
      <button className="fab" onClick={goDonate}>
        <Icon name="plus" size={21} />
        New Donation
      </button>
    </>
  );
}

function Donate({
  onComplete,
  showToast,
}: {
  onComplete: (donation: Donation) => void;
  showToast: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<PaymentMode>("Cash");
  const [referenceNo, setReferenceNo] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [customAmount, setCustomAmount] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const nextErrors: Record<string, string> = {};
    if (name.trim().length < 2) nextErrors.name = "Please enter donor's full name";
    if (phone.replace(/\D/g, "").length !== 10) nextErrors.phone = "Enter a valid 10-digit phone number";
    if (!amount || Number(amount) < 1) nextErrors.amount = "Please select or enter an amount";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    setLoading(true);
    try {
      const created = await api.createDonation({
        name: name.trim(),
        phone: phone.replace(/\D/g, ""),
        amount: Number(amount),
        mode,
        reference_no: referenceNo.trim() || undefined,
        note: note.trim() || undefined,
      });
      showToast(`Receipt ${created.bill} generated successfully!`);
      onComplete(created);
    } catch (err: any) {
      showToast(err.message || "Failed to create donation");
      setLoading(false);
    }
  };

  return (
    <>
      <TopBar title="New Donation" />
      <form className="screen-content donate-screen" onSubmit={submit}>
        <div className="intro-copy">
          <p className="eyebrow">Donation details</p>
          <h1>Make every offering count</h1>
          <p>A digital receipt will be generated instantly.</p>
        </div>
        <label className={`field ${errors.name ? "has-error" : ""}`}>
          <span>
            Donor name <b>*</b>
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Rajesh Kumar or Sunita Devi"
            required
          />
          <small>{errors.name}</small>
        </label>
        <label className={`field ${errors.phone ? "has-error" : ""}`}>
          <span>
            Phone number <b>*</b>
          </span>
          <div className="phone-input">
            <i>+91</i>
            <input
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
              placeholder="10-digit number"
              required
            />
          </div>
          <small>{errors.phone}</small>
        </label>
        <fieldset className={`field-group ${errors.amount ? "has-error" : ""}`}>
          <legend>
            Donation amount <b>*</b>
          </legend>
          <div className="amount-chips">
            {["101", "251", "501", "1001"].map((value) => (
              <button
                type="button"
                key={value}
                className={amount === value && !customAmount ? "selected" : ""}
                onClick={() => {
                  setAmount(value);
                  setCustomAmount(false);
                }}
              >
                ₹{value}
              </button>
            ))}
            <button
              type="button"
              className={customAmount ? "selected" : ""}
              onClick={() => {
                setAmount("");
                setCustomAmount(true);
              }}
            >
              Custom
            </button>
          </div>
          {customAmount && (
            <div className="custom-amount">
              <span>₹</span>
              <input
                autoFocus
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
                placeholder="Enter amount"
              />
            </div>
          )}
          <small>{errors.amount}</small>
        </fieldset>
        <fieldset className="field-group">
          <legend>
            Payment mode <b>*</b>
          </legend>
          <div className="mode-grid">
            {(["Cash", "Online", "PhonePe", "GPay", "Cheque"] as PaymentMode[]).map((item) => (
              <button
                type="button"
                key={item}
                className={mode === item ? "selected" : ""}
                onClick={() => setMode(item)}
              >
                <span className="mode-icon">
                  {item === "Cash" ? "₹" : item === "Cheque" ? "⌁" : item.slice(0, 1)}
                </span>
                {item}
                {mode === item && (
                  <span className="selected-check">
                    <Icon name="check" size={11} strokeWidth={3} />
                  </span>
                )}
              </button>
            ))}
          </div>
        </fieldset>

        {mode !== "Cash" && (
          <label className="field">
            <span>
              Transaction / UTR / Reference No. <em>Optional</em>
            </span>
            <input
              value={referenceNo}
              onChange={(e) => setReferenceNo(e.target.value)}
              placeholder={mode === "Cheque" ? "Enter cheque number" : "12-digit UPI reference / UTR"}
            />
          </label>
        )}

        <label className="field">
          <span>
            Note / Seva <em>Optional</em>
          </span>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Ghat lighting, prasad distribution, or family contribution"
            maxLength={120}
          />
          <small className="counter">{note.length}/120</small>
        </label>
        <div className="form-spacer" />
        <div className="sticky-action">
          <button className="primary-button" type="submit" disabled={loading}>
            {loading ? (
              <>
                <span className="spinner" />
                Generating receipt…
              </>
            ) : (
              <>
                Generate Receipt
                <Icon name="chevron" size={18} />
              </>
            )}
          </button>
        </div>
      </form>
    </>
  );
}

function Receipt({
  donation,
  onNew,
  onHome,
  showToast,
}: {
  donation: Donation;
  onNew: () => void;
  onHome: () => void;
  showToast: (text: string) => void;
}) {
  const shareWhatsApp = () => {
    const cleanPhone = donation.phone.replace(/\D/g, "");
    const msg = `🙏 *Greetings from Chhath Puja Samiti (Yogidih, Dudhari · 2026)*\n\nDear *${donation.name}*,\nWe gratefully acknowledge receipt of your donation of *₹${donation.amount.toLocaleString("en-IN")}* for Chhath Puja 2026.\n\n📜 *Bill Number:* ${donation.bill}\n📅 *Date & Time:* ${donation.date}, ${donation.time}\n💳 *Payment Mode:* ${donation.mode}${donation.reference_no ? ` (${donation.reference_no})` : ""}\n\nMay Chhath Maiya and Lord Bhaskar shower their divine blessings upon you and your family! ✨`;
    const url = `https://wa.me/91${cleanPhone}?text=${encodeURIComponent(msg)}`;
    window.open(url, "_blank");
    showToast("Opening WhatsApp…");
  };

  const handlePrint = () => {
    window.print();
    showToast("Receipt sent to printer");
  };

  const handleDownload = () => {
    window.print();
    showToast("Select 'Save as PDF' in print dialog");
  };

  return (
    <>
      <TopBar title="Donation Receipt" back onBack={onHome} />
      <main className="screen-content receipt-screen">
        <div className="success-heading">
          <span className="success-check">
            <Icon name="check" size={30} strokeWidth={2.5} />
          </span>
          <h1>Donation received!</h1>
          <p>Thank you for supporting Chhath Puja 2026.</p>
        </div>
        <article className="receipt-card" id="printable-receipt">
          <div className="receipt-pattern" />
          <div className="receipt-brand">
            <div className="brand-mark large">
              <span className="sun-rays">✦</span>
              <span className="diya-flame" />
            </div>
            <div>
              <strong>Chhath Puja Samiti</strong>
              <span>Yogidih, Dudhari · 2026</span>
            </div>
          </div>
          <div className="receipt-divider">
            <span />
            <i>DONATION RECEIPT</i>
            <span />
          </div>
          <div className="receipt-number">
            <span>Bill number</span>
            <strong>{donation.bill}</strong>
          </div>
          <dl className="receipt-details">
            <div>
              <dt>Donor name</dt>
              <dd>{donation.name}</dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>+91 {donation.phone}</dd>
            </div>
            <div>
              <dt>Date & time</dt>
              <dd>
                {donation.date}, {donation.time}
              </dd>
            </div>
            <div>
              <dt>Payment mode</dt>
              <dd>
                <ModeBadge mode={donation.mode} />
              </dd>
            </div>
            {donation.reference_no && (
              <div>
                <dt>Reference No.</dt>
                <dd style={{ fontSize: "11px", fontWeight: "600" }}>{donation.reference_no}</dd>
              </div>
            )}
            {donation.note && (
              <div style={{ gridColumn: "1 / -1" }}>
                <dt>Note / Seva</dt>
                <dd>{donation.note}</dd>
              </div>
            )}
          </dl>
          <div className="receipt-total">
            <span>Amount received</span>
            <strong>{formatAmount(donation.amount)}</strong>
            <small>With gratitude and blessings</small>
          </div>
          <div className="signature-row">
            <div>
              <span className="signature">{donation.collector_name || "A. Prasad"}</span>
              <small>Authorized signature</small>
            </div>
            <div className="stamp">
              CPS
              <br />
              <span>2026</span>
            </div>
          </div>
          <p className="blessing">Jai Chhath Maiya!</p>
        </article>
        <div className="receipt-actions">
          <button className="primary-button" onClick={handleDownload}>
            <Icon name="download" size={19} />
            Download PDF
          </button>
          <div>
            <button className="secondary-button whatsapp" onClick={shareWhatsApp}>
              <Icon name="share" size={18} />
              WhatsApp
            </button>
            <button className="secondary-button" onClick={handlePrint}>
              <Icon name="print" size={18} />
              Print
            </button>
          </div>
          <button className="ghost-button" onClick={onNew}>
            <Icon name="plus" size={18} />
            New Donation
          </button>
        </div>
      </main>
    </>
  );
}

function PinGate({
  unlock,
  cancel,
  appEntry = false,
}: {
  unlock: () => void;
  cancel?: () => void;
  appEntry?: boolean;
}) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const press = async (value: string) => {
    if (pin.length === 4 || verifying) return;
    const next = pin + value;
    setPin(next);
    setError(false);

    if (next.length === 4) {
      setVerifying(true);
      try {
        const isValid = await api.verifyPin(next);
        if (isValid) {
          unlock();
        } else {
          setPin("");
          setError(true);
        }
      } catch {
        if (next === "2026") unlock();
        else {
          setPin("");
          setError(true);
        }
      } finally {
        setVerifying(false);
      }
    }
  };

  return (
    <main className="pin-screen">
      {cancel && (
        <button className="pin-close" onClick={cancel}>
          <Icon name="close" />
        </button>
      )}
      <div className="pin-icon">
        <Icon name="lock" size={30} />
      </div>
      <p className="eyebrow">{appEntry ? "Welcome back" : "Admin access"}</p>
      <h1>{appEntry ? "Unlock the app" : "Enter your PIN"}</h1>
      <p>
        {appEntry
          ? "Enter your secure passcode to continue."
          : "Records are protected for your privacy."}
      </p>
      <div className={`pin-dots ${error ? "shake" : ""}`}>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={pin.length > i ? "filled" : ""} />
        ))}
      </div>
      <small className={`pin-error ${error ? "is-error" : ""}`}>
        {error ? "Incorrect PIN. Please try again." : "Default PIN: 2026"}
      </small>
      <div className="keypad">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"].map((key, index) =>
          key ? (
            <button
              key={key}
              disabled={verifying}
              onClick={() => (key === "del" ? setPin(pin.slice(0, -1)) : press(key))}
            >
              {key === "del" ? "⌫" : key}
            </button>
          ) : (
            <span key={index} />
          ),
        )}
      </div>
    </main>
  );
}

// Record Reconciliation Modal
function ReconciliationModal({
  onClose,
  showToast,
  onReconciled,
}: {
  onClose: () => void;
  showToast: (text: string) => void;
  onReconciled: () => void;
}) {
  const [modeCategory, setModeCategory] = useState<"Cash" | "Online" | "All">("Cash");
  const [actualAmount, setActualAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [history, setHistory] = useState<ReconciliationRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{
    system_amount: number;
    actual_amount: number;
    discrepancy: number;
    status: "matched" | "discrepancy";
  } | null>(null);

  useEffect(() => {
    api.getReconciliations().then(setHistory).catch(console.error);
  }, []);

  const handleReconcile = async (e: FormEvent) => {
    e.preventDefault();
    if (!actualAmount) return;
    setLoading(true);
    try {
      const today = "08 Nov 2026";
      const res = await api.matchReconciliation({
        batch_date: today,
        mode_category: modeCategory,
        actual_amount: Number(actualAmount),
        notes,
      });
      setResult(res);
      showToast(
        res.status === "matched"
          ? "✓ Records matched successfully! 0 Discrepancy."
          : `Discrepancy detected: ${formatAmount(res.discrepancy)}`
      );
      const updatedHistory = await api.getReconciliations();
      setHistory(updatedHistory);
      onReconciled();
    } catch (err: any) {
      showToast(err.message || "Failed to reconcile records");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="reconcile-card">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2>Record Reconciliation</h2>
            <p>Compare physical cash box count or bank statement credits against records.</p>
          </div>
          <button className="icon-button" onClick={onClose} aria-label="Close">
            <Icon name="close" size={20} />
          </button>
        </div>

        <form onSubmit={handleReconcile}>
          <div style={{ marginBottom: "12px" }}>
            <span style={{ fontSize: "12px", fontWeight: "600", display: "block", marginBottom: "6px" }}>
              Reconciliation Mode
            </span>
            <div style={{ display: "flex", gap: "8px" }}>
              {(["Cash", "Online", "All"] as const).map((cat) => (
                <button
                  type="button"
                  key={cat}
                  className={`secondary-button ${modeCategory === cat ? "active" : ""}`}
                  style={{
                    flex: 1,
                    padding: "6px",
                    fontSize: "12px",
                    fontWeight: "700",
                    background: modeCategory === cat ? "var(--color-saffron)" : "#f0f0f0",
                    color: modeCategory === cat ? "white" : "var(--color-text)",
                  }}
                  onClick={() => setModeCategory(cat)}
                >
                  {cat === "Cash" ? "Cash Tally" : cat === "Online" ? "Bank UPI" : "Combined"}
                </button>
              ))}
            </div>
          </div>

          <label className="field" style={{ marginBottom: "12px" }}>
            <span>Actual Hand Count / Bank Statement Amount (₹)</span>
            <input
              type="number"
              value={actualAmount}
              onChange={(e) => setActualAmount(e.target.value)}
              placeholder="e.g. 78310"
              required
            />
          </label>

          <label className="field" style={{ marginBottom: "12px" }}>
            <span>Source / Notes</span>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Cash Box #1 or SBI Bank Statement"
            />
          </label>

          <button
            className="primary-button"
            type="submit"
            disabled={loading}
            style={{ width: "100%", justifyContent: "center", marginBottom: "14px" }}
          >
            {loading ? "Reconciling…" : "Reconcile Records"}
          </button>
        </form>

        {result && (
          <div
            style={{
              padding: "12px",
              borderRadius: "12px",
              marginBottom: "16px",
              background: result.status === "matched" ? "#e6f8ee" : "#fff1f1",
              border: `1px solid ${result.status === "matched" ? "#9fe0be" : "#f5c6c6"}`,
            }}
          >
            <strong
              style={{
                display: "block",
                color: result.status === "matched" ? "#158f60" : "#d63b3b",
                marginBottom: "4px",
              }}
            >
              {result.status === "matched" ? "✓ Records Matched (0 Discrepancy)" : "⚠ Discrepancy Detected"}
            </strong>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", fontSize: "11px" }}>
              <span>System Total: {formatAmount(result.system_amount)}</span>
              <span>Actual Total: {formatAmount(result.actual_amount)}</span>
              <span style={{ gridColumn: "1 / -1", fontWeight: "bold" }}>
                Difference: {formatAmount(result.discrepancy)}
              </span>
            </div>
          </div>
        )}

        {history.length > 0 && (
          <div>
            <h3 style={{ fontSize: "13px", margin: "10px 0 6px", color: "var(--color-navy)" }}>
              Recent Reconciliation Logs
            </h3>
            <div style={{ maxHeight: "160px", overflowY: "auto" }}>
              {history.map((h) => (
                <div className="recon-history-item" key={h.id}>
                  <div>
                    <strong>
                      {h.mode_category} · {h.batch_date}
                    </strong>
                    <br />
                    <small>
                      System: {formatAmount(h.system_amount)} | Actual: {formatAmount(h.physical_or_bank_amount)}
                    </small>
                  </div>
                  <span className={`badge ${h.status === "matched" ? "badge-reconciled" : "badge-cash"}`}>
                    {h.status === "matched" ? "Matched" : `Diff: ${formatAmount(h.discrepancy)}`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Records({
  onDelete,
  onSelectDonation,
  showToast,
  onDataChanged,
}: {
  onDelete: (id: number) => Promise<void>;
  onSelectDonation: (donation: Donation) => void;
  showToast: (text: string) => void;
  onDataChanged: () => void;
}) {
  const [filter, setFilter] = useState("All");
  const [query, setQuery] = useState("");
  const [deleteItem, setDeleteItem] = useState<Donation | null>(null);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<Donation[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [showReconcile, setShowReconcile] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const res = await api.getDonations({
        search: query,
        filter: filter !== "All" ? filter : undefined,
      });
      setItems(res.items);
      setTotalCount(res.total);
    } catch (err: any) {
      showToast(err.message || "Failed to load records");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const handler = setTimeout(() => {
      loadData();
    }, 200);
    return () => clearTimeout(handler);
  }, [filter, query]);

  const total = useMemo(() => items.reduce((sum, item) => sum + item.amount, 0), [items]);

  const handleExportCsv = () => {
    window.location.href = api.getCsvExportUrl();
    showToast("Downloading donation records CSV…");
  };

  return (
    <>
      <TopBar title="Donation Records" />
      <main className="screen-content records-screen">
        <section className="records-summary">
          <div>
            <p>Total collection</p>
            <h1>{formatAmount(total)}</h1>
            <span>
              {totalCount} donation{totalCount !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="records-btn-group">
            <button className="reconcile-btn" onClick={() => setShowReconcile(true)} title="Reconciliation">
              <Icon name="shieldCheck" size={16} />
              Reconcile
            </button>
            <button onClick={handleExportCsv} title="Export CSV for Excel/Sheets">
              <Icon name="file" size={18} />
              Export CSV
            </button>
          </div>
        </section>

        <div className="search-field">
          <Icon name="search" size={20} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search name, phone or bill no."
          />
          {query && (
            <button onClick={() => setQuery("")}>
              <Icon name="close" size={16} />
            </button>
          )}
        </div>

        <div className="filter-row">
          {["All", "Today", "Cash", "Online"].map((item) => (
            <button
              key={item}
              className={filter === item ? "active" : ""}
              onClick={() => setFilter(item)}
            >
              {item}
            </button>
          ))}
          <button className="filter-icon" onClick={loadData} title="Refresh records">
            <Icon name="refresh" size={17} />
          </button>
        </div>

        {loading ? (
          <div className="skeleton-list">
            {[1, 2, 3, 4].map((item) => (
              <div className="skeleton-card" key={item}>
                <i />
                <span>
                  <b />
                  <b />
                </span>
                <em />
              </div>
            ))}
          </div>
        ) : items.length ? (
          <div className="record-list">
            {items.map((item) => (
              <article className="record-card" key={item.id}>
                <div
                  className="record-main"
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectDonation(item)}
                >
                  <span className="avatar">{initials(item.name)}</span>
                  <div>
                    <strong>{item.name}</strong>
                    <small>{item.phone}</small>
                  </div>
                  <div>
                    <strong>{formatAmount(item.amount)}</strong>
                    <ModeBadge mode={item.mode} />
                  </div>
                </div>
                <div className="record-meta">
                  <span>
                    <Icon name="calendar" size={14} />
                    {item.date}
                  </span>
                  <span>{item.bill}</span>
                  {item.status === "reconciled" ? (
                    <span className="badge badge-reconciled" style={{ fontSize: "8px" }}>
                      Matched
                    </span>
                  ) : (
                    <span className="badge badge-verified" style={{ fontSize: "8px" }}>
                      Verified
                    </span>
                  )}
                  <button
                    aria-label={`Delete ${item.name}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDeleteItem(item);
                    }}
                  >
                    <Icon name="trash" size={17} />
                  </button>
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <span>
              <Icon name="search" size={30} />
            </span>
            <h2>No donations found</h2>
            <p>Try a different search or filter.</p>
            <button
              className="secondary-button"
              onClick={() => {
                setFilter("All");
                setQuery("");
              }}
            >
              Clear filters
            </button>
          </div>
        )}
      </main>

      {deleteItem && (
        <div className="modal-backdrop">
          <div className="confirm-modal">
            <span className="danger-icon">
              <Icon name="trash" />
            </span>
            <h2>Delete this record?</h2>
            <p>
              {deleteItem.name}’s donation of {formatAmount(deleteItem.amount)} ({deleteItem.bill}) will
              be permanently removed.
            </p>
            <div>
              <button className="secondary-button" onClick={() => setDeleteItem(null)}>
                Cancel
              </button>
              <button
                className="danger-button"
                onClick={async () => {
                  await onDelete(deleteItem.id);
                  setDeleteItem(null);
                  loadData();
                }}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {showReconcile && (
        <ReconciliationModal
          onClose={() => setShowReconcile(false)}
          showToast={showToast}
          onReconciled={() => {
            loadData();
            onDataChanged();
          }}
        />
      )}
    </>
  );
}

function SearchScreen({ onSelectDonation }: { onSelectDonation: (donation: Donation) => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<DonorProfile[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!query || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const handler = setTimeout(async () => {
      setLoading(true);
      try {
        const donors = await api.searchDonors(query);
        setResults(donors);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handler);
  }, [query]);

  const donor = results[0];
  const history = donor?.donations || [];

  return (
    <>
      <TopBar title="Find a Donor" />
      <main className="screen-content search-screen">
        <div className="search-intro">
          <p className="eyebrow">Donor directory</p>
          <h1>Search donation history</h1>
          <p>Enter a donor's name or 10-digit phone number.</p>
        </div>
        <div className="search-field large">
          <Icon name="search" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name or phone number"
          />
          {query && (
            <button onClick={() => setQuery("")}>
              <Icon name="close" size={17} />
            </button>
          )}
        </div>
        {!query && (
          <div className="search-suggestion">
            <span>
              <Icon name="users" size={28} />
            </span>
            <h2>Find your donors</h2>
            <p>Search any donor by their full name or 10-digit mobile number.</p>
          </div>
        )}
        {query && query.length < 2 && (
          <p className="search-hint">Type at least 2 characters to search</p>
        )}
        {loading && <p style={{ textAlign: "center", color: "var(--color-muted)", padding: "20px" }}>Searching donors…</p>}
        {query.length >= 2 && !loading && !donor && (
          <div className="empty-state">
            <span>
              <Icon name="search" size={30} />
            </span>
            <h2>No donor found</h2>
            <p>We couldn't find anyone matching “{query}”. Check the spelling or phone number.</p>
          </div>
        )}
        {donor && (
          <section className="donor-profile">
            <div className="profile-head">
              <span className="avatar large">{initials(donor.name)}</span>
              <div>
                <p>Donor profile</p>
                <h2>{donor.name}</h2>
                <span>+91 {donor.phone}</span>
                {donor.address && <small style={{ display: "block", color: "var(--color-muted)", marginTop: "2px" }}>{donor.address}</small>}
              </div>
            </div>
            <div className="profile-stats">
              <div>
                <small>Total donated</small>
                <strong>{formatAmount(donor.total_donated)}</strong>
              </div>
              <div>
                <small>Donations</small>
                <strong>{donor.donation_count}</strong>
              </div>
            </div>
            <div className="contact-actions">
              <a href={`tel:${donor.phone.replace(/\s+/g, "")}`}>
                <Icon name="phone" size={18} />
                Call
              </a>
              <a
                href={`https://wa.me/91${donor.phone.replace(/\D/g, "")}`}
                target="_blank"
                rel="noreferrer"
              >
                <Icon name="share" size={18} />
                WhatsApp
              </a>
            </div>
            <div className="history">
              <p className="eyebrow">Donation history</p>
              {history.map((item) => (
                <div
                  className="timeline-item"
                  key={item.id}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectDonation(item)}
                  title="Click to view receipt"
                >
                  <i />
                  <div>
                    <strong>{formatAmount(item.amount)}</strong>
                    <span>
                      {item.date} · {item.mode}
                    </span>
                  </div>
                  <small>{item.bill}</small>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

export default function App() {
  const [authenticated, setAuthenticated] = useState(false);
  const [screen, setScreen] = useState<Screen>("home");
  const [recordsUnlocked, setRecordsUnlocked] = useState(false);
  const [pinGate, setPinGate] = useState(false);
  const [latestDonation, setLatestDonation] = useState<Donation | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [recentDonations, setRecentDonations] = useState<Donation[]>([]);
  const [toast, setToast] = useState("");

  const showToast = (text: string) => {
    setToast(text);
    window.setTimeout(() => setToast(""), 2800);
  };

  const refreshDashboard = async () => {
    try {
      const [s, d] = await Promise.all([
        api.getStats(),
        api.getDonations({ limit: 5 }),
      ]);
      setStats(s);
      setRecentDonations(d.items);
      if (!latestDonation && d.items.length > 0) {
        setLatestDonation(d.items[0]);
      }
    } catch (err) {
      console.error("Dashboard refresh error:", err);
    }
  };

  useEffect(() => {
    if (authenticated) {
      refreshDashboard();
    }
  }, [authenticated]);

  const navigate = (next: Screen) => {
    if (next === "records" && !recordsUnlocked) {
      setPinGate(true);
      return;
    }
    setScreen(next);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteDonation = async (id: number) => {
    try {
      await api.deleteDonation(id);
      showToast("Donation record deleted");
      refreshDashboard();
    } catch (err: any) {
      showToast(err.message || "Failed to delete donation");
    }
  };

  const handleSelectDonation = (donation: Donation) => {
    setLatestDonation(donation);
    setScreen("receipt");
  };

  const appClass = useMemo(() => `app-shell screen-${screen}`, [screen]);

  if (!authenticated)
    return (
      <div className="app-frame">
        <PinGate
          appEntry
          unlock={() => {
            setAuthenticated(true);
            setRecordsUnlocked(true);
          }}
        />
      </div>
    );

  if (pinGate)
    return (
      <div className="app-frame">
        <PinGate
          cancel={() => setPinGate(false)}
          unlock={() => {
            setRecordsUnlocked(true);
            setPinGate(false);
            setScreen("records");
          }}
        />
      </div>
    );

  return (
    <div className="app-frame">
      <div className={appClass}>
        {screen === "home" && (
          <Home
            stats={stats}
            recentDonations={recentDonations}
            onRefresh={refreshDashboard}
            goDonate={() => navigate("donate")}
            goRecords={() => navigate("records")}
            onSelectDonation={handleSelectDonation}
          />
        )}
        {screen === "donate" && (
          <Donate
            onComplete={(donation) => {
              setLatestDonation(donation);
              setScreen("receipt");
              refreshDashboard();
            }}
            showToast={showToast}
          />
        )}
        {screen === "receipt" && latestDonation && (
          <Receipt
            donation={latestDonation}
            onHome={() => navigate("home")}
            onNew={() => navigate("donate")}
            showToast={showToast}
          />
        )}
        {screen === "records" && (
          <Records
            onDelete={handleDeleteDonation}
            onSelectDonation={handleSelectDonation}
            showToast={showToast}
            onDataChanged={refreshDashboard}
          />
        )}
        {screen === "search" && (
          <SearchScreen onSelectDonation={handleSelectDonation} />
        )}
        {screen !== "receipt" && <BottomNav screen={screen} navigate={navigate} />}
        {toast && (
          <div className="toast">
            <span>
              <Icon name="check" size={14} strokeWidth={3} />
            </span>
            {toast}
          </div>
        )}
      </div>
    </div>
  );
}
