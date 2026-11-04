// Hauteur du soleil (algorithme NOAA simplifié, précis à la minute près) :
// sert au mode nuit automatique pendant la conduite.

const RADIANS = Math.PI / 180

/** Hauteur du soleil au-dessus de l'horizon, en degrés. */
export function getSunElevation(date: Date, latitude: number, longitude: number): number {
  const julianDay = date.getTime() / 86_400_000 + 2_440_587.5
  const century = (julianDay - 2_451_545) / 36_525

  const meanLongitude = (280.46646 + century * (36_000.76983 + century * 0.0003032)) % 360
  const meanAnomaly = 357.52911 + century * (35_999.05029 - 0.0001537 * century)
  const eccentricity = 0.016708634 - century * (0.000042037 + 0.0000001267 * century)
  const center =
    Math.sin(meanAnomaly * RADIANS) * (1.914602 - century * (0.004817 + 0.000014 * century)) +
    Math.sin(2 * meanAnomaly * RADIANS) * (0.019993 - 0.000101 * century) +
    Math.sin(3 * meanAnomaly * RADIANS) * 0.000289
  const trueLongitude = meanLongitude + center
  const omega = 125.04 - 1934.136 * century
  const apparentLongitude = trueLongitude - 0.00569 - 0.00478 * Math.sin(omega * RADIANS)
  const meanObliquity =
    23 + (26 + (21.448 - century * (46.815 + century * (0.00059 - century * 0.001813))) / 60) / 60
  const obliquity = meanObliquity + 0.00256 * Math.cos(omega * RADIANS)
  const declination = Math.asin(Math.sin(obliquity * RADIANS) * Math.sin(apparentLongitude * RADIANS))

  const y = Math.tan((obliquity / 2) * RADIANS) ** 2
  const equationOfTime =
    4 *
    (y * Math.sin(2 * meanLongitude * RADIANS) -
      2 * eccentricity * Math.sin(meanAnomaly * RADIANS) +
      4 * eccentricity * y * Math.sin(meanAnomaly * RADIANS) * Math.cos(2 * meanLongitude * RADIANS) -
      0.5 * y * y * Math.sin(4 * meanLongitude * RADIANS) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * meanAnomaly * RADIANS)) /
    RADIANS

  const utcMinutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const trueSolarTime = (((utcMinutes + equationOfTime + 4 * longitude) % 1440) + 1440) % 1440
  const hourAngle = trueSolarTime / 4 < 0 ? trueSolarTime / 4 + 180 : trueSolarTime / 4 - 180

  const zenith = Math.acos(
    Math.sin(latitude * RADIANS) * Math.sin(declination) +
      Math.cos(latitude * RADIANS) * Math.cos(declination) * Math.cos(hourAngle * RADIANS),
  )
  return 90 - zenith / RADIANS
}

/**
 * Nuit = soleil sous l'horizon (crépuscule civil compris : -0,833° correspond au coucher visible,
 * on bascule un peu avant pour ne pas rester en clair pendant le crépuscule).
 */
export function isNightAt(date: Date, latitude: number, longitude: number): boolean {
  return getSunElevation(date, latitude, longitude) < 1
}
