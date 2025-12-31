/**
 * EVE Online turret hit chance calculator
 * Formula: hit_chance = 0.5 ^ ((angular * 40000 / (tracking * signature))² + (max(0, distance - optimal) / falloff)²)
 */

const SIGNATURE_RESOLUTION = 40000; // meters, constant for all turrets

/**
 * Calculate angular velocity from transversal velocity and distance
 * @param {number} transversal - Transversal velocity in m/s
 * @param {number} distance - Distance to target in meters
 * @returns {number} Angular velocity in rad/s
 */
function calculateAngularVelocity(transversal, distance) {
  if (distance <= 0) return Infinity;
  return transversal / distance;
}

/**
 * Calculate the tracking component of hit chance
 * @param {number} angularVelocity - Angular velocity in rad/s
 * @param {number} trackingSpeed - Turret tracking speed in rad/s
 * @param {number} signatureRadius - Target signature radius in meters
 * @returns {number} Tracking component (squared term)
 */
function calculateTrackingComponent(angularVelocity, trackingSpeed, signatureRadius) {
  if (trackingSpeed <= 0 || signatureRadius <= 0) return Infinity;
  const ratio = (angularVelocity * SIGNATURE_RESOLUTION) / (trackingSpeed * signatureRadius);
  return ratio * ratio;
}

/**
 * Calculate the range component of hit chance
 * @param {number} distance - Distance to target in meters
 * @param {number} optimalRange - Turret optimal range in meters
 * @param {number} falloff - Turret falloff range in meters
 * @returns {number} Range component (squared term)
 */
function calculateRangeComponent(distance, optimalRange, falloff) {
  if (falloff <= 0) return distance > optimalRange ? Infinity : 0;
  const excess = Math.max(0, distance - optimalRange);
  const ratio = excess / falloff;
  return ratio * ratio;
}

/**
 * Calculate turret hit chance
 * @param {Object} params
 * @param {number} params.transversal - Transversal velocity in m/s
 * @param {number} params.distance - Distance to target in meters
 * @param {number} params.trackingSpeed - Turret tracking speed in rad/s
 * @param {number} params.signatureRadius - Target signature radius in meters
 * @param {number} params.optimalRange - Turret optimal range in meters
 * @param {number} params.falloff - Turret falloff range in meters
 * @returns {Object} Calculation results
 */
function calculateHitChance({
  transversal,
  distance,
  trackingSpeed,
  signatureRadius,
  optimalRange,
  falloff
}) {
  const angularVelocity = calculateAngularVelocity(transversal, distance);
  const trackingComponent = calculateTrackingComponent(angularVelocity, trackingSpeed, signatureRadius);
  const rangeComponent = calculateRangeComponent(distance, optimalRange, falloff);

  const exponent = trackingComponent + rangeComponent;
  const hitChance = Math.pow(0.5, exponent);

  // Quality of hit affects damage: perfect hit = 100% damage, grazing = less
  // Wrecking hits (3% chance when you hit) do 300% damage
  const expectedDamageModifier = hitChance * (0.97 * 0.5 + 0.03 * 3); // Simplified average

  return {
    hitChance: Math.min(1, Math.max(0, hitChance)),
    hitChancePercent: Math.min(100, Math.max(0, hitChance * 100)),
    angularVelocity,
    angularVelocityMrad: angularVelocity * 1000, // millirads for display
    trackingComponent,
    rangeComponent,
    isInOptimal: distance <= optimalRange,
    isInFalloff: distance <= optimalRange + falloff,
    expectedDamageModifier
  };
}

/**
 * Calculate what transversal would give a specific hit chance at given distance
 * Useful for "how fast can I orbit and still hit?"
 * @param {Object} params
 * @param {number} params.targetHitChance - Desired hit chance (0-1)
 * @param {number} params.distance - Distance to target in meters
 * @param {number} params.trackingSpeed - Turret tracking speed in rad/s
 * @param {number} params.signatureRadius - Target signature radius in meters
 * @param {number} params.optimalRange - Turret optimal range in meters
 * @param {number} params.falloff - Turret falloff range in meters
 * @returns {number} Maximum transversal velocity in m/s
 */
function calculateMaxTransversal({
  targetHitChance,
  distance,
  trackingSpeed,
  signatureRadius,
  optimalRange,
  falloff
}) {
  if (targetHitChance <= 0 || targetHitChance > 1) return 0;

  const rangeComponent = calculateRangeComponent(distance, optimalRange, falloff);
  const totalExponent = Math.log(targetHitChance) / Math.log(0.5);
  const trackingExponent = totalExponent - rangeComponent;

  if (trackingExponent <= 0) return Infinity; // Range alone reduces hit chance below target

  const trackingRatio = Math.sqrt(trackingExponent);
  const angularVelocity = (trackingRatio * trackingSpeed * signatureRadius) / SIGNATURE_RESOLUTION;

  return angularVelocity * distance;
}

module.exports = {
  SIGNATURE_RESOLUTION,
  calculateAngularVelocity,
  calculateTrackingComponent,
  calculateRangeComponent,
  calculateHitChance,
  calculateMaxTransversal
};
