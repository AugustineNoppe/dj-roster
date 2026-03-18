// Utility: generate a bcrypt hash for use in ADMIN_PASSWORD or MANAGER_PASSWORD env vars.
// Usage: node scripts/hash-password.js "your-password-here"
// Output: bcrypt hash string to paste into .env

const bcrypt = require('bcrypt');
const password = process.argv[2];
if (!password) {
  console.error('Usage: node scripts/hash-password.js "your-password-here"');
  process.exit(1);
}
bcrypt.hash(password, 10).then(hash => {
  console.log(hash);
}).catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
