/**
 * One-time (and every ~5 days, since Swiggy MCP v1.0 has no refresh-token grant) interactive login.
 * Run manually: `npm run swiggy-login`. Opens a browser for phone + OTP, then saves the access token
 * to .swiggy_token.json for checkers/instamart.js to use.
 */
const { login } = require('./utils/swiggyAuth');

login().catch((err) => {
  console.error('[swiggy-login] failed:', err.message);
  process.exit(1);
});
