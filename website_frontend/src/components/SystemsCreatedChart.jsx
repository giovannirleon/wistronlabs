import React from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";

function formatDateMMDDYY(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function SystemLocationsChart({ history }) {
  const EXCLUDED_LOCATIONS_EOD = [
    "Pending Parts",
    "In Debug - Wistron",
    "In Debug - Nvidia",
    "In L10",
  ];

  const CHART_COLORS = [
    "#e63946", // red
    "#1f77b4", // blue 1
    "#4e9dd3", // blue 2
    "#145a86", // blue 3
    "#6ca0dc", // blue 4
  ];

  const KNOWN_LOCATIONS = ["Processed", "RMA PID", "RMA CID", "RMA VID"];

  const allLocations = new Set(KNOWN_LOCATIONS);

  const historyDates = [
    ...new Set(
      history.map((entry) => {
        const dateStr = formatDateMMDDYY(new Date(entry.changed_at));
        return dateStr;
      })
    ),
  ].sort((a, b) => new Date(a) - new Date(b));

  const historyByDate = historyDates.map((date) => {
    const dateStart = new Date(`${date} 00:00:00`);
    const dateEnd = new Date(`${date} 23:59:59`);

    const latestByTag = new Map();

    // consider only entries that happened on this specific day
    history.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);
      if (entryTime >= dateStart && entryTime <= dateEnd) {
        const existing = latestByTag.get(entry.service_tag);

        if (!existing || entryTime > new Date(existing.changed_at)) {
          latestByTag.set(entry.service_tag, entry);
        }
      }
    });

    const locationTotals = {};
    [...latestByTag.values()].forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      if (loc === "Processed") return; // skip, handled separately
      if (EXCLUDED_LOCATIONS_EOD.includes(loc)) return; // skip excluded
      locationTotals[loc] = (locationTotals[loc] || 0) + 1;
    });

    return {
      date: date,
      toLocationCounts: locationTotals,
    };
  });

  // 🔷 historyByDateFirstChange — only first "Processed" change per day
  const historyByDateFirstChange = historyDates.map((date) => {
    const dateStart = new Date(`${date} 00:00:00`);
    const dateEnd = new Date(`${date} 23:59:59`);
    const entriesOnThisDay = history.filter((entry) => {
      const entryTime = new Date(entry.changed_at);
      return entryTime >= dateStart && entryTime <= dateEnd;
    });

    const firstChangePerSystem = new Map();

    entriesOnThisDay.forEach((entry) => {
      const existing = firstChangePerSystem.get(entry.service_tag);
      const entryTime = new Date(entry.changed_at);

      if (!existing || entryTime < new Date(existing.changed_at)) {
        firstChangePerSystem.set(entry.service_tag, entry);
      }
    });

    const locationTotals = {};
    [...firstChangePerSystem.values()].forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      if (loc !== "Processed") return; // only care about Processed
      locationTotals[loc] = (locationTotals[loc] || 0) + 1;
    });

    return {
      date: date,
      toLocationCounts: locationTotals,
    };
  });

  const last30Dates = historyByDate.slice(-30);

  // 🔷 Collect all unique locations (including Processed)
  // const allLocations = new Set();
  historyByDate.forEach((day) => {
    Object.keys(day.toLocationCounts).forEach((loc) => allLocations.add(loc));
  });
  historyByDateFirstChange.forEach((day) => {
    Object.keys(day.toLocationCounts).forEach((loc) => allLocations.add(loc));
  });

  // 🔷 Combine both datasets per day
  const chartData = last30Dates.map((day, idx) => {
    const date = day.date; //formatDateMMDDYY(new Date(day.date));
    const processedForDay = historyByDateFirstChange.find(
      (d) => d.date === day.date
    ) || { toLocationCounts: {} };

    const row = {
      date,
      ...day.toLocationCounts,
      ...processedForDay.toLocationCounts, // overwrites "Processed" if present
    };

    allLocations.forEach((loc) => {
      if (!(loc in row)) row[loc] = 0;
    });

    return row;
  });

  const locationKeys = Array.from(allLocations);

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-xl font-semibold mb-4">In vs Out</h2>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis interval={0} allowDecimals={false} />
          <Tooltip />
          {locationKeys.map((loc, idx) => (
            <Line
              key={loc}
              type="monotone"
              dataKey={loc}
              name={loc}
              strokeWidth={2}
              dot={{ r: 3 }}
              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemLocationsChart;
