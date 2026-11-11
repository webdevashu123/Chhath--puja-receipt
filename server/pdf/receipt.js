// receipt.js — backend module: fills receipt.html and renders it to an A4 PDF via headless Chrome.
//
//   const { renderReceiptPDF } = require('./receipt');
//   const pdf = await renderReceiptPDF({ billNo: 1001, donorName: 'राम कुमार', phone: '9876543210',
//                                        amount: 501, paymentMode: 'PhonePe', date: new Date(), note: '' });
//
// Install:  npm i puppeteer        (bundles Chromium; or `puppeteer-core` + set CHROME_PATH)

const fs = require('fs');
const path = require('path');

let puppeteer;
try { puppeteer = require('puppeteer'); } catch { puppeteer = require('puppeteer-core'); }

const TEMPLATE = path.join(__dirname, 'receipt.html');
const FONT_DIR = path.join(__dirname, 'fonts');
const YEAR = '2026';

// ---------- helpers ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const MODES = {
  cash:    { hi: 'नकद',        en: 'Cash' },
  online:  { hi: 'ऑनलाइन',     en: 'Online' },
  phonepe: { hi: 'फोनपे',      en: 'PhonePe' },
  gpay:    { hi: 'गूगल पे',    en: 'GPay' },
  cheque:  { hi: 'चेक',        en: 'Cheque' },
};

// Indian-system number -> English words
const EN1 = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const EN10 = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function en2(n) { return n < 20 ? EN1[n] : EN10[Math.floor(n / 10)] + (n % 10 ? ' ' + EN1[n % 10] : ''); }
function en3(n) { return (n >= 100 ? EN1[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' : '') : '') + (n % 100 ? en2(n % 100) : ''); }
function wordsEN(n) {
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

// Hindi number words (0–99 are irregular, so listed in full)
const HI99 = ('शून्य,एक,दो,तीन,चार,पाँच,छह,सात,आठ,नौ,दस,ग्यारह,बारह,तेरह,चौदह,पंद्रह,सोलह,सत्रह,अठारह,उन्नीस,' +
  'बीस,इक्कीस,बाईस,तेईस,चौबीस,पच्चीस,छब्बीस,सत्ताईस,अट्ठाईस,उनतीस,तीस,इकतीस,बत्तीस,तैंतीस,चौंतीस,पैंतीस,छत्तीस,सैंतीस,अड़तीस,उनतालीस,' +
  'चालीस,इकतालीस,बयालीस,तैंतालीस,चौवालीस,पैंतालीस,छियालीस,सैंतालीस,अड़तालीस,उनचास,पचास,इक्यावन,बावन,तिरपन,चौवन,पचपन,छप्पन,सत्तावन,अट्ठावन,उनसठ,' +
  'साठ,इकसठ,बासठ,तिरसठ,चौंसठ,पैंसठ,छियासठ,सड़सठ,अड़सठ,उनहत्तर,सत्तर,इकहत्तर,बहत्तर,तिहत्तर,चौहत्तर,पचहत्तर,छिहत्तर,सतहत्तर,अठहत्तर,उनासी,' +
  'अस्सी,इक्यासी,बयासी,तिरासी,चौरासी,पचासी,छियासी,सत्तासी,अट्ठासी,नवासी,नब्बे,इक्यानवे,बानवे,तिरानवे,चौरानवे,पचानवे,छियानवे,सत्तानवे,अट्ठानवे,निन्यानवे').split(',');
function hi3(n) { return (n >= 100 ? HI99[Math.floor(n / 100)] + ' सौ' + (n % 100 ? ' ' : '') : '') + (n % 100 ? HI99[n % 100] : ''); }
function wordsHI(n) {
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

const fmtDate = (d) => new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' });
const fmtAmount = (n) => Number(n).toLocaleString('en-IN');

// ---------- template ----------
let cachedTemplate;
function loadTemplate() {
  if (cachedTemplate) return cachedTemplate;
  let html = fs.readFileSync(TEMPLATE, 'utf8');
  // inline fonts as base64 so the page is self-contained (works with page.setContent)
  html = html.replace(/url\(fonts\/([^)]+)\)/g, (_, f) => `url(data:font/woff2;base64,${fs.readFileSync(path.join(FONT_DIR, f)).toString('base64')})`);
  return (cachedTemplate = html);
}

function fillTemplate(d) {
  const amount = Math.round(Number(d.amount));
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Invalid amount');
  const mode = MODES[String(d.paymentMode || '').toLowerCase()] || { hi: esc(d.paymentMode), en: esc(d.paymentMode) };
  const vals = {
    bill_no: esc(d.billNo),
    date: esc(fmtDate(d.date || Date.now())),
    donor_name: esc(d.donorName),
    phone: esc(d.phone),
    mode_hi: mode.hi, mode_en: mode.en,
    amount: fmtAmount(amount),
    amount_words_en: wordsEN(amount),
    amount_words_hi: wordsHI(amount),
    note: esc(d.note || ''),
    year: YEAR,
  };
  let html = loadTemplate();
  // {{#note}}...{{/note}} shows only when a note exists
  html = html.replace(/\{\{#note\}\}([\s\S]*?)\{\{\/note\}\}/g, vals.note ? '$1' : '');
  return html.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vals ? vals[k] : ''));
}

// ---------- render ----------
let browserPromise;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
    });
  }
  return browserPromise;
}

async function renderReceiptPDF(data) {
  const html = fillTemplate(data);
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
  } finally {
    await page.close();
  }
}

module.exports = { renderReceiptPDF, fillTemplate, wordsEN, wordsHI };
