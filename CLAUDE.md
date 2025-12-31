# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**RRA (Railgun Range Application)** - An EVE Online web tool that helps pilots calculate turret hit probability based on transversal velocity, tracking speed, and signature mechanics. The tool authenticates via EVE SSO and can parse client combat logs for real-time or post-fight analysis.

## Core Formulas

### Turret Hit Chance
```
hit_chance = 0.5 ^ ((angular * 40000 / (tracking * signature))² + (max(0, distance - optimal) / falloff)²)
```

Where:
- `angular`: Target's angular velocity (rad/s) = transversal_velocity / distance
- `tracking`: Turret tracking speed (rad/s)
- `signature`: Target signature radius (m)
- `40000`: Turret signature resolution constant (m)
- `distance`, `optimal`, `falloff`: Range values (m)

### Angular Velocity
```
angular_velocity = transversal_velocity / distance
```

## EVE SSO Integration

Uses OAuth 2.0 Authorization Code flow with PKCE:
- Auth endpoint: `https://login.eveonline.com/v2/oauth/authorize`
- Token endpoint: `https://login.eveonline.com/v2/oauth/token`
- JWKS endpoint: `https://login.eveonline.com/oauth/jwks`
- Access tokens are JWTs valid for 20 minutes
- Refresh tokens are long-lived

Register applications at: https://developers.eveonline.com/

ESI API base: `https://esi.evetech.net/latest/`

## Combat Log Parsing

### Log Locations
- Windows: `%USERPROFILE%\Documents\EVE\logs\Gamelogs\`
- Linux (Steam/Proton): `~/.local/share/Steam/steamapps/compatdata/8500/pfx/drive_c/users/steamuser/My Documents/EVE/logs/`
- macOS: `~/Documents/EVE/logs/`

### Log Format
- Encoding: UTF-16LE
- Filename pattern: `YYYYMMDD_HHMMSS_CharacterID.txt`
- Line format: `[ YYYY.MM.DD HH:MM:SS ] (type) <content>`
- Combat lines include HTML-like color tags

### Timestamp Regex
```
\[ (\d{4})\.(\d{2})\.(\d{2}) (\d{2}):(\d{2}):(\d{2}) \]
```

## Architecture Recommendations

### Backend
- Node.js/Express or Python/FastAPI for API
- Store refresh tokens encrypted (never access tokens)
- Validate JWT signatures against EVE's JWKS
- WebSocket support for live log monitoring

### Frontend
- Real-time hit chance visualization as variables change
- Sliders/inputs for: distance, transversal, tracking, signature, optimal, falloff
- Support for pasting/uploading log files
- Display angular velocity alongside transversal

### Key ESI Endpoints (public, no auth required)
- `GET /universe/types/{type_id}/` - Get turret stats (tracking, optimal, falloff)
- `GET /dogma/attributes/` - Attribute definitions

## EVE-Specific Constants

| Turret Class | Typical Tracking (rad/s) |
|--------------|-------------------------|
| Large Rails  | 0.0125 - 0.03          |
| Medium Rails | 0.04 - 0.065           |
| Small Rails  | 0.13 - 0.18            |

Tracking improves with: smaller turrets, short-range ammo, tracking computers, stasis webifiers (reducing target speed).

## Resources

- [EVE SSO Documentation](https://developers.eveonline.com/docs/services/sso/)
- [ESI Swagger UI](https://esi.evetech.net/ui/)
- [Turret Mechanics Wiki](https://wiki.eveuniversity.org/Turret_mechanics)
- [SSO Issues Repository](https://github.com/ccpgames/sso-issues)
