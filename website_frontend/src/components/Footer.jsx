import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import useApi from "../hooks/useApi";

function Footer() {
  const { getServerTime } = useApi();
  const [serverZone, setServerZone] = useState(null);
  const [tick, setTick] = useState(0); // increments every second

  // 1) Get server timezone once
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await getServerTime(); // expect { zone: "America/Chicago", localtime: "..." }
        if (!alive) return;
        setServerZone(res?.zone || "UTC");
      } catch {
        // Fallback to client's zone if API fails
        setServerZone(
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [getServerTime]);

  // 2) Tick every second
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 1e9), 1000);
    return () => clearInterval(id);
  }, []);

  // 3) Compute display time from client's UTC -> server zone
  const displayTime = useMemo(() => {
    if (!serverZone) return "Loading...";
    // Use client's current UTC time, then convert to the server zone
    const dt = DateTime.utc().setZone(serverZone);
    return dt.toFormat("hh:mm:ss a"); // e.g., 07:12:04 PM
  }, [serverZone, tick]);

  return (
    <footer className="bg-blue-900 text-white px-4 py-2 flex justify-between items-center text-sm h-[40px]">
      <div>
        Server Local Time
        {serverZone ? ` (${serverZone})` : ""}:{" "}
        <span className="font-mono">{displayTime}</span>
      </div>
      <div>&copy; {new Date().getFullYear()} Wistron</div>
    </footer>
  );
}

export default Footer;
