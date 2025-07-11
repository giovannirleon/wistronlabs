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
  const historyDates = [
    ...new Set(
      history.map((entry) => {
        const dateStr = formatDateMMDDYY(new Date(entry.changed_at));
        return dateStr;
      })
    ),
  ];

  historyDates.sort((a, b) => new Date(a) - new Date(b));

  const historyByDate = historyDates.map((date) => {
    const compDateEndTime = new Date(date); // start of day
    const compDateStartTime = new Date(date + " 23:59:59"); // end of day

    // ✅ Include all history up to and including this day
    const entriesForDate = history.filter((entry) => {
      const entryTime = new Date(entry.changed_at);
      return entryTime <= compDateStartTime;
    });

    // 🔷 For each service_tag, keep latest change up to this date
    const latestByServiceTag = new Map();

    entriesForDate.forEach((entry) => {
      const tag = entry.service_tag;
      const entryTime = new Date(entry.changed_at);

      if (!latestByServiceTag.has(tag)) {
        latestByServiceTag.set(tag, entry);
      } else {
        const existingEntry = latestByServiceTag.get(tag);
        const existingTime = new Date(existingEntry.changed_at);

        if (entryTime > existingTime) {
          latestByServiceTag.set(tag, entry);
        }
      }
    });

    const latestEntries = Array.from(latestByServiceTag.values());

    // Count how many at each to_location
    const toLocationCounts = {};
    latestEntries.forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      toLocationCounts[loc] = (toLocationCounts[loc] || 0) + 1;
    });

    return {
      date,
      toLocationCounts,
    };
  });

  const stHistoryByDate = historyDates.map((date) => {
    const compDateEndTime = new Date(date);
    const compDateStartTime = new Date(date + " 23:59:59");

    // Include all history up to and including this day
    const entriesForDate = history.filter((entry) => {
      const entryTime = new Date(entry.changed_at);
      return entryTime <= compDateStartTime;
    });

    // For each service_tag, keep latest change up to this date
    const latestByServiceTag = new Map();

    entriesForDate.forEach((entry) => {
      const tag = entry.service_tag;
      const entryTime = new Date(entry.changed_at);

      if (!latestByServiceTag.has(tag)) {
        latestByServiceTag.set(tag, entry);
      } else {
        const existingEntry = latestByServiceTag.get(tag);
        const existingTime = new Date(existingEntry.changed_at);

        if (entryTime > existingTime) {
          latestByServiceTag.set(tag, entry);
        }
      }
    });

    // 🔷 Build snapshot array
    const snapshot = Array.from(latestByServiceTag.values()).map((entry) => ({
      service_tag: entry.service_tag,
      location: entry.to_location?.trim() || "Unknown",
      last_note: entry.note || "Unknown",
    }));

    return {
      date,
      snapshot,
    };
  });

  console.log(stHistoryByDate);
  const last30Dates = historyByDate.slice(-30);

  const chartData = last30Dates.map((day) => {
    const counts = {};
    (day.entries || []).forEach((entry) => {
      const loc = entry.to_location?.trim() || "Unknown";
      counts[loc] = (counts[loc] || 0) + 1;
    });

    return {
      date: day.date,
      ...day.toLocationCounts,
    };
  });

  const allLocations = new Set();

  chartData.forEach((row) => {
    Object.keys(row).forEach((key) => {
      if (key !== "date") allLocations.add(key);
    });
  });

  const locationKeys = Array.from(allLocations);

  console.log("Chart Data:", chartData);

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-xl font-semibold mb-4">Locations Per Day</h2>

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
              stroke={`hsl(${(idx * 40) % 360}, 70%, 50%)`}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemLocationsChart;
