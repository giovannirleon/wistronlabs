import React, { useMemo } from "react";

import { DateTime } from "luxon";

import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
} from "recharts";

function computeInOutCountsPerDay(
  history,
  activeLocationNames,
  timezone,
  locationID1Name
) {
  const dayMap = new Map();

  history.forEach((entry) => {
    const dt = DateTime.fromISO(entry.changed_at, { zone: "utc" }).setZone(
      timezone
    );
    if (!dt.isValid) return;

    const dayKey = dt.startOf("day").toISODate();
    if (!dayMap.has(dayKey)) dayMap.set(dayKey, []);
    dayMap.get(dayKey).push(entry);
  });

  const allDays = Array.from(dayMap.keys()).sort();
  if (allDays.length === 0) return [];

  const firstDay = DateTime.fromISO(allDays[0], { zone: timezone }).startOf(
    "day"
  );
  const today = DateTime.now().setZone(timezone).startOf("day");

  const results = [];

  let day = firstDay;

  while (day <= today) {
    const dayKey = day.toISODate();
    const entries = dayMap.get(dayKey) || [];

    const firsts = new Map();
    const lasts = new Map();

    entries.sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at));

    for (const e of entries) {
      const tag = e.service_tag;
      const toLoc = e.to_location;

      if (!firsts.has(tag)) firsts.set(tag, toLoc);
      lasts.set(tag, toLoc);
    }

    let location1Firsts = 0;
    const inactiveLasts = {};

    for (const [tag, loc] of firsts.entries()) {
      if (loc === locationID1Name) location1Firsts++;
    }

    for (const [tag, loc] of lasts.entries()) {
      if (!activeLocationNames.includes(loc)) {
        inactiveLasts[loc] = (inactiveLasts[loc] || 0) + 1;
      }
    }

    results.push({
      date: day.toFormat("MM/dd/yy"),
      location1Firsts,
      inactiveLasts,
    });

    day = day.plus({ days: 1 });
  }

  return results;
}

function SystemInOutChart({
  history,
  locations,
  activeLocationIDs,
  serverTime,
}) {
  const activeLocationNames = locations
    .filter((loc) => activeLocationIDs.includes(loc.id))
    .map((loc) => loc.name);

  const locationID1Name = locations.find((loc) => loc.id === 1)?.name;

  const inOutCounts = useMemo(() => {
    if (!history.length) return null;
    return computeInOutCountsPerDay(
      history,
      activeLocationNames,
      serverTime.zone,
      locationID1Name
    );
  }, [history, activeLocationNames, serverTime.zone]);

  // get all unique inactive locations from results
  const allInactiveLocations = new Set();
  inOutCounts.forEach((day) => {
    Object.keys(day.inactiveLasts).forEach((loc) =>
      allInactiveLocations.add(loc)
    );
  });

  const chartData = inOutCounts.map((day) => {
    const row = { date: day.date, location1Firsts: day.location1Firsts };
    let totalResolved = 0;

    allInactiveLocations.forEach((loc) => {
      const count = day.inactiveLasts[loc] || 0;
      row[loc] = count;
      totalResolved += count;
    });

    row.TotalResolved = totalResolved;
    return row;
  });

  const ACTIVE_COLOR = "#e63946"; // red
  const INACTIVE_COLORS = [
    "#1f77b4", // blue
    "#2ca02c", // green
    "#ff7f0e", // orange
    "#9467bd", // purple
    "#8c564b", // brown
    "#17becf", // cyan
    "#e377c2", // pink
    "#bcbd22", // olive
  ];

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-xl font-semibold mb-4">Daily Movements</h2>
      <ResponsiveContainer width="100%" height={250}>
        <AreaChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="date" tick={{ fontSize: 12 }} />
          <YAxis interval={0} allowDecimals={false} />
          <Tooltip />

          {/* stacked inactive areas */}
          {Array.from(allInactiveLocations).map((loc, idx) => (
            <Area
              key={loc}
              type="monotone"
              dataKey={loc}
              name={loc}
              stroke={INACTIVE_COLORS[idx % INACTIVE_COLORS.length]}
              fill={INACTIVE_COLORS[idx % INACTIVE_COLORS.length]}
              stackId="1"
              isAnimationActive={false}
            />
          ))}

          {/* Location 1 as a line */}
          <Line
            type="monotone"
            dataKey="location1Firsts"
            name={locationID1Name}
            stroke={ACTIVE_COLOR}
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />

          {/* Total Received as a line */}
          <Line
            type="monotone"
            dataKey="TotalResolved"
            name="Total Resolved"
            stroke="#000000"
            strokeDasharray="4 2"
            strokeWidth={2}
            dot={{ r: 2 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemInOutChart;
