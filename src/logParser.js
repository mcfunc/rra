/**
 * EVE Online combat log parser
 * Parses gamelogs to extract combat events
 */

const fs = require('fs');
const path = require('path');

// Regex patterns for log parsing
const TIMESTAMP_REGEX = /\[\s*(\d{4})\.(\d{2})\.(\d{2})\s+(\d{2}):(\d{2}):(\d{2})\s*\]/;
const LOG_LINE_REGEX = /\[\s*[\d.:\s]+\]\s*\((\w+)\)\s*(.*)/;

// Combat message patterns
const DAMAGE_DEALT_REGEX = /<color=[^>]+><b>(\d+)<\/b>.*?<color=[^>]+><b>(\d+)<\/b>.*?to\s+<b><color=[^>]+>([^<]+)<\/color><\/b>/i;
const DAMAGE_RECEIVED_REGEX = /<color=[^>]+><b>(\d+)<\/b>.*?from\s+<b><color=[^>]+>([^<]+)<\/color><\/b>/i;
const MISS_REGEX = /misses\s+(?:you|<b><color=[^>]+>([^<]+)<\/color><\/b>)\s+completely/i;
const WEAPON_REGEX = /-\s+<color=[^>]+><font[^>]*>([^<]+)<\/font>/i;
const HIT_QUALITY_REGEX = /(wrecks|penetrates|hits|grazes|glances|smashes)/i;

/**
 * Parse a timestamp string into a Date object
 * @param {string} line - Log line containing timestamp
 * @returns {Date|null}
 */
function parseTimestamp(line) {
  const match = line.match(TIMESTAMP_REGEX);
  if (!match) return null;

  const [, year, month, day, hour, minute, second] = match;
  return new Date(
    parseInt(year),
    parseInt(month) - 1,
    parseInt(day),
    parseInt(hour),
    parseInt(minute),
    parseInt(second)
  );
}

/**
 * Strip HTML/color tags from a string
 * @param {string} str
 * @returns {string}
 */
function stripTags(str) {
  return str.replace(/<[^>]+>/g, '').trim();
}

/**
 * Parse a single combat log line
 * @param {string} line - Raw log line
 * @returns {Object|null} Parsed combat event or null if not a combat line
 */
function parseCombatLine(line) {
  const timestamp = parseTimestamp(line);
  const lineMatch = line.match(LOG_LINE_REGEX);

  if (!lineMatch) return null;

  const [, type, content] = lineMatch;

  if (type !== 'combat') return null;

  const event = {
    timestamp,
    raw: line,
    type: 'unknown'
  };

  // Check for damage dealt
  const damageDealt = content.match(DAMAGE_DEALT_REGEX);
  if (damageDealt) {
    event.type = 'damage_dealt';
    event.damage = parseInt(damageDealt[1]);
    event.target = stripTags(damageDealt[3]);
  }

  // Check for damage received
  const damageReceived = content.match(DAMAGE_RECEIVED_REGEX);
  if (damageReceived) {
    event.type = 'damage_received';
    event.damage = parseInt(damageReceived[1]);
    event.source = stripTags(damageReceived[2]);
  }

  // Check for miss
  const miss = content.match(MISS_REGEX);
  if (miss) {
    event.type = 'miss';
    event.target = miss[1] ? stripTags(miss[1]) : 'you';
  }

  // Extract weapon if present
  const weapon = content.match(WEAPON_REGEX);
  if (weapon) {
    event.weapon = stripTags(weapon[1]);
  }

  // Extract hit quality if present
  const hitQuality = content.match(HIT_QUALITY_REGEX);
  if (hitQuality) {
    event.hitQuality = hitQuality[1].toLowerCase();
  }

  return event;
}

/**
 * Parse a combat log file
 * @param {string} filePath - Path to log file
 * @returns {Promise<Object[]>} Array of parsed combat events
 */
async function parseLogFile(filePath) {
  const content = await fs.promises.readFile(filePath, { encoding: 'utf16le' });
  const lines = content.split('\n');
  const events = [];

  for (const line of lines) {
    const event = parseCombatLine(line);
    if (event && event.type !== 'unknown') {
      events.push(event);
    }
  }

  return events;
}

/**
 * Parse log content from a string (for uploaded logs)
 * @param {string} content - Log file content
 * @returns {Object[]} Array of parsed combat events
 */
function parseLogContent(content) {
  const lines = content.split('\n');
  const events = [];

  for (const line of lines) {
    const event = parseCombatLine(line);
    if (event && event.type !== 'unknown') {
      events.push(event);
    }
  }

  return events;
}

/**
 * Calculate combat statistics from events
 * @param {Object[]} events - Parsed combat events
 * @returns {Object} Combat statistics
 */
function calculateStats(events) {
  const stats = {
    totalDamageDealt: 0,
    totalDamageReceived: 0,
    shotsHit: 0,
    shotsMissed: 0,
    hitRate: 0,
    targets: {},
    weapons: {},
    hitQualities: {},
    timespan: { start: null, end: null }
  };

  for (const event of events) {
    // Track timespan
    if (event.timestamp) {
      if (!stats.timespan.start || event.timestamp < stats.timespan.start) {
        stats.timespan.start = event.timestamp;
      }
      if (!stats.timespan.end || event.timestamp > stats.timespan.end) {
        stats.timespan.end = event.timestamp;
      }
    }

    if (event.type === 'damage_dealt') {
      stats.totalDamageDealt += event.damage;
      stats.shotsHit++;

      if (event.target) {
        stats.targets[event.target] = (stats.targets[event.target] || 0) + event.damage;
      }

      if (event.weapon) {
        if (!stats.weapons[event.weapon]) {
          stats.weapons[event.weapon] = { damage: 0, hits: 0, misses: 0 };
        }
        stats.weapons[event.weapon].damage += event.damage;
        stats.weapons[event.weapon].hits++;
      }

      if (event.hitQuality) {
        stats.hitQualities[event.hitQuality] = (stats.hitQualities[event.hitQuality] || 0) + 1;
      }
    } else if (event.type === 'damage_received') {
      stats.totalDamageReceived += event.damage;
    } else if (event.type === 'miss') {
      stats.shotsMissed++;

      if (event.weapon) {
        if (!stats.weapons[event.weapon]) {
          stats.weapons[event.weapon] = { damage: 0, hits: 0, misses: 0 };
        }
        stats.weapons[event.weapon].misses++;
      }
    }
  }

  const totalShots = stats.shotsHit + stats.shotsMissed;
  stats.hitRate = totalShots > 0 ? (stats.shotsHit / totalShots) * 100 : 0;

  // Calculate DPS if we have a timespan
  if (stats.timespan.start && stats.timespan.end) {
    const durationSeconds = (stats.timespan.end - stats.timespan.start) / 1000;
    stats.dps = durationSeconds > 0 ? stats.totalDamageDealt / durationSeconds : 0;
  }

  return stats;
}

/**
 * Find the most recent log files
 * @param {string} logsDir - Path to EVE logs directory
 * @param {number} limit - Maximum files to return
 * @returns {Promise<string[]>} Array of file paths
 */
async function findRecentLogs(logsDir, limit = 10) {
  try {
    const files = await fs.promises.readdir(logsDir);
    const logFiles = files
      .filter(f => f.endsWith('.txt'))
      .map(f => ({
        name: f,
        path: path.join(logsDir, f),
        // Parse date from filename: YYYYMMDD_HHMMSS_CharID.txt
        date: f.match(/^(\d{8}_\d{6})/) ? f.match(/^(\d{8}_\d{6})/)[1] : '0'
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    return logFiles.map(f => f.path);
  } catch (err) {
    return [];
  }
}

module.exports = {
  parseTimestamp,
  parseCombatLine,
  parseLogFile,
  parseLogContent,
  calculateStats,
  findRecentLogs,
  stripTags
};
