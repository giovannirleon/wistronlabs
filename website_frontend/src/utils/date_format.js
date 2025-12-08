import { DateTime } from "luxon";

export function formatDateHumanReadable(rawDate, serverZone = "UTC") {
  if (!rawDate) return "";

  let dt;

  // Support Date object, ISO string, or timestamp
  if (rawDate instanceof Date) {
    dt = DateTime.fromJSDate(rawDate, { zone: "utc" });
  } else if (typeof rawDate === "number") {
    dt = DateTime.fromMillis(rawDate, { zone: "utc" });
  } else {
    // assume ISO-ish string
    dt = DateTime.fromISO(String(rawDate), { zone: "utc" });
  }

  if (!dt.isValid) {
    console.warn("Invalid date value:", rawDate);
    return "";
  }

  // Convert from UTC to server's time zone
  const zoned = dt.setZone(serverZone || "UTC");

  // Same output format you had before
  return zoned.toFormat("MM/dd/yyyy, hh:mm:ss a");
}
