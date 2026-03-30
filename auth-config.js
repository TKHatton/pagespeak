'use strict';

// ============================================================
// Auth0 Configuration (public values — safe to embed)
// ============================================================
// Replace these with your Auth0 application credentials.
// 1. Go to Auth0 Dashboard → Applications → Your App → Settings
// 2. Copy the Domain and Client ID
// 3. Set Allowed Callback URL to the value of chrome.identity.getRedirectURL()
//    (printed to console on extension load for convenience)

/* eslint-disable no-unused-vars */
const AUTH_CONFIG = {
  // Your Auth0 tenant domain (e.g., 'my-app.us.auth0.com')
  domain: 'YOUR_TENANT.us.auth0.com',

  // Your Auth0 application Client ID
  clientId: 'YOUR_CLIENT_ID',

  // Automatically generated redirect URL for this extension
  // Format: https://<extension-id>.chromiumapp.org/
  redirectUrl: chrome.identity.getRedirectURL(),

  // OAuth scopes — openid + profile + email for user info,
  // offline_access for refresh tokens
  scopes: 'openid profile email offline_access',

  // API audience (optional, for later Stripe/API integration)
  // Create an API in Auth0 Dashboard → APIs → Create API
  // audience: 'https://api.pagespeak.app',
};

// Log the redirect URL on load so you can copy it into Auth0 Dashboard
console.info('PageSpeak Auth0 redirect URL:', AUTH_CONFIG.redirectUrl);
