'use strict';

// ============================================================
// PageSpeak Auth Module — Auth0 PKCE Flow for Chrome MV3
// Loaded into the service worker via importScripts.
// ============================================================

// --- In-memory token state (cleared on SW sleep, restored via refresh) ---
let authState = {
  accessToken: null,
  refreshToken: null,
  idToken: null,
  expiresAt: 0,
  user: null,
};

// ============================================================
// PKCE Helpers (Web Crypto API — available in service workers)
// ============================================================

function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64urlEncode(new Uint8Array(digest));
}

function base64urlEncode(buffer) {
  let str = '';
  for (const byte of buffer) {
    str += String.fromCharCode(byte);
  }
  return btoa(str)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateRandomState() {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  return base64urlEncode(array);
}

// ============================================================
// Login — Authorization Code + PKCE via launchWebAuthFlow
// ============================================================

async function login() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = generateRandomState();

  // Build Auth0 authorize URL
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: AUTH_CONFIG.clientId,
    redirect_uri: AUTH_CONFIG.redirectUrl,
    scope: AUTH_CONFIG.scopes,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    state: state,
    prompt: 'login',
  });

  // Add audience if configured
  if (AUTH_CONFIG.audience) {
    params.set('audience', AUTH_CONFIG.audience);
  }

  const authUrl = `https://${AUTH_CONFIG.domain}/authorize?${params.toString()}`;

  try {
    // Opens Auth0 Universal Login in a browser popup
    const redirectUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });

    // Parse the redirect URL
    const url = new URL(redirectUrl);
    const code = url.searchParams.get('code');
    const returnedState = url.searchParams.get('state');
    const error = url.searchParams.get('error');

    if (error) {
      const desc = url.searchParams.get('error_description') || error;
      return { success: false, error: desc };
    }

    // Verify state (CSRF protection)
    if (returnedState !== state) {
      return { success: false, error: 'State mismatch — possible CSRF attack' };
    }

    if (!code) {
      return { success: false, error: 'No authorization code received' };
    }

    // Exchange code for tokens
    const tokens = await exchangeCodeForTokens(code, codeVerifier);

    // Store tokens
    authState.accessToken = tokens.access_token;
    authState.refreshToken = tokens.refresh_token || null;
    authState.idToken = tokens.id_token || null;
    authState.expiresAt = Date.now() + (tokens.expires_in * 1000);

    // Decode ID token for user profile
    if (tokens.id_token) {
      authState.user = decodeIdToken(tokens.id_token);
    }

    // Persist refresh token to session storage (survives SW restarts)
    if (authState.refreshToken) {
      try {
        await chrome.storage.session.set({
          authRefreshToken: authState.refreshToken,
        });
      } catch (e) {
        console.warn('PageSpeak: failed to store refresh token', e);
      }
    }

    return { success: true, user: authState.user };

  } catch (e) {
    // User closed the popup or network error
    if (e.message && e.message.includes('canceled')) {
      return { success: false, error: 'Login cancelled' };
    }
    return { success: false, error: e.message || 'Login failed' };
  }
}

// ============================================================
// Token Exchange — POST to Auth0 /oauth/token
// ============================================================

async function exchangeCodeForTokens(code, codeVerifier) {
  const response = await fetch(`https://${AUTH_CONFIG.domain}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'authorization_code',
      client_id: AUTH_CONFIG.clientId,
      code_verifier: codeVerifier,
      code: code,
      redirect_uri: AUTH_CONFIG.redirectUrl,
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error_description || `Token exchange failed: ${response.status}`);
  }

  return response.json();
}

// ============================================================
// Token Refresh — silent re-authentication
// ============================================================

async function refreshAccessToken() {
  const refreshToken = authState.refreshToken;
  if (!refreshToken) {
    // Try loading from session storage
    try {
      const stored = await chrome.storage.session.get('authRefreshToken');
      if (!stored.authRefreshToken) return null;
      authState.refreshToken = stored.authRefreshToken;
    } catch (e) {
      return null;
    }
  }

  try {
    const response = await fetch(`https://${AUTH_CONFIG.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: AUTH_CONFIG.clientId,
        refresh_token: authState.refreshToken,
      }),
    });

    if (!response.ok) {
      // Refresh token expired or revoked — force re-login
      await clearAuthState();
      return null;
    }

    const tokens = await response.json();

    authState.accessToken = tokens.access_token;
    authState.expiresAt = Date.now() + (tokens.expires_in * 1000);

    // Refresh token rotation: Auth0 may issue a new refresh token
    if (tokens.refresh_token) {
      authState.refreshToken = tokens.refresh_token;
      try {
        await chrome.storage.session.set({
          authRefreshToken: tokens.refresh_token,
        });
      } catch (e) { /* non-critical */ }
    }

    // Update user profile if a new ID token was issued
    if (tokens.id_token) {
      authState.idToken = tokens.id_token;
      authState.user = decodeIdToken(tokens.id_token);
    }

    return authState.accessToken;
  } catch (e) {
    console.warn('PageSpeak: token refresh failed', e);
    return null;
  }
}

// ============================================================
// Get Access Token — returns current or refreshes
// ============================================================

async function getAccessToken() {
  // Return current token if still valid (with 60s buffer)
  if (authState.accessToken && Date.now() < authState.expiresAt - 60000) {
    return authState.accessToken;
  }

  // Attempt silent refresh
  return refreshAccessToken();
}

// ============================================================
// Logout
// ============================================================

async function logout() {
  await clearAuthState();

  // Optionally clear Auth0 session (non-interactive)
  try {
    const logoutUrl = `https://${AUTH_CONFIG.domain}/v2/logout?` +
      `client_id=${AUTH_CONFIG.clientId}&` +
      `returnTo=${encodeURIComponent(AUTH_CONFIG.redirectUrl)}`;

    await chrome.identity.launchWebAuthFlow({
      url: logoutUrl,
      interactive: false,
    });
  } catch (e) {
    // Non-interactive logout may fail silently — that's fine
  }

  return { success: true };
}

async function clearAuthState() {
  authState = {
    accessToken: null,
    refreshToken: null,
    idToken: null,
    expiresAt: 0,
    user: null,
  };

  try {
    await chrome.storage.session.remove('authRefreshToken');
  } catch (e) { /* non-critical */ }
}

// ============================================================
// Session Restore — called on service worker wake
// ============================================================

async function restoreSession() {
  try {
    const stored = await chrome.storage.session.get('authRefreshToken');
    if (!stored.authRefreshToken) return;

    authState.refreshToken = stored.authRefreshToken;
    await refreshAccessToken();
  } catch (e) {
    console.warn('PageSpeak: session restore failed', e);
  }
}

// ============================================================
// Auth State Query — used by popup
// ============================================================

function getAuthState() {
  return {
    isAuthenticated: !!(authState.accessToken && Date.now() < authState.expiresAt),
    user: authState.user ? {
      email: authState.user.email || null,
      name: authState.user.name || null,
      picture: authState.user.picture || null,
    } : null,
    subscription: null, // Placeholder for Stripe integration
  };
}

// ============================================================
// ID Token Decoder (base64 JWT payload — no verification needed
// since we got the token directly from Auth0 over HTTPS)
// ============================================================

function decodeIdToken(idToken) {
  try {
    const parts = idToken.split('.');
    if (parts.length !== 3) return null;

    // Decode the payload (second part)
    const payload = parts[1]
      .replace(/-/g, '+')
      .replace(/_/g, '/');

    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch (e) {
    console.warn('PageSpeak: failed to decode ID token', e);
    return null;
  }
}
