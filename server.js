const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const app = express();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_ID = process.env.SPREADSHEET_ID;

app.get('/roster', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'roster.html'));
});

app.post('/api/auth', (req, res) => {
  const { password } = req.body;
  res.json({ success: password === process.env.ADMIN_PASSWORD });
});

app.get('/api/availability', async (req, res) => {
  try {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DJ Availability_Datasheet!A2:F',
    });
    const rows = response.data.values || [];
    const month = req.query.month;
    const filtered = month ? rows.filter(r => r[2] === month) : rows;
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

app.get('/api/djs', async (req, res) => {
  try {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SHEET_ID,
      range: 'DJ Rates!A2:B',
    });
    const rows = response.data.values || [];
    const djs = rows.map(([name, rate]) => ({ name, rate: parseInt(rate) || 0 }));
    res.json({ success: true, djs });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.get('/api/roster', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.query;
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';
    let values = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      values = response.data.values || [];
    } catch (e) {}
    // Filter by month (column D), skip header row
    const filtered = values.filter(r => r[0] !== 'Date' && (!month || r[3] === month));
    res.json({ success: true, roster: filtered });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

app.post('/api/roster/assign', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, date, slot, dj, month } = req.body;
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';

    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    // Match on date + slot + month
    const rowIndex = existingRows.findIndex(r => r[0] === date && r[1] === slot && r[3] === month);

    if (rowIndex >= 0) {
      if (dj) {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${tabName}!A${rowIndex + 1}:D${rowIndex + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [[date, slot, dj, month]] },
        });
      } else {
        await sheets.spreadsheets.values.update({
          spreadsheetId: SHEET_ID,
          range: `${tabName}!A${rowIndex + 1}:D${rowIndex + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [['', '', '', '']] },
        });
      }
    } else if (dj) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
        valueInputOption: 'RAW',
        requestBody: { values: [[date, slot, dj, month]] },
      });
    }

    res.json({ success: true });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
