import fs from 'node:fs';
import path from 'node:path';
import puppeteer, { type Browser } from 'puppeteer';

const ROOT_DIR = path.resolve(import.meta.dirname, '../..');
const TEMPLATE_PATH = path.resolve(import.meta.dirname, '../pdf/receipt.html');
const FONT_DIR = path.resolve(import.meta.dirname, '../pdf/fonts');
const RECEIPTS_DIR = path.resolve(ROOT_DIR, 'data/receipts');

if (!fs.existsSync(RECEIPTS_DIR)) {
  fs.mkdirSync(RECEIPTS_DIR, { recursive: true });
}

// ---------- Escaping & Localization Helpers ----------
const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

const MODES: Record<string, { hi: string; en: string }> = {
  cash: { hi: 'नकद', en: 'Cash' },
  online: { hi: 'ऑनलाइन', en: 'Online' },
  phonepe: { hi: 'फोनपे', en: 'PhonePe' },
  gpay: { hi: 'गूगल पे', en: 'GPay' },
  cheque: { hi: 'चेक', en: 'Cheque' },
};

// Indian-system number -> English words
const EN1 = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN10 = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function en2(n: number) { return n < 20 ? EN1[n] : EN10[Math.floor(n / 10)] + (n % 10 ? ' ' + EN1[n % 10] : ''); }
function en3(n: number) { return (n >= 100 ? EN1[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? en2(n % 100) : ''); }
export function wordsEN(n: number): string {
  if (n === 0) return 'Zero';
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(en3(cr) + ' Crore');
  if (lk) parts.push(en2(lk) + ' Lakh');
  if (th) parts.push(en2(th) + ' Thousand');
  if (n) parts.push(en3(n));
  return parts.join(' ');
}

// Hindi number words (0–99 irregular)
const HI99 = (
  'शून्य,एक,दो,तीन,चार,पाँच,छह,सात,आठ,नौ,दस,ग्यारह,बारह,तेरह,चौदह,पंद्रह,सोलह,सत्रह,अठारह,उन्नीस,' +
  'बीस,इक्कीस,बाईस,तेईस,चौबीस,पच्चीस,छब्बीस,सत्ताईस,अट्ठाईस,उनतीस,तीस,इकतीस,बत्तीस,तैंतीस,चौंतीस,पैंतीस,छत्तीस,सैंतीस,अड़तीस,उनतालीस,' +
  'चालीस,इकतालीस,बयालीस,तैंतालीस,चौवालीस,पैंतालीस,छियालीस,सैंतालीस,अड़तालीस,उनचास,पचास,इक्यावन,बावन,तिरपन,चौवन,पचपन,छप्पन,सत्तावन,अट्ठावन,उनसठ,' +
  'साठ,इकसठ,बासठ,तिरसठ,चौंसठ,पैंसठ,छियासठ,सड़सठ,अड़सठ,उनहत्तर,सत्तर,इकहत्तर,बहत्तर,तिहत्तर,चौहत्तर,पचहत्तर,छिहत्तर,सतहत्तर,अठहत्तर,उनासी,' +
  'अस्सी,इक्यासी,बयासी,तिरासी,चौरासी,पचासी,छियासी,सत्तासी,अट्ठासी,नवासी,नब्बे,इक्यानवे,बानवे,तिरानवे,चौरानवे,पचानवे,छियानवे,सत्तानवे,अट्ठानवे,निन्यानवे'
).split(',');
function hi3(n: number) { return (n >= 100 ? HI99[Math.floor(n / 100)] + ' सौ' + (n % 100 ? ' ' : '') : '') + (n % 100 ? HI99[n % 100] : ''); }
export function wordsHI(n: number): string {
  if (n === 0) return 'शून्य';
  const parts = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(hi3(cr) + ' करोड़');
  if (lk) parts.push(HI99[lk] + ' लाख');
  if (th) parts.push(HI99[th] + ' हज़ार');
  if (n) parts.push(hi3(n));
  return parts.join(' ');
}

const fmtDate = (d: unknown) =>
  new Date(d as string | number | Date).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });

const fmtAmount = (n: unknown) => Number(n).toLocaleString('en-IN');

// ---------- Template Caching with Base64 Embedded Fonts ----------
let cachedTemplate: string | null = null;
function loadTemplate(): string {
  if (cachedTemplate) return cachedTemplate;
  let html = fs.readFileSync(TEMPLATE_PATH, 'utf8');
  html = html.replace(/url\(fonts\/([^)]+)\)/g, (_, f) => {
    const fontFile = path.join(FONT_DIR, f);
    if (!fs.existsSync(fontFile)) {
      console.warn(`[PDF Warning] Font file not found: ${fontFile}`);
      return `url('')`;
    }
    const b64 = fs.readFileSync(fontFile).toString('base64');
    return `url(data:font/woff2;base64,${b64})`;
  });
  return (cachedTemplate = html);
}

export interface ReceiptData {
  billNo: string | number;
  donorName: string;
  phone: string;
  amount: number;
  paymentMode: string;
  note?: string;
  date?: string | Date | number;
}

export function fillTemplate(d: ReceiptData): string {
  const amount = Math.round(Number(d.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount');
  const modeKey = String(d.paymentMode || '').toLowerCase();
  const mode = MODES[modeKey] || { hi: esc(d.paymentMode), en: esc(d.paymentMode) };

  const vals: Record<string, string> = {
    bill_no: esc(d.billNo),
    date: esc(fmtDate(d.date || Date.now())),
    donor_name: esc(d.donorName),
    phone: esc(d.phone),
    mode_hi: mode.hi,
    mode_en: mode.en,
    amount: fmtAmount(amount),
    amount_words_en: wordsEN(amount),
    amount_words_hi: wordsHI(amount),
    note: esc(d.note || ''),
    year: '2026',
  };

  let html = loadTemplate();
  html = html.replace(/\{\{#note\}\}([\s\S]*?)\{\{\/note\}\}/g, vals.note ? '$1' : '');
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vals ? vals[k] : ''));
}

/**
 * Returns printable self-contained HTML with embedded fonts and automatic print trigger.
 */
export function renderPrintableReceiptHTML(data: ReceiptData): string {
  const html = fillTemplate(data);
  const autoPrintScript = `
<script>
  window.addEventListener('load', function() {
    setTimeout(function() {
      try { window.print(); } catch(e) {}
    }, 350);
  });
</script>
</body>
</html>`;
  return html.replace(/<\/body>\s*<\/html>/i, autoPrintScript);
}

// ---------- Concurrency Queue (Max 2 concurrent renders) ----------
class RenderQueue {
  private activeCount = 0;
  private queue: (() => void)[] = [];
  constructor(private readonly limit: number) {}

  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.activeCount >= this.limit) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.activeCount++;
    try {
      return await fn();
    } finally {
      this.activeCount--;
      if (this.queue.length > 0) {
        const next = this.queue.shift();
        next?.();
      }
    }
  }
}

const renderQueue = new RenderQueue(2);

// ---------- Puppeteer Singleton with Auto-Recovery ----------
let browserInstance: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

function detectChromeExecutable(): string | undefined {
  if (process.env.CHROME_PATH && fs.existsSync(process.env.CHROME_PATH)) {
    return process.env.CHROME_PATH;
  }
  if (process.platform === 'linux') {
    const candidates = [
      '/usr/bin/chromium',
      '/usr/bin/chromium-browser',
      '/usr/bin/google-chrome',
      '/usr/bin/google-chrome-stable',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  } else if (process.platform === 'win32') {
    const candidates = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
  }
  return undefined;
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = detectChromeExecutable();
  const launchArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--no-first-run',
    '--no-zygote',
    '--disable-extensions',
    '--hide-scrollbars',
    '--mute-audio',
  ];

  const browser = await puppeteer.launch({
    headless: true,
    executablePath,
    args: launchArgs,
  });

  browser.on('disconnected', () => {
    console.warn('[Puppeteer] Browser disconnected or crashed. Resetting singleton.');
    browserInstance = null;
    browserPromise = null;
  });

  return browser;
}

export async function getBrowser(): Promise<Browser> {
  if (browserInstance && (browserInstance as any).connected) {
    return browserInstance;
  }
  if (!browserPromise) {
    browserPromise = launchBrowser()
      .then((b) => {
        browserInstance = b;
        return b;
      })
      .catch((err) => {
        browserPromise = null;
        browserInstance = null;
        throw err;
      });
  }
  return browserPromise;
}

/**
 * Renders A4 PDF buffer with concurrency limit and Puppeteer page evaluation.
 */
export async function renderReceiptPDF(data: ReceiptData): Promise<Buffer> {
  return renderQueue.run(async () => {
    const html = fillTemplate(data);

    const renderAttempt = async (): Promise<Buffer> => {
      const browser = await getBrowser();
      const page = await browser.newPage();
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: 20000 }).catch(async () => {
          await page.setContent(html, { waitUntil: 'domcontentloaded', timeout: 10000 });
        });
        await Promise.race([
          page.evaluate(() => (document as any).fonts?.ready),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
        const uint8 = await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          margin: { top: 0, right: 0, bottom: 0, left: 0 },
        });
        return Buffer.from(uint8);
      } finally {
        await page.close().catch(() => {});
      }
    };

    try {
      return await renderAttempt();
    } catch (err) {
      console.warn('[Puppeteer] Render attempt failed. Relaunching browser and retrying...', err);
      browserInstance = null;
      browserPromise = null;
      return await renderAttempt();
    }
  });
}

/**
 * Saves generated PDF to ./data/receipts/<billNo>.pdf.
 * Returns the absolute path on disk.
 */
export async function saveReceiptPDF(data: ReceiptData): Promise<string> {
  const pdfBuffer = await renderReceiptPDF(data);
  const filePath = path.join(RECEIPTS_DIR, `${data.billNo}.pdf`);
  fs.writeFileSync(filePath, pdfBuffer);
  return filePath;
}

export function getReceiptPath(billNo: string | number): string {
  return path.join(RECEIPTS_DIR, `${billNo}.pdf`);
}
