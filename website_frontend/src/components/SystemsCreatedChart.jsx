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

function SystemsCreatedChart({ systems, history, locations }) {
  const activeLocationNames = locations
    .filter((loc) => [1, 2, 3, 4, 5].includes(loc.id))
    .map((loc) => loc.name.trim().toLowerCase());

  const createdByDay = systems.reduce((acc, sys) => {
    const dateStr = sys.date_created?.split(" ")[0];
    if (!dateStr) return acc;

    // Parse and normalize
    const dateObj = new Date(dateStr);
    if (isNaN(dateObj)) return acc;

    const formatted = formatDateMMDDYY(dateObj);
    acc[formatted] = (acc[formatted] || 0) + 1;
    return acc;
  }, {});

  const inactiveByDay = history.reduce((acc, entry) => {
    const dateStr = entry.changed_at?.split(" ")[0];
    if (!dateStr) return acc;

    const dateObj = new Date(dateStr);
    if (isNaN(dateObj)) return acc;

    const formatted = formatDateMMDDYY(dateObj);

    const toLoc = entry.to_location?.trim().toLowerCase();
    const isActive = activeLocationNames.includes(toLoc);

    if (!isActive) {
      acc[formatted] = (acc[formatted] || 0) + 1;
    }

    return acc;
  }, {});

  const allDates = new Set([
    ...Object.keys(createdByDay),
    ...Object.keys(inactiveByDay),
  ]);

  const sortedDates = Array.from(allDates).sort(
    (a, b) => new Date(a) - new Date(b)
  );

  const last30Dates = sortedDates.slice(-30);

  const chartData = last30Dates.map((date) => ({
    date,
    created: createdByDay[date] || 0,
    inactive: inactiveByDay[date] || 0,
  }));

  return (
    <div className="bg-white shadow rounded p-4 mt-5">
      <h2 className="text-xl font-semibold mb-4">In vs Out</h2>

      <ResponsiveContainer width="100%" height={200}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis interval={0} allowDecimals={false} />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="inactive"
            name="Resolved"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemsCreatedChart;
