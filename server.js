const express = require('express');
const path = require('path');
const { google } = require('googleapis');
const app = express();

app.use(express.json());

function getSheets() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

const SHEET_ID = process.env.SPREADSHEET_ID;

// Explicit routes first — before static middleware
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

app.get('/availability', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/roster', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'roster.html'));
});

app.get('/hours', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'hours.html'));
});

// Static files after explicit routes
app.use(express.static(path.join(__dirname, 'public')));

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
    // Normalize en-dash vs hyphen in slot column, filter by month, skip header
    const filtered = values
      .filter(r => r[0] !== 'Date' && (!month || r[3] === month))
      .map(r => {
        if (r[1]) r[1] = r[1].replace(/\u2013/g, '-').replace(/-/g, '\u2013'); // normalize to en-dash
        return r;
      })
      .filter(r => r[0] && r[2]); // only rows with date AND dj
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

    const normalizeSlot = s => s ? s.replace(/[-\u2013]/g, '\u2013') : s;
    const normSlot = normalizeSlot(slot);
    const rowIndex = existingRows.findIndex(r => r[0] === date && normalizeSlot(r[1]) === normSlot && r[3] === month);

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

// Batch assign — save many slots in one request
app.post('/api/roster/batch', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month, assignments } = req.body;
    // assignments = [{ date, slot, dj }, ...]
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';

    // Read existing sheet once
    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    // Build a map of existing row indices: "date|slot" -> rowIndex
    const normalizeSlot = s => s ? s.replace(/[-\u2013]/g, '\u2013') : s;
    const rowMap = {};
    existingRows.forEach((r, i) => {
      if (r[0] && r[1] && r[3] === month) rowMap[`${r[0]}|${normalizeSlot(r[1])}`] = i;
    });

    const updateData = [];
    const appendRows = [];

    for (const { date, slot, dj } of assignments) {
      const key = `${date}|${normalizeSlot(slot)}`;
      if (rowMap[key] !== undefined) {
        updateData.push({
          range: `${tabName}!A${rowMap[key] + 1}:D${rowMap[key] + 1}`,
          values: [[date, slot, dj, month]],
        });
      } else {
        appendRows.push([date, slot, dj, month]);
      }
    }

    // Batch update existing rows
    if (updateData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: updateData,
        },
      });
    }

    // Append new rows
    if (appendRows.length > 0) {
      await sheets.spreadsheets.values.append({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
        valueInputOption: 'RAW',
        requestBody: { values: appendRows },
      });
    }

    res.json({ success: true, updated: updateData.length, appended: appendRows.length });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// Clear entire month for a venue in one shot
app.post('/api/roster/clear', async (req, res) => {
  try {
    const sheets = getSheets();
    const { venue, month } = req.body;
    const tabName = venue === 'love' ? 'Love Beach Roster' : 'ARKbar Roster';

    // Read all rows
    let existingRows = [];
    try {
      const response = await sheets.spreadsheets.values.get({
        spreadsheetId: SHEET_ID,
        range: `${tabName}!A:D`,
      });
      existingRows = response.data.values || [];
    } catch(e) {}

    // Find ALL rows that have any content matching this month OR are empty placeholder rows
    // Also clear rows where month matches (col D index 3)
    const clearData = [];
    existingRows.forEach((r, i) => {
      const rowMonth = r[3] || '';
      const hasContent = r[0] || r[1] || r[2] || r[3];
      if (rowMonth === month) {
        clearData.push({
          range: `${tabName}!A${i + 1}:D${i + 1}`,
          values: [['', '', '', '']],
        });
      }
    });

    if (clearData.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: SHEET_ID,
        requestBody: {
          valueInputOption: 'RAW',
          data: clearData,
        },
      });
    }

    res.json({ success: true, cleared: clearData.length });
  } catch (err) {
    console.error('Clear error:', err);
    res.json({ success: false, error: err.message });
  }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, '0.0.0.0', () => console.log(`Server running on port ${PORT}`));
