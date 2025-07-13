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

function SystemLocationsChart({ history }) {
  const EXCLUDED_LOCATIONS = ["Sent to L11", "RMA VID", "RMA PID", "RMA CID"];
  const CHART_COLORS = ["#1f77b4", "#9467bd", "#ff7f0e", "#2ca02c", "#d62728"];

  const fullDateRange = getLastNDates(7);

  const allLocations = new Set();

  // Precompute latest-by-service_tag
  const latestByServiceTag = new Map();

  history
    .slice()
    .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
    .forEach((entry) => {
      latestByServiceTag.set(entry.service_tag, entry);
    });

  const chartData = [];
  let previousCounts = {};

  fullDateRange.forEach((date) => {
    const dateEnd = new Date(`${date} 23:59:59`);

    // Recompute latest as of this date
    const latestForDay = new Map();

    history.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);
      if (entryTime <= dateEnd) {
        const existing = latestForDay.get(entry.service_tag);
        if (!existing || entryTime > new Date(existing.changed_at)) {
          latestForDay.set(entry.service_tag, entry);
        }
      }
    });

    const countsForDay = {};
    latestForDay.forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      if (EXCLUDED_LOCATIONS.includes(loc)) return;
      countsForDay[loc] = (countsForDay[loc] || 0) + 1;
      allLocations.add(loc);
    });

    // If no counts for today, use previous day’s
    const finalCounts =
      Object.keys(countsForDay).length > 0
        ? countsForDay
        : { ...previousCounts };

    chartData.push({
      date,
      ...Object.fromEntries(
        Array.from(allLocations).map((loc) => [loc, finalCounts[loc] || 0])
      ),
    });

    previousCounts = finalCounts;
  });

  const locationKeys = Array.from(allLocations);

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-xl font-semibold mb-4">Active Locations Per Day</h2>

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
