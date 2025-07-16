import { formatDateHumanReadable } from "../utils/date_format";

/**
 * Generates an array of date strings in YYYY-MM-DD format
 * between two dates, inclusive.
 *
 * @param {Date} fromDate - Start date of the range.
 * @param {Date} toDate - End date of the range.
 * @returns {string[]} Array of date strings.
 */
export function getDateRange(fromDate, toDate) {
  const dates = [];
  const current = new Date(fromDate);
  while (current <= toDate) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

/**
 * Builds two sets of daily snapshots from a history of system events:
 * - stHistoryByDate: cumulative snapshot of each service_tag's state up to each day.
 * - stWorkedOnByDate: snapshot of service_tags worked on during each specific day.
 *
 * The current day is determined by querying the backend's `/server/time` endpoint
 * and using its reported local time.
 *
 * @param {Object[]} history - Array of history records.
 * @param {Date} earliestDate - Earliest date to start the snapshots.
 * @returns {Promise<{ stHistoryByDate: Object[], stWorkedOnByDate: Object[] }>}
 *          Resolves to an object containing both snapshots.
 */
export default async function generateReport(history, earliestDate, systems) {
  // Fetch the current server-local time
  const serverTimeResponse = await fetch(
    "https://backend.tss.wistronlabs.com/api/v1/server/time"
  );
  const serverTimeData = await serverTimeResponse.json();

  // Parse the server's local time string and normalize to midnight
  const today = new Date(serverTimeData.localtime);
  console.log(today);
  today.setHours(0, 0, 0, 0);

  // Generate all dates between earliestDate and today (inclusive)
  const historyDates = getDateRange(earliestDate, today);

  // Build a map of service_tag → issue from the systems dataset
  const systemIssueByTag = new Map();
  systems.forEach((system) => {
    systemIssueByTag.set(system.service_tag, system.issue);
  });

  // Build a global map of the first-ever entry for each service_tag
  const globalEarliestByTag = new Map();
  history.forEach((entry) => {
    const entryTime = new Date(entry.changed_at);
    const earliest = globalEarliestByTag.get(entry.service_tag);
    if (!earliest || entryTime < new Date(earliest.changed_at)) {
      globalEarliestByTag.set(entry.service_tag, entry);
    }
  });

  /**
   * Build cumulative history snapshots per day.
   * For each date, the latest and earliest state of each service_tag
   * (up to and including that date) is recorded.
   */
  const stHistoryByDate = historyDates.map((date) => {
    const latestByTag = new Map();
    const earliestByTag = new Map();
    const dateEnd = new Date(date + "T23:59:59.999Z");

    history.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);
      if (entryTime <= dateEnd) {
        const latest = latestByTag.get(entry.service_tag);
        const earliest = earliestByTag.get(entry.service_tag);

        if (!latest || entryTime > new Date(latest.changed_at)) {
          latestByTag.set(entry.service_tag, entry);
        }

        if (!earliest || entryTime < new Date(earliest.changed_at)) {
          earliestByTag.set(entry.service_tag, entry);
        }
      }
    });

    const snapshot = [...latestByTag.values()].map((entry) => {
      const earliestEntry = earliestByTag.get(entry.service_tag);
      return {
        recieved_on: formatDateHumanReadable(earliestEntry?.changed_at) || null,
        service_tag: entry.service_tag,
        issue: systemIssueByTag.get(entry.service_tag) || "Unknown",
        location: entry.to_location?.trim() || "Unknown",
        last_note:
          entry.to_location === "Sent to L11"
            ? "Passed L10"
            : entry.note || "Unknown", // need to make this title agnostic
      };
    });

    return { date, snapshot };
  });

  /**
   * Build daily worked-on snapshots.
   * For each date, only the service_tags that had events on that specific day
   * are recorded, showing the latest change on that day.
   */
  const stWorkedOnByDate = historyDates.map((date) => {
    const dateStart = new Date(date + "T00:00:00.000Z");
    const dateEnd = new Date(date + "T23:59:59.999Z");

    const entriesOnThisDate = history.filter((entry) => {
      const entryTime = new Date(entry.changed_at);
      return entryTime >= dateStart && entryTime <= dateEnd;
    });

    const latestByTag = new Map();

    entriesOnThisDate.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);
      const latest = latestByTag.get(entry.service_tag);
      if (!latest || entryTime > new Date(latest.changed_at)) {
        latestByTag.set(entry.service_tag, entry);
      }
    });

    const snapshot = [...latestByTag.values()].map((entry) => {
      const earliestEntry = globalEarliestByTag.get(entry.service_tag);
      console.log(entry);
      return {
        recieved_on: formatDateHumanReadable(earliestEntry?.changed_at) || null,
        service_tag: entry.service_tag,
        issue: systemIssueByTag.get(entry.service_tag) || "Unknown",
        location: entry.to_location?.trim() || "Unknown",
        last_note:
          entry.to_location === "Sent to L11"
            ? "Passed L10"
            : entry.note || "Unknown", // need to make this title agnostic
      };
    });

    return { date, snapshot };
  });

  return { stHistoryByDate, stWorkedOnByDate };
}
