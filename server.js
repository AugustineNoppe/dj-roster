const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Google Sheets auth
function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_ID = process.env.SPREADSHEET_ID;

// Roster page
app.get('/roster', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'roster.html'));
});

// Auth
app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  res.json({ success: password === process.env.ADMIN_PASSWORD });
});

// Get availability for a given month
app.get('/api/availability', async (req, res) => {
  try {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DJ Availability_Datasheet!A2:F',
    });
    const rows = response.data.values || [];
    // Filter by month if provided
    const month = req.query.month; // e.g. "March 2026"
    const filtered = month
      ? rows.filter(r => r[2] === month)
      : rows;
    // Build availability map: { "2026-03-01": { "14:00–15:00": ["Alex","Raffo"] } }
    const map = {};
    filtered.forEach(([timestamp, dj, monthLabel, date, day, slot]) => {
      if (!date || !slot) return;
      if (!map[date]) map[date] = {};
      if (!map[date][slot]) map[date][slot] = [];
      if (!map[date][slot].includes(dj)) map[date][slot].push(dj);
    });
    res.json({ success: true, availability: map });
  } catch (err) {
    console.error(err);
    res.json({ success: false, error: err.message });
  }
});

// Get roster assignments for a venue/month
app.get('/api/roster', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.query;
    const tabName = venue === 'love' ? 'Love Beach Roster' :
