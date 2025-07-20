import React, { useState, useEffect } from "react";

import { DateTime } from "luxon";

import toZuluIso from "../utils/toZuluISO.js";
import formatDateYYYYMMDD from "../utils/formatYYYYMMDD.js";
import useApi from "../hooks/useApi.jsx";

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

function SystemLocationsChart({
  fetchHistory,
  fetchSystems,
  locations,
  serverTime,
}) {
  const days = 7;

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const [data, setData] = useState();

  const { getSnapshot } = useApi();

  useEffect(() => {
    const loadActiveHistory = async () => {
      setLoading(true);

      try {
        //get active location data
        const activeLocationIDs = [1, 2, 3, 4, 5];
        const activeLocationNames = locations
          .filter((loc) => activeLocationIDs.includes(loc.id))
          .map((loc) => loc.name);

        // get server time and date (shows as "07/19/2025, 06:05:18 PM")
        const snapshotDate = new Date(serverTime.localtime);
        const historyBeginningDate = new Date(serverTime.localtime);

        // sets the snapshotDate to 7 days prior at EOD (in the servers local time)
        snapshotDate.setDate(snapshotDate.getDate() - (days - 1));

        // sets the snapshotDate to 7 days prior at EOD (in the servers local time)
        historyBeginningDate.setDate(
          historyBeginningDate.getDate() - (days - 2)
        );

        //need to get Zulu ISO datetime since that is what the backend /systems/history takes
        // server local time also includes a UTC offset which is a number
        const snapshotDateZISO = toZuluIso(
          formatDateYYYYMMDD(snapshotDate),
          "23:59:59",
          serverTime.utcOffset
        );

        const historyBeginningDateZISO = toZuluIso(
          formatDateYYYYMMDD(historyBeginningDate),
          "00:00:00",
          serverTime.utcOffset
        );

        console.log("server local time", serverTime);
        console.log("snapshotDate", snapshotDate);
        console.log("historyBeginningDate", historyBeginningDate);

        console.log("snapshotDateZISO", snapshotDateZISO);
        console.log("historyBeginningDateZISO", historyBeginningDateZISO);
        //console.log(beginningDateZISO);
        // const activeLocationSnapshotFirstDay = await getSnapshot({
        //   date: beginningDate,
        //   locations: activeLocationNames,
        // });

        // console.log(activeLocationSnapshotFirstDay);

        // const { data: historyFromActiveLocations } = await fetchHistory({
        //   all: true,
        //   filters: {
        //     op: "AND",
        //     conditions: [
        //       { field: "changed_at", values: [beginningDateZISO], op: ">=" },
        //     ],
        //   },
        // });
        // console.log("historyFromActiveLocations", historyFromActiveLocations);
      } catch (err) {
        console.error("Failed to fetch history:", err);
        setError("Failed to load history.");
      }
    };

    loadActiveHistory();
    setLoading(false);
  }, [fetchSystems]);

  // /console.log("data", data);
  return <div>TEST</div>;
  // useEffect(() => {
  //   if (!loading) setDisplayedData(data);
  // }, [loading, data]);
  // const EXCLUDED_LOCATIONS = ["Sent to L11", "RMA VID", "RMA PID", "RMA CID"];
  // const CHART_COLORS = ["#1f77b4", "#9467bd", "#ff7f0e", "#2ca02c", "#d62728"];
  // const fullDateRange = getLastNDates(7);
  // const allLocations = new Set();
  // // Precompute latest-by-service_tag
  // const latestByServiceTag = new Map();
  // history
  //   .slice()
  //   .sort((a, b) => new Date(a.changed_at) - new Date(b.changed_at))
  //   .forEach((entry) => {
  //     latestByServiceTag.set(entry.service_tag, entry);
  //   });
  // const chartData = [];
  // let previousCounts = {};
  // fullDateRange.forEach((date) => {
  //   const dateEnd = new Date(`${date} 23:59:59`);
  //   // Recompute latest as of this date
  //   const latestForDay = new Map();
  //   history.forEach((entry) => {
  //     const entryTime = new Date(entry.changed_at);
  //     if (entryTime <= dateEnd) {
  //       const existing = latestForDay.get(entry.service_tag);
  //       if (!existing || entryTime > new Date(existing.changed_at)) {
  //         latestForDay.set(entry.service_tag, entry);
  //       }
  //     }
  //   });
  //   const countsForDay = {};
  //   latestForDay.forEach((entry) => {
  //     const loc = entry.to_location?.trim() || "Unknown";
  //     if (EXCLUDED_LOCATIONS.includes(loc)) return;
  //     countsForDay[loc] = (countsForDay[loc] || 0) + 1;
  //     allLocations.add(loc);
  //   });
  //   // If no counts for today, use previous day’s
  //   const finalCounts =
  //     Object.keys(countsForDay).length > 0
  //       ? countsForDay
  //       : { ...previousCounts };
  //   chartData.push({
  //     date,
  //     ...Object.fromEntries(
  //       Array.from(allLocations).map((loc) => [loc, finalCounts[loc] || 0])
  //     ),
  //   });
  //   previousCounts = finalCounts;
  // });
  // const locationKeys = Array.from(allLocations);
  // return (
  //   <div className="bg-white shadow rounded p-4">
  //     <h2 className="text-xl font-semibold mb-4">Active Locations Per Day</h2>
  //     <ResponsiveContainer width="100%" height={200}>
  //       <LineChart data={chartData}>
  //         <CartesianGrid strokeDasharray="3 3" />
  //         <XAxis dataKey="date" tick={{ fontSize: 12 }} />
  //         <YAxis interval={0} allowDecimals={false} />
  //         <Tooltip />
  //         {locationKeys.map((loc, idx) => (
  //           <Line
  //             key={loc}
  //             type="monotone"
  //             dataKey={loc}
  //             name={loc}
  //             strokeWidth={2}
  //             dot={{ r: 3 }}
  //             stroke={CHART_COLORS[idx % CHART_COLORS.length]}
  //           />
  //         ))}
  //       </LineChart>
  //     </ResponsiveContainer>
  //   </div>
  // );
}

export default SystemLocationsChart;
