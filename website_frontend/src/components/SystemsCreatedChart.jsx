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

function SystemsCreatedChart({ systems, history, locations }) {
  // find active locations by name
  const activeLocationNames = locations
    .filter((loc) => [1, 2, 3, 4, 5].includes(loc.id))
    .map((loc) => loc.name);

  const createdByDay = systems.reduce((acc, sys) => {
    const dateStr = sys.date_created?.split(" ")[0]; // MM/DD/YYYY
    if (!dateStr) return acc;

    const [month, day, year] = dateStr.split("/");
    const normalized = `${year}-${month.padStart(2, "0")}-${day.padStart(
      2,
      "0"
    )}`;

    acc[normalized] = (acc[normalized] || 0) + 1;
    return acc;
  }, {});

  const inactiveByDay = history.reduce((acc, entry) => {
    const dateStr = entry.changed_at?.split("T")[0];
    if (!dateStr) return acc;

    const toLoc = entry.to_location?.trim().toLowerCase();

    const isActive = activeLocationNames.some(
      (active) => active.trim().toLowerCase() === toLoc
    );

    if (!isActive) {
      acc[dateStr] = (acc[dateStr] || 0) + 1;
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

  // get only the last 30 dates
  const last30Dates = sortedDates.slice(-30);

  const chartData = last30Dates.map((date) => ({
    date,
    created: createdByDay[date] || 0,
    inactive: inactiveByDay[date] || 0,
  }));

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-xl font-semibold mb-4">Systems Created Per Day</h2>

      <ResponsiveContainer width="100%" height={300}>
        <LineChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis
            interval={0} // 👈 show every tick
            allowDecimals={false} // 👈 integers only
          />
          <Tooltip />
          <Line
            type="monotone"
            dataKey="created"
            name="Created"
            stroke="#3b82f6"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="inactive"
            name="Moved to Inactive"
            stroke="#ef4444"
            strokeWidth={2}
            dot={{ r: 4 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemsCreatedChart;
