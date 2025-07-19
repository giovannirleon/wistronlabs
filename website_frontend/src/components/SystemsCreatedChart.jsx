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

function getLastNDates(n) {
  const dates = [];
  const today = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(formatDateMMDDYY(d));
  }
  return dates;
}

function SystemsCreatedChart({ history }) {
  const EXCLUDED_LOCATIONS_EOD = [
    "Pending Parts",
    "In Debug - Wistron",
    "In Debug - Nvidia",
    "In L10",
  ];

  const CHART_COLORS = ["#e63946", "#1f77b4", "#4e9dd3", "#145a86", "#6ca0dc"];

  const KNOWN_LOCATIONS = ["Processed", "RMA PID", "RMA CID", "RMA VID"];
  const allLocations = new Set(KNOWN_LOCATIONS);

  const fullDateRange = getLastNDates(7);

  const historyByDateMap = new Map();
  const historyByDateFirstChangeMap = new Map();

  fullDateRange.forEach((date) => {
    const dateStart = new Date(`${date} 00:00:00`);
    const dateEnd = new Date(`${date} 23:59:59`);

    const latestByTag = new Map();
    const firstChangeByTag = new Map();

    history.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);
      if (entryTime >= dateStart && entryTime <= dateEnd) {
        const existingLatest = latestByTag.get(entry.service_tag);
        const existingFirst = firstChangeByTag.get(entry.service_tag);

        if (
          !existingLatest ||
          entryTime > new Date(existingLatest.changed_at)
        ) {
          latestByTag.set(entry.service_tag, entry);
        }

        if (!existingFirst || entryTime < new Date(existingFirst.changed_at)) {
          firstChangeByTag.set(entry.service_tag, entry);
        }
      }
    });

    const latestCounts = {};
    [...latestByTag.values()].forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      if (loc === "Processed") return;
      if (EXCLUDED_LOCATIONS_EOD.includes(loc)) return;
      latestCounts[loc] = (latestCounts[loc] || 0) + 1;
    });

    const processedCounts = {};
    [...firstChangeByTag.values()].forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      if (loc !== "Processed") return;
      processedCounts[loc] = (processedCounts[loc] || 0) + 1;
    });

    historyByDateMap.set(date, latestCounts);
    historyByDateFirstChangeMap.set(date, processedCounts);

    Object.keys(latestCounts).forEach((loc) => allLocations.add(loc));
    Object.keys(processedCounts).forEach((loc) => allLocations.add(loc));
  });

  const last7Dates = fullDateRange.map((date) => {
    const latestForDay = historyByDateMap.get(date) || {};
    const processedForDay = historyByDateFirstChangeMap.get(date) || {};

    const combinedCounts = {};

    allLocations.forEach((loc) => {
      combinedCounts[loc] = latestForDay[loc] || processedForDay[loc] || 0;
    });

    return {
      date,
      toLocationCounts: combinedCounts,
    };
  });

  const chartData = last7Dates.map((day) => {
    const row = { date: day.date };
    allLocations.forEach((loc) => {
      row[loc] = day.toLocationCounts[loc];
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

export default SystemsCreatedChart;
