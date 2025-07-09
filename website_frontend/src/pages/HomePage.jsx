import React, { useEffect, useState } from "react";
import PaginatedItems from "../components/Paginate";
import SearchContainer from "../components/SearchContainer";

import Rack from "../components/Rack";
import Table from "../components/Table";

function HomePage() {
  const [stations, setStations] = useState([]);
  const [downloads, setDownloads] = useState([]);

  useEffect(() => {
    // fetch stations every 1s
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
    const interval = setInterval(fetchStations, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // fetch downloads once
    const fetchDownloads = async () => {
      try {
        const link =
          import.meta.env.MODE === "development"
            ? "http://html.tss.wistronlabs.com/l10_logs/" // is "/l10_logs/" in development
            : "/10_logs/"; // is "/l10_logs/" in production
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
    <>
      {/* Station Status */}
      <main className="max-w-[1000px] mx-auto mt-8 bg-white rounded shadow-md p-4">
        <h1 className="text-2xl font-semibold mb-6">Station Status</h1>

        <div className="flex flex-col md:flex-row justify-between gap-8 mt-8 w-full">
          {/* Left Column */}
          <div className="flex flex-col w-full">
            <Table
              stations={stations}
              stationNumbers={[1, 2]}
              tableNumber={1}
            />
            <Table
              stations={stations}
              stationNumbers={[3, 4]}
              tableNumber={2}
            />
          </div>

          {/* Right Column */}
          <div className="flex flex-col w-full">
            <Rack stations={stations} rackNumber={1} />
          </div>
        </div>
      </main>

      {/* Available Downloads */}
      <section className="max-w-[1000px] mx-auto mt-8 bg-white rounded shadow-md p-4">
        {console.log("Downloads:", downloads)}
        <SearchContainer data={downloads} title={"Avialable Logs"} />
      </section>
    </>
  );
}

export default HomePage;
