/**
 * Format a Date object as YYYY-MM-DD
 * @param {Date} date
 * @returns {string} formatted date
 */
export default function formatDateYYYYMMDD(date) {
  if (!(date instanceof Date)) {
    throw new Error("Expected a Date object");
  }
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
