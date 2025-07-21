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
  console.log("activeLocationNames", activeLocationNames);

  function normalize(entry) {
    return {
      tag: entry.service_tag,
      loc: entry.to_location ?? entry.location ?? null,
      ts: entry.changed_at ?? entry.as_of ?? null,
    };
  }

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

    if (!tagMap.has(tag)) {
      tagMap.set(tag, []);
    }
    tagMap.get(tag).push({ tag, loc, ts });
  });

  if (!minDay || !maxDay) {
    throw new Error("No valid history dates found");
  }

  const snapshotDay = DateTime.fromISO(minDay, { zone: timezone }).minus({
    days: 1,
  });
  const today = DateTime.now().setZone(timezone).startOf("day");

  if (maxDay > today.toISODate()) {
    console.warn(
      `⚠️ maxDay (${maxDay}) is ahead of today (${today.toISODate()}), clamping`
    );
    maxDay = today.toISODate();
  }

  let endDay = DateTime.fromISO(maxDay, { zone: timezone });
  if (endDay < today) {
    endDay = today;
  }

  console.log("📅 snapshotDay:", snapshotDay.toISODate());
  console.log("📅 minDay (first history):", minDay);
  console.log("📅 maxDay (last history):", maxDay);
  console.log("📅 today:", today.toISODate());
  console.log("📅 endDay (inclusive):", endDay.toISODate());

  const results = [];

  let currentState = new Map();

  if (snapshot.length > 0) {
    snapshot.forEach((entry) => {
      const { tag, loc } = normalize(entry);
      if (activeLocationNames.includes(loc)) {
        currentState.set(tag, loc);
      }
    });

    results.push({
      date: snapshotDay.toISODate(),
      counts: countState(currentState, activeLocationNames),
    });
  }

  let day =
    snapshot.length > 0
      ? snapshotDay.plus({ days: 1 })
      : DateTime.fromISO(minDay, { zone: timezone });

  while (day <= endDay) {
    const dayKey = day.toISODate();

    if (historyByDay.has(dayKey)) {
      const changes = historyByDay.get(dayKey);
      for (const events of changes.values()) {
        events.sort((a, b) => DateTime.fromISO(a.ts) - DateTime.fromISO(b.ts));
        for (const { tag, loc } of events) {
          if (!activeLocationNames.includes(loc)) {
            currentState.delete(tag);
          } else {
            currentState.set(tag, loc);
          }
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
    if (!history.length) return null;
    return computeActiveLocationsPerDay(
      snapshot,
      history,
      activeLocationNames,
      serverTime.zone
    );
  }, [snapshot, history, activeLocationNames, serverTime.zone]);

  console.log("chartData", history);
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
