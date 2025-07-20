/**
 * Convert either:
 * - "MM/DD/YYYY, HH:mm:ss AM/PM" or
 * - "YYYY-MM-DD HH:mm:ss"
 *
 * + UTC offset (in hours) into a Zulu ISO timestamp.
 *
 * @param {string} localTimeString
 * @param {number} utcOffset
 * @returns {string} ISO string in UTC
 */
export function localTimeStringToZuluISO(localTimeString, utcOffset) {
  let year, month, day, hour, minute, second;

  if (localTimeString.includes(",")) {
    // Format: MM/DD/YYYY, HH:mm:ss AM/PM
    const [datePart, timePart] = localTimeString.split(", ");
    [month, day, year] = datePart.split("/").map(Number);

    let [time, meridiem] = timePart.split(" ");
    [hour, minute, second] = time.split(":").map(Number);

    if (meridiem === "PM" && hour !== 12) hour += 12;
    if (meridiem === "AM" && hour === 12) hour = 0;
  } else {
    // Format: YYYY-MM-DD HH:mm:ss
    const [datePart, timePart] = localTimeString.split(" ");
    [year, month, day] = datePart.split("-").map(Number);
    [hour, minute, second] = timePart.split(":").map(Number);
  }

  // Build Date object in local *wall clock* time
  const localDate = new Date(year, month - 1, day, hour, minute, second);

  // Adjust to UTC
  const utcMillis = localDate.getTime() - utcOffset * 60 * 60 * 1000;

  return new Date(utcMillis).toISOString();
}
