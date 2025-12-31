/**
 * EVE Online SSO (Single Sign-On) OAuth 2.0 implementation
 * Uses Authorization Code flow with PKCE
 */

const crypto = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');

const EVE_SSO = {
  authUrl: 'https://login.eveonline.com/v2/oauth/authorize',
  tokenUrl: 'https://login.eveonline.com/v2/oauth/token',
  jwksUrl: 'https://login.eveonline.com/oauth/jwks',
  revokeUrl: 'https://login.eveonline.com/v2/oauth/revoke'
};

// Cache the JWKS
let jwks = null;

/**
 * Get or create JWKS for token verification
 * @returns {Promise<Object>}
 */
async function getJWKS() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(EVE_SSO.jwksUrl));
  }
  return jwks;
}

/**
 * Generate a random string for state/PKCE
 * @param {number} length
 * @returns {string}
 */
function generateRandomString(length = 32) {
  return crypto.randomBytes(length).toString('base64url');
}

/**
 * Generate PKCE code verifier and challenge
 * @returns {Object} { verifier, challenge }
 */
function generatePKCE() {
  const verifier = generateRandomString(32);
  const challenge = crypto
    .createHash('sha256')
    .update(verifier)
    .digest('base64url');

  return { verifier, challenge };
}

/**
 * Build the authorization URL for SSO login
 * @param {Object} config
 * @param {string} config.clientId - EVE application client ID
 * @param {string} config.redirectUri - Callback URL
 * @param {string[]} config.scopes - Requested ESI scopes
 * @param {string} config.state - State parameter for CSRF protection
 * @param {string} config.codeChallenge - PKCE code challenge
 * @returns {string} Authorization URL
 */
function buildAuthUrl({ clientId, redirectUri, scopes = [], state, codeChallenge }) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256'
  });

  if (scopes.length > 0) {
    params.set('scope', scopes.join(' '));
  }

  return `${EVE_SSO.authUrl}?${params.toString()}`;
}

/**
 * Exchange authorization code for tokens
 * @param {Object} params
 * @param {string} params.code - Authorization code from callback
 * @param {string} params.clientId - EVE application client ID
 * @param {string} params.redirectUri - Same redirect URI used in auth request
 * @param {string} params.codeVerifier - PKCE code verifier
 * @returns {Promise<Object>} Token response
 */
async function exchangeCode({ code, clientId, redirectUri, codeVerifier }) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const response = await fetch(EVE_SSO.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Refresh an access token
 * @param {Object} params
 * @param {string} params.refreshToken - Refresh token
 * @param {string} params.clientId - EVE application client ID
 * @returns {Promise<Object>} Token response
 */
async function refreshAccessToken({ refreshToken, clientId }) {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId
  });

  const response = await fetch(EVE_SSO.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  return response.json();
}

/**
 * Verify and decode an access token (JWT)
 * @param {string} accessToken - JWT access token
 * @returns {Promise<Object>} Decoded token payload
 */
async function verifyToken(accessToken) {
  const jwks = await getJWKS();

  const { payload } = await jwtVerify(accessToken, jwks, {
    issuer: 'login.eveonline.com',
    audience: 'EVE Online'
  });

  return {
    characterId: parseInt(payload.sub.split(':')[2]),
    characterName: payload.name,
    scopes: payload.scp || [],
    expiresAt: new Date(payload.exp * 1000)
  };
}

/**
 * Revoke a refresh token
 * @param {Object} params
 * @param {string} params.refreshToken - Token to revoke
 * @param {string} params.clientId - EVE application client ID
 * @returns {Promise<void>}
 */
async function revokeToken({ refreshToken, clientId }) {
  const body = new URLSearchParams({
    token: refreshToken,
    token_type_hint: 'refresh_token',
    client_id: clientId
  });

  const response = await fetch(EVE_SSO.revokeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Host': 'login.eveonline.com'
    },
    body: body.toString()
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token revocation failed: ${error}`);
  }
}

/**
 * Express middleware factory for SSO
 * @param {Object} config
 * @returns {Object} Express router handlers
 */
function createSSOHandlers(config) {
  const { clientId, redirectUri, scopes = [] } = config;

  return {
    /**
     * Initiate SSO login
     */
    login: (req, res) => {
      const state = generateRandomString();
      const pkce = generatePKCE();

      // Store state and verifier in session
      req.session.ssoState = state;
      req.session.ssoVerifier = pkce.verifier;

      const authUrl = buildAuthUrl({
        clientId,
        redirectUri,
        scopes,
        state,
        codeChallenge: pkce.challenge
      });

      res.redirect(authUrl);
    },

    /**
     * Handle SSO callback
     */
    callback: async (req, res, next) => {
      try {
        const { code, state } = req.query;

        // Verify state
        if (state !== req.session.ssoState) {
          throw new Error('Invalid state parameter');
        }

        // Exchange code for tokens
        const tokens = await exchangeCode({
          code,
          clientId,
          redirectUri,
          codeVerifier: req.session.ssoVerifier
        });

        // Verify and decode the access token
        const character = await verifyToken(tokens.access_token);

        // Store in session
        req.session.character = character;
        req.session.accessToken = tokens.access_token;
        req.session.refreshToken = tokens.refresh_token;

        // Clean up SSO state
        delete req.session.ssoState;
        delete req.session.ssoVerifier;

        res.redirect('/');
      } catch (err) {
        next(err);
      }
    },

    /**
     * Logout handler
     */
    logout: async (req, res) => {
      if (req.session.refreshToken) {
        try {
          await revokeToken({
            refreshToken: req.session.refreshToken,
            clientId
          });
        } catch (err) {
          console.error('Failed to revoke token:', err);
        }
      }

      req.session.destroy();
      res.redirect('/');
    },

    /**
     * Middleware to require authentication
     */
    requireAuth: (req, res, next) => {
      if (!req.session.character) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      next();
    }
  };
}

module.exports = {
  EVE_SSO,
  generateRandomString,
  generatePKCE,
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  verifyToken,
  revokeToken,
  createSSOHandlers
};
