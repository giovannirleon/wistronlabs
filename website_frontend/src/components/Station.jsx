import React, { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { DateTime } from "luxon";

const PROGRESS_WINDOW_MIN = 100; // how long until the bar reaches 100%

function Station({
  stationInfo,
  link = false,
  progressWindowMin = PROGRESS_WINDOW_MIN,
}) {
  const [now, setNow] = useState(DateTime.now());

  // Tick every 30s so the bar/tooltip update without page reloads
  useEffect(() => {
    const t = setInterval(() => setNow(DateTime.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const lastUpdatedISO = stationInfo?.last_updated;
  const then = useMemo(
    () => (lastUpdatedISO ? DateTime.fromISO(lastUpdatedISO) : null),
    [lastUpdatedISO]
  );

  const diff = useMemo(() => {
    if (!then) return null;
    return now.diff(then, ["days", "hours", "minutes", "seconds"]);
  }, [now, then]);

  // Exact minutes since last update (fractional)
  const minutesSince = useMemo(() => {
    if (!then) return 0;
    return now.diff(then, "minutes").minutes; // float
  }, [now, then]);

  // Map elapsed minutes to a 0-100% progress, clamped
  const progressPct = useMemo(() => {
    const pct = (minutesSince / progressWindowMin) * 100;
    return Math.max(0, Math.min(100, pct));
  }, [minutesSince, progressWindowMin]);

  const humanAgo = useMemo(() => {
    if (!diff) return "";
    const d = Math.floor(diff.days);
    const h = Math.floor(diff.hours);
    const m = Math.floor(diff.minutes);
    if (d > 0) return `${d} day${d > 1 ? "s" : ""} ago`;
    if (h > 0) return `${h} hour${h > 1 ? "s" : ""} ago`;
    if (m > 0) return `${m} minute${m > 1 ? "s" : ""} ago`;
    return "just now";
  }, [diff]);

  const tooltip =
    stationInfo.status === 1 && then
      ? `${progressPct.toFixed(1)}% • updated ${humanAgo}`
      : undefined;

  const renderStatus = (status, message) => {
    const base =
      "relative inline-flex items-center justify-center min-w-24 px-2 py-1 rounded-md md:rounded-full text-xs font-medium text-center";
    if (status === 0)
      return (
        <span
          className={`${base} bg-yellow-100 text-yellow-800`}
          title={tooltip}
        >
          {message}
        </span>
      );

    if (status === 1) {
      // “loading bar” background with status text on top
      return (
        <span
          className={`${base} bg-green-100 text-green-900 overflow-hidden cursor-default select-none`}
          title={tooltip}
          aria-label={`In progress: ${progressPct.toFixed(0)} percent`}
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          {/* progress fill */}
          <span
            className="absolute left-0 top-0 h-full bg-green-300/70"
            style={{
              width: `${progressPct}%`,
              transition: "width 0.6s linear",
            }}
            aria-hidden="true"
          />
          {/* text stays readable above the fill */}
          <span className="relative z-10">{message}</span>
        </span>
      );
    }

    return (
      <span className={`${base} bg-red-100 text-red-800`} title={tooltip}>
        {message}
      </span>
    );
  };

  return (
    <tr key={stationInfo.station}>
      <td className="p-3 border-b border-gray-200 text-left">
        Station {stationInfo.station_name}
      </td>

      <td className="p-3 border-b border-gray-200 text-center">
        {renderStatus(stationInfo.status, stationInfo.message)}
      </td>

      <td className="p-3 border-b border-gray-200 text-right">
        {stationInfo.system_service_tag === null ? (
          <p className="text-gray-800 text-right">Available</p>
        ) : link ? (
          <Link
            to={`/${stationInfo.system_service_tag}`}
            className="text-blue-600 hover:underline text-right"
          >
            {stationInfo.system_service_tag}
          </Link>
        ) : (
          <p className="text-gray-500 text-right">
            {stationInfo.system_service_tag}
          </p>
        )}
      </td>
    </tr>
  );
}

export default Station;
