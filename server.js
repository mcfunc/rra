require('dotenv').config();

const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');

const { createSSOHandlers } = require('./src/sso');
const calculator = require('./src/calculator');
const logParser = require('./src/logParser');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Session configuration
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// SSO routes (only if configured)
if (process.env.EVE_CLIENT_ID) {
  const ssoHandlers = createSSOHandlers({
    clientId: process.env.EVE_CLIENT_ID,
    redirectUri: process.env.EVE_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`,
    scopes: [] // No scopes needed for basic character auth
  });

  app.get('/auth/login', ssoHandlers.login);
  app.get('/auth/callback', ssoHandlers.callback);
  app.get('/auth/logout', ssoHandlers.logout);

  app.get('/api/me', (req, res) => {
    if (req.session.character) {
      res.json(req.session.character);
    } else {
      res.status(401).json({ error: 'Not authenticated' });
    }
  });
}

// Calculator API
app.post('/api/calculate', (req, res) => {
  try {
    const {
      transversal,
      distance,
      trackingSpeed,
      signatureRadius,
      optimalRange,
      falloff
    } = req.body;

    // Validate inputs
    const params = {
      transversal: parseFloat(transversal) || 0,
      distance: parseFloat(distance) || 1,
      trackingSpeed: parseFloat(trackingSpeed) || 0.01,
      signatureRadius: parseFloat(signatureRadius) || 100,
      optimalRange: parseFloat(optimalRange) || 10000,
      falloff: parseFloat(falloff) || 5000
    };

    const result = calculator.calculateHitChance(params);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Calculate max transversal for a given hit chance
app.post('/api/max-transversal', (req, res) => {
  try {
    const {
      targetHitChance,
      distance,
      trackingSpeed,
      signatureRadius,
      optimalRange,
      falloff
    } = req.body;

    const params = {
      targetHitChance: parseFloat(targetHitChance) || 0.5,
      distance: parseFloat(distance) || 1,
      trackingSpeed: parseFloat(trackingSpeed) || 0.01,
      signatureRadius: parseFloat(signatureRadius) || 100,
      optimalRange: parseFloat(optimalRange) || 10000,
      falloff: parseFloat(falloff) || 5000
    };

    const maxTransversal = calculator.calculateMaxTransversal(params);
    res.json({ maxTransversal });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Parse uploaded combat log
app.post('/api/parse-log', express.text({ type: '*/*', limit: '10mb' }), (req, res) => {
  try {
    const events = logParser.parseLogContent(req.body);
    const stats = logParser.calculateStats(events);
    res.json({ events, stats });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Turret presets (common railgun configurations)
app.get('/api/presets', (req, res) => {
  res.json({
    turrets: [
      { name: '150mm Railgun I', tracking: 0.165, optimal: 12000, falloff: 6000 },
      { name: '150mm Railgun II', tracking: 0.182, optimal: 14400, falloff: 7200 },
      { name: '250mm Railgun I', tracking: 0.0525, optimal: 20000, falloff: 12000 },
      { name: '250mm Railgun II', tracking: 0.0578, optimal: 24000, falloff: 14400 },
      { name: '350mm Railgun I', tracking: 0.0225, optimal: 30000, falloff: 20000 },
      { name: '350mm Railgun II', tracking: 0.0248, optimal: 36000, falloff: 24000 },
      { name: '425mm Railgun I', tracking: 0.0125, optimal: 40000, falloff: 30000 },
      { name: '425mm Railgun II', tracking: 0.0138, optimal: 48000, falloff: 36000 }
    ],
    signatures: [
      { name: 'Frigate', radius: 35 },
      { name: 'Destroyer', radius: 60 },
      { name: 'Cruiser', radius: 125 },
      { name: 'Battlecruiser', radius: 270 },
      { name: 'Battleship', radius: 400 }
    ],
    ammo: [
      { name: 'Antimatter (Short)', trackingMod: 1.0, optimalMod: 0.5, falloffMod: 1.0 },
      { name: 'Thorium (Medium)', trackingMod: 1.0, optimalMod: 0.75, falloffMod: 1.0 },
      { name: 'Iron (Long)', trackingMod: 1.0, optimalMod: 1.5, falloffMod: 1.0 },
      { name: 'Spike (Extreme)', trackingMod: 0.75, optimalMod: 2.0, falloffMod: 0.5 },
      { name: 'Javelin (Close)', trackingMod: 1.25, optimalMod: 0.25, falloffMod: 1.0 }
    ]
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', ssoConfigured: !!process.env.EVE_CLIENT_ID });
});

// Serve frontend
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`RRA server running on http://localhost:${PORT}`);
  if (!process.env.EVE_CLIENT_ID) {
    console.log('Note: EVE SSO not configured. Set EVE_CLIENT_ID to enable authentication.');
  }
});
