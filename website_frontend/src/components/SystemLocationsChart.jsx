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
} from "recharts";

function computeActiveLocationsPerDay(
  snapshot,
  history,
  activeLocationNames,
  timezone
) {
  function normalize(entry) {
    return {
      tag: entry.service_tag,
      loc: entry.to_location ?? entry.location ?? null,
      ts: entry.changed_at ?? entry.as_of ?? null,
    };
  }

  const activeState = new Map();

  snapshot.forEach((entry) => {
    const { tag, loc } = normalize(entry);
    if (activeLocationNames.includes(loc)) {
      activeState.set(tag, loc);
    }
  });

  const inactiveTags = new Set();
  const historyByDay = new Map();
  let minDay = null;
  let maxDay = null;

  history.forEach((rawEntry) => {
    const { tag, loc, ts } = normalize(rawEntry);
    if (!ts) return;

    const dt = DateTime.fromISO(ts, { zone: "utc" }).setZone(timezone);
    if (!dt.isValid) return;

    const dayKey = dt.startOf("day").toISODate();

    if (!minDay || dayKey < minDay) minDay = dayKey;
    if (!maxDay || dayKey > maxDay) maxDay = dayKey;

    if (!historyByDay.has(dayKey)) historyByDay.set(dayKey, new Map());
    const tagMap = historyByDay.get(dayKey);

    const existing = tagMap.get(tag);
    if (!existing || DateTime.fromISO(existing.ts) < dt) {
      tagMap.set(tag, { tag, loc, ts });
    }
  });

  if (!minDay || !maxDay) {
    throw new Error("No valid history dates found");
  }

  const snapshotDay = DateTime.fromISO(minDay, { zone: timezone }).minus({
    days: 1,
  });
  const today = DateTime.now().setZone(timezone).startOf("day");

  let endDay = DateTime.fromISO(maxDay, { zone: timezone });
  if (endDay < today) {
    endDay = today; // ensure we cover up to today
  }

  const results = [];

  let currentState = new Map(activeState);

  results.push({
    date: snapshotDay.toISODate(),
    counts: countState(currentState, activeLocationNames),
  });

  let day = snapshotDay.plus({ days: 1 });

  while (day <= endDay) {
    const dayKey = day.toISODate();

    if (historyByDay.has(dayKey)) {
      const changes = historyByDay.get(dayKey);
      for (const { tag, loc } of changes.values()) {
        if (inactiveTags.has(tag)) continue;

        if (!activeLocationNames.includes(loc)) {
          currentState.delete(tag);
          inactiveTags.add(tag);
        } else {
          currentState.set(tag, loc);
        }
      }
    }

    results.push({
      date: dayKey,
      counts: countState(currentState, activeLocationNames),
    });

    day = day.plus({ days: 1 });
  }

  return results;

  function countState(stateMap, allLocations) {
    const counts = {};
    allLocations.forEach((loc) => {
      counts[loc] = 0;
    });
    for (const loc of stateMap.values()) {
      if (counts.hasOwnProperty(loc)) {
        counts[loc]++;
      }
    }
    return counts;
  }
}

function SystemLocationsChart({
  snapshot = [],
  history = [],
  locations,
  activeLocationIDs,
  serverTime,
}) {
  const activeLocationNames = locations
    .filter((loc) => activeLocationIDs.includes(loc.id))
    .map((loc) => loc.name);

  const historyByDay = React.useMemo(() => {
    if (!snapshot.length || !history.length) return null;
    return computeActiveLocationsPerDay(
      snapshot,
      history,
      activeLocationNames,
      serverTime.zone
    );
  }, [snapshot, history, activeLocationNames, serverTime.zone]);

  if (!historyByDay) return <div>No data</div>;

  // Flatten for Recharts
  const chartData = historyByDay.map((day) => {
    const row = { date: DateTime.fromISO(day.date).toFormat("MM/dd/yy") };
    activeLocationNames.forEach((loc) => {
      row[loc] = day.counts[loc] || 0;
    });
    return row;
  });

  const locationKeys = activeLocationNames;

  const CHART_COLORS = ["#1f77b4", "#9467bd", "#ff7f0e", "#2ca02c", "#d62728"];

  return (
    <div className="bg-white shadow rounded p-4">
      <h2 className="text-xl font-semibold mb-4">Active Locations Per Day</h2>
      <ResponsiveContainer width="100%" height={250}>
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
              dot={{ r: 2 }}
              stroke={CHART_COLORS[idx % CHART_COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SystemLocationsChart;
