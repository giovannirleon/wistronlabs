import { useEffect, useState } from "react";
import useApi from "../hooks/useApi";

function Footer() {
  const [baseTime, setBaseTime] = useState(null);
  const [secondsElapsed, setSecondsElapsed] = useState(0);
  const { getServerTime } = useApi();

  // Fetch server time once
  useEffect(() => {
    const fetchTime = async () => {
      const response = await getServerTime();
      setBaseTime(response.localtime); // keep the server's string
      setSecondsElapsed(0);
    };
    fetchTime();
  }, []);

  useEffect(() => {
    if (!baseTime) return;

    const interval = setInterval(() => {
      setSecondsElapsed((prev) => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, [baseTime]);

  // Render updated time
  let displayTime = "Loading...";
  if (baseTime) {
    const [datePart, timePart, period] = baseTime.split(/,?\s+/);
    let [month, day, year] = datePart.split("/").map(Number);
    let [hours, minutes, seconds] = timePart.split(":").map(Number);

    if (period === "PM" && hours < 12) hours += 12;
    if (period === "AM" && hours === 12) hours = 0;

    let date = new Date(year, month - 1, day, hours, minutes, seconds);
    date.setSeconds(date.getSeconds() + secondsElapsed);

    const hh = String(date.getHours() % 12 || 12).padStart(2, "0");
    const mm = String(date.getMinutes()).padStart(2, "0");
    const ss = String(date.getSeconds()).padStart(2, "0");
    const ampm = date.getHours() >= 12 ? "PM" : "AM";

    displayTime = `${hh}:${mm}:${ss} ${ampm}`;
  }

  return (
    <footer className="bg-blue-900 text-white px-4 py-2 flex justify-between items-center text-sm h-[40px]">
      <div>
        Server Local Time: <span className="font-mono">{displayTime}</span>
      </div>
      <div>&copy; {new Date().getFullYear()} Wistron</div>
    </footer>
  );
}

export default Footer;
