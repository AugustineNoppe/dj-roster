const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Serve the existing availability form at /
app.use(express.static(path.join(__dirname, 'public')));

// Health check
app.get('/health', (req, res) => res.send('OK'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
