import React, { useEffect, useState } from "react";
import { Routes, Route } from "react-router-dom";

import PaginatedItems from "./components/Paginate";

import HomePage from "./pages/HomePage";
import TrackingPage from "./pages/TrackingPage";
import SystemPage from "./pages/SystemPage";
import Header from "./components/Header";

function App() {
  const [stations, setStations] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [sortBy, setSortBy] = useState("date"); // default sort by name
  const [sortAsc, setSortAsc] = useState(true);

  useEffect(() => {
    // fetch stations every 10s
    const fetchStations = async () => {
      try {
        const res = await fetch("/station_status.json?" + Date.now());
        const data = await res.json();
        setStations(data);
      } catch (err) {
        console.error("Failed to fetch stations:", err);
      }
    };
    fetchStations();
    const interval = setInterval(fetchStations, 10000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // fetch downloads once
    const fetchDownloads = async () => {
      try {
        const link = "http://192.168.2.132/l10_logs/"; //is "/l10_logs/"
        const res = await fetch(link);
        const text = await res.text();
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(text, "text/html");
        const rows = htmlDoc.querySelectorAll("tr");
        const entries = [];
        rows.forEach((row, rowIndex) => {
          if (rowIndex >= 3 && rowIndex < rows.length - 1) {
            let rawDate = "";
            let name = "";
            let href = "";
            const cols = row.querySelectorAll("td");
            cols.forEach((col, colIndex) => {
              // get folder name and href
              if (colIndex == 1) {
                name = Array.from(col.querySelectorAll("a"))[0]
                  .textContent.trim()
                  .replace(/\/$/, "");
                href = Array.from(col.querySelectorAll("a"))[0].getAttribute(
                  "href"
                );
              }

              // get raw date data
              if (colIndex == 2) {
                rawDate = col.textContent.trim();
              }
            });

            // foramt date to human readable
            const utcISO = rawDate.replace(" ", "T") + ":00Z";
            const date = new Date(utcISO);

            // Step 2: Extract local parts
            const month = String(date.getMonth() + 1).padStart(2, "0");
            const day = String(date.getDate()).padStart(2, "0");
            const year = date.getFullYear();

            let hours = date.getHours();
            const minutes = String(date.getMinutes()).padStart(2, "0");
            const seconds = String(date.getSeconds()).padStart(2, "0");
            const ampm = hours >= 12 ? "PM" : "AM";

            hours = hours % 12;
            hours = hours === 0 ? 12 : hours;
            const hoursStr = String(hours).padStart(2, "0");

            const formattedDate = `${month}/${day}/${year}, ${hoursStr}:${minutes}:${seconds} ${ampm}`;

            //push entry
            entries.push({ name, href: link + href, date: formattedDate });
          }
        });
        setDownloads(entries);
      } catch (err) {
        console.error("Failed to fetch downloads:", err);
      }
    };
    fetchDownloads();
  }, []);

  return (
    <div className="bg-gray-100 min-h-screen text-gray-800 font-roboto">
      <Header />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/tracking" element={<TrackingPage />} />
        <Route path="/:serviceTag" element={<SystemPage />} />
      </Routes>
    </div>
  );
}

export default App;
