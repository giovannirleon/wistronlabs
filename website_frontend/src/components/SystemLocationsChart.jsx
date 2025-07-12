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

// Helper to format Date → MM/DD/YY
function formatDateMMDDYY(date) {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const yy = String(date.getFullYear()).slice(-2);
  return `${mm}/${dd}/${yy}`;
}

function SystemLocationsChart({ history }) {
  const EXCLUDED_LOCATIONS = ["Sent to L11", "RMA VID", "RMA PID", "RMA CID"];
  const CHART_COLORS = [
    "#1f77b4", // blue
    "#9467bd", // purple
    "#ff7f0e", // orange
    "#2ca02c", // green
    "#d62728", // red
  ];

  // Build a sorted list of unique dates in history
  const historyDates = [
    ...new Set(
      history.map((entry) => {
        const dateStr = formatDateMMDDYY(new Date(entry.changed_at));
        return dateStr;
      })
    ),
  ].sort((a, b) => new Date(a) - new Date(b));

  // Build cumulative history by date
  const historyByDate = historyDates.map((date) => {
    const dateEnd = new Date(`${date} 23:59:59`);

    const latestByServiceTag = new Map();

    history.forEach((entry) => {
      const entryTime = new Date(entry.changed_at);

      if (entryTime <= dateEnd) {
        const existing = latestByServiceTag.get(entry.service_tag);
        if (!existing || entryTime > new Date(existing.changed_at)) {
          latestByServiceTag.set(entry.service_tag, entry);
        }
      }
    });

    const toLocationCounts = {};
    Array.from(latestByServiceTag.values()).forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      if (EXCLUDED_LOCATIONS.includes(loc)) return;
      toLocationCounts[loc] = (toLocationCounts[loc] || 0) + 1;
    });

    return {
      date,
      toLocationCounts,
    };
  });

  const last30Dates = historyByDate.slice(-30);

  // Collect all unique locations
  const allLocations = new Set();
  historyByDate.forEach((day) => {
    Object.keys(day.toLocationCounts).forEach((loc) => {
      allLocations.add(loc);
    });
  });

  // Build chart data
  const chartData = last30Dates.map((day) => {
    const row = { date: day.date, ...day.toLocationCounts };

    // Ensure all known locations are present with at least 0
    allLocations.forEach((loc) => {
      if (!(loc in row)) {
        row[loc] = 0;
      }
    });

    return row;
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
