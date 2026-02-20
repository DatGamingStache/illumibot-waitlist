const express = require('express');
const fs = require('fs');
const path = require('path');
const nodemailer = require('nodemailer');
const QRCode = require('qrcode');
const rateLimit = require('express-rate-limit');
const admin = require('firebase-admin');

// Init Firebase Admin (uses default credentials on App Hosting)
try {
  admin.initializeApp();
} catch (e) {
  // Already initialized or no credentials (local dev)
}
const db = admin.apps.length ? admin.firestore() : null;

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || 'https://illumibot-waitlist--illumibot-waitlist.us-east4.hosted.app';
const DATA_FILE = path.join(__dirname, 'data', 'waitlist.json');

// Ensure data directory
fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, '[]');

// Email config
const GMAIL_USER = process.env.GMAIL_USER || 'triston@arroyodev.com';
const GMAIL_APP_PASSWORD = process.env.GMAIL_APP_PASSWORD || 'kxgcwrsjvrxpoahv';

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD }
});

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static('public'));

// Rate limiters
const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many submissions. Please try again later.' },
  standardHeaders: true
});

const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many requests. Please try again later.' },
  standardHeaders: true
});

// Email validation
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// HTML template wrapper
function htmlPage(title, bodyContent) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} - illumibot</title>
  <link rel="icon" href="/img/logo.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Sora:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Inter', sans-serif;
      background: #000;
      color: #fff;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }
    .container {
      width: 100%;
      max-width: 520px;
      padding: 40px 24px;
      animation: fadeIn 0.6s ease;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(16px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .logo { display: block; margin: 0 auto 32px; height: 64px; }
    h1 {
      font-family: 'Sora', sans-serif;
      font-size: 1.5rem;
      font-weight: 700;
      text-align: center;
      margin-bottom: 32px;
      line-height: 1.3;
    }
    .accent { color: #17FB15; }
    label {
      display: block;
      font-size: 0.85rem;
      font-weight: 500;
      color: #9ca3af;
      margin-bottom: 6px;
      margin-top: 16px;
    }
    input, textarea {
      width: 100%;
      padding: 14px 16px;
      background: #111;
      border: 1px solid #333;
      border-radius: 10px;
      color: #fff;
      font-family: 'Inter', sans-serif;
      font-size: 1rem;
      transition: border-color 0.2s;
      outline: none;
    }
    input:focus, textarea:focus { border-color: #17FB15; }
    textarea { resize: vertical; min-height: 80px; }
    .btn {
      display: block;
      width: 100%;
      margin-top: 28px;
      padding: 16px;
      background: #17FB15;
      color: #000;
      font-family: 'Sora', sans-serif;
      font-size: 1rem;
      font-weight: 700;
      border: none;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s, transform 0.1s;
    }
    .btn:hover { background: #0ea572; }
    .btn:active { transform: scale(0.98); }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .success-card {
      text-align: center;
      padding: 48px 24px;
      animation: fadeIn 0.6s ease;
    }
    .success-card .check {
      width: 64px; height: 64px;
      margin: 0 auto 24px;
      background: #17FB15;
      border-radius: 50%;
      display: flex; align-items: center; justify-content: center;
      font-size: 32px;
    }
    .success-card h2 { font-family: 'Sora', sans-serif; margin-bottom: 12px; }
    .success-card p { color: #9ca3af; line-height: 1.6; }
    .error-msg { color: #ef4444; font-size: 0.85rem; margin-top: 8px; display: none; }
    .footer { margin-top: auto; padding: 24px; text-align: center; color: #555; font-size: 0.75rem; }
    /* QR page */
    .qr-grid { display: flex; gap: 48px; flex-wrap: wrap; justify-content: center; padding: 48px 24px; }
    .qr-card { text-align: center; }
    .qr-card img { border-radius: 12px; }
    .qr-card h3 { font-family: 'Sora', sans-serif; margin-top: 16px; font-size: 1.1rem; }
    .qr-card p { color: #9ca3af; font-size: 0.85rem; margin-top: 4px; }
  </style>
</head>
<body>
  ${bodyContent}
  <div class="footer">© 2026 illumibot.ai</div>
</body>
</html>`;
}

// ===== ROUTES =====

// Root: Installer Waitlist
app.get('/', (req, res) => {
  res.send(htmlPage('Installer Waitlist', `
  <div class="container">
    <img src="/img/logo.png" alt="illumibot" class="logo">
    <h1>Be the first to be notified when we open the <span class="accent">Installer Resellers Program</span></h1>
    <form id="waitlistForm" method="POST" action="/api/waitlist">
      <label>Company Name *</label>
      <input type="text" name="company" required placeholder="Your company name">
      <label>First Name *</label>
      <input type="text" name="firstName" required placeholder="First name">
      <label>Last Name *</label>
      <input type="text" name="lastName" required placeholder="Last name">
      <label>Email Address *</label>
      <input type="email" name="email" required placeholder="you@company.com" id="emailInput">
      <div class="error-msg" id="emailError">Please enter a valid email address</div>
      <label>Phone Number *</label>
      <input type="tel" name="phone" required placeholder="(555) 123-4567">
      <label>Notes <span style="color:#555">(optional)</span></label>
      <textarea name="notes" placeholder="Anything you'd like us to know..."></textarea>
      <button type="submit" class="btn" id="submitBtn">Join the Waitlist</button>
    </form>
  </div>
  <script>
    const form = document.getElementById('waitlistForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('emailInput').value;
      const errEl = document.getElementById('emailError');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      const btn = document.getElementById('submitBtn');
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      try {
        const res = await fetch('/api/waitlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(new FormData(form)))
        });
        const data = await res.json();
        if (data.success) {
          document.querySelector('.container').innerHTML = \`
            <div class="success-card">
              <img src="/img/logo.png" alt="illumibot" class="logo">
              <div class="check">✓</div>
              <h2>You're on the list!</h2>
              <p>Thanks for your interest in the <strong>Installer Resellers Program</strong>. We'll be in touch soon with more information.</p>
            </div>\`;
        } else {
          alert(data.error || 'Something went wrong. Please try again.');
          btn.disabled = false;
          btn.textContent = 'Join the Waitlist';
        }
      } catch(err) {
        alert('Network error. Please try again.');
        btn.disabled = false;
        btn.textContent = 'Join the Waitlist';
      }
    });
  </script>`));
});

// Contact share page
app.get('/contact', (req, res) => {
  res.send(htmlPage("Ross's Contact", `
  <div class="container">
    <img src="/img/logo.png" alt="illumibot" class="logo">
    <h1>Hi, I'm <span class="accent">Ross</span> with illumibot.</h1>
    <p style="text-align:center;color:#9ca3af;margin-bottom:32px;">Enter your email address and I'll send you my contact info.</p>
    <form id="contactForm">
      <label>Email Address</label>
      <input type="email" name="email" required placeholder="you@example.com" id="cEmailInput">
      <div class="error-msg" id="cEmailError">Please enter a valid email address</div>
      <button type="submit" class="btn" id="cSubmitBtn">Send Me Ross's Info</button>
    </form>
  </div>
  <script>
    const form = document.getElementById('contactForm');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('cEmailInput').value;
      const errEl = document.getElementById('cEmailError');
      if (!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        errEl.style.display = 'block';
        return;
      }
      errEl.style.display = 'none';
      const btn = document.getElementById('cSubmitBtn');
      btn.disabled = true;
      btn.textContent = 'Sending...';
      try {
        const res = await fetch('/api/contact', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        });
        const data = await res.json();
        if (data.success) {
          document.querySelector('.container').innerHTML = \`
            <div class="success-card">
              <img src="/img/logo.png" alt="illumibot" class="logo">
              <div class="check">✓</div>
              <h2>Check your inbox!</h2>
              <p>Ross's contact info has been sent to <strong>\${email}</strong>.</p>
            </div>\`;
        } else {
          alert(data.error || 'Something went wrong. Please try again.');
          btn.disabled = false;
          btn.textContent = "Send Me Ross's Info";
        }
      } catch(err) {
        alert('Network error. Please try again.');
        btn.disabled = false;
        btn.textContent = "Send Me Ross's Info";
      }
    });
  </script>`));
});

// API: Waitlist submission
app.post('/api/waitlist', formLimiter, (req, res) => {
  try {
    const { company, firstName, lastName, email, phone, notes } = req.body;
    if (!company || !firstName || !lastName || !email || !phone) {
      return res.status(400).json({ error: 'All required fields must be filled.' });
    }
    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Invalid email address.' });
    }
    const entry = {
      company, firstName, lastName, email, phone,
      notes: notes || '',
      timestamp: new Date().toISOString()
    };
    // Save to local file
    const entries = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    entries.push(entry);
    fs.writeFileSync(DATA_FILE, JSON.stringify(entries, null, 2));
    // Save to Firestore (if available)
    if (db) {
      db.collection('waitlist').add(entry).catch(e => console.error('Firestore write error:', e));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Waitlist error:', err);
    res.status(500).json({ error: 'Server error. Please try again.' });
  }
});

// API: Contact share
app.post('/api/contact', emailLimiter, async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !isValidEmail(email)) {
      return res.status(400).json({ error: 'Please provide a valid email address.' });
    }
    await transporter.sendMail({
      from: `"Ross Arroyo - illumibot" <${GMAIL_USER}>`,
      to: email,
      subject: "Ross Arroyo's Contact Info - illumibot",
      text: `Thanks for connecting with me! Here is my contact info:\n\nRoss Arroyo\nFounder / CEO, Illumibot.ai\n601-434-4099\nross@illumibot.ai`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px;background:#000;color:#fff;border-radius:12px;">
          <p style="font-size:16px;color:#ccc;">Thanks for connecting with me! Here is my contact info:</p>
          <div style="margin:24px 0;padding:20px;background:#111;border-radius:8px;border-left:3px solid #17FB15;">
            <p style="font-size:18px;font-weight:bold;margin:0 0 4px;">Ross Arroyo</p>
            <p style="color:#17FB15;margin:0 0 12px;">Founder / CEO, Illumibot.ai</p>
            <p style="margin:0;color:#ccc;">📱 <a href="tel:6014344099" style="color:#17FB15;">601-434-4099</a></p>
            <p style="margin:4px 0 0;color:#ccc;">✉️ <a href="mailto:ross@illumibot.ai" style="color:#17FB15;">ross@illumibot.ai</a></p>
          </div>
          <p style="font-size:12px;color:#555;text-align:center;">illumibot.ai — The 1st AI Personalized Projection™ App</p>
        </div>`
    });
    // Log contact email to Firestore
    if (db) {
      try {
        await db.collection('contact_submissions').add({
          email,
          submitted_at: admin.firestore.FieldValue.serverTimestamp()
        });
      } catch (fbErr) {
        console.error('Firestore contact log error:', fbErr);
      }
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Email error:', err);
    res.status(500).json({ error: 'Failed to send email. Please try again.' });
  }
});

// QR Codes page
app.get('/qr', async (req, res) => {
  try {
    const baseUrl = 'https://illumibot-waitlist--illumibot-waitlist.us-east4.hosted.app';
    const [waitlistQR, contactQR] = await Promise.all([
      QRCode.toDataURL(`${baseUrl}/`, { width: 300, margin: 2, color: { dark: '#17FB15', light: '#000000' } }),
      QRCode.toDataURL(`${baseUrl}/contact`, { width: 300, margin: 2, color: { dark: '#17FB15', light: '#000000' } })
    ]);
    res.send(htmlPage('QR Codes', `
    <div style="padding:48px 24px;text-align:center;">
      <img src="/img/logo.png" alt="illumibot" class="logo">
      <h1 style="margin-bottom:48px;"><span class="accent">QR Codes</span></h1>
      <div class="qr-grid">
        <div class="qr-card">
          <img src="${waitlistQR}" alt="Waitlist QR" width="300" height="300">
          <h3>Installer Waitlist</h3>
        </div>
        <div class="qr-card">
          <img src="${contactQR}" alt="Contact QR" width="300" height="300">
          <h3>Ross's Contact Info</h3>
        </div>
      </div>
    </div>`));
  } catch (err) {
    console.error('QR error:', err);
    res.status(500).send('Error generating QR codes');
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`illumibot waitlist server running on port ${PORT}`);
  console.log(`Waitlist: http://localhost:${PORT}/`);
  console.log(`Contact:  http://localhost:${PORT}/contact`);
  console.log(`QR Codes: http://localhost:${PORT}/qr`);
});
