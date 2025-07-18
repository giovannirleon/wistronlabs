import React, { useEffect, useState } from "react";
import PaginatedItems from './components/Paginate'

import Header from "./components/Header"
import Rack from "./components/Rack";
import Table from "./components/Table"

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
        const link = "http://192.168.2.132/l10_logs/" //is "/l10_logs/"
        const res = await fetch(link);
        const text = await res.text();
        const parser = new DOMParser();
        const htmlDoc = parser.parseFromString(text, "text/html");
        const rows = htmlDoc.querySelectorAll("tr");
        const entries = [];
        rows.forEach((row, rowIndex) => {
          if (rowIndex >= 3 && rowIndex < rows.length - 1) {
            let rawDate = "";
            let name = ""
            let href = ""
            const cols = row.querySelectorAll("td")
            cols.forEach((col, colIndex) => {

              // get folder name and href
              if (colIndex == 1) {
                name = Array.from(col.querySelectorAll("a"))[0].textContent.trim().replace(/\/$/, '');
                href = Array.from(col.querySelectorAll("a"))[0].getAttribute("href");
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
      {/* Station Status */}
      <main className="max-w-[1000px] mx-auto mt-8 bg-white rounded shadow-md p-4">
        <h1 className="text-2xl font-semibold mb-6">Station Status</h1>

        <div className="flex flex-col md:flex-row justify-between gap-8 mt-8 w-full">
          {/* Left Column */}
          <div className="flex flex-col w-full">
            <Table stations={stations} stationNumbers={[1, 2]} tableNumber={1} />
            <Table stations={stations} stationNumbers={[3, 4]} tableNumber={2} />
          </div>

          {/* Right Column */}
          <div className="flex flex-col w-full">
            <Rack stations={stations} rackNumber={1} />
          </div>
        </div>
      </main>

      {/* Available Downloads */}
      <section className="max-w-[1000px] mx-auto mt-8 bg-white rounded shadow-md p-4">
        <h1 className="text-2xl font-semibold mb-6">Available Downloads</h1>
        <div className="flex flex-col p-4 bg-gray-100 rounded border border-gray-300 shadow-sm mt-4 space-y-2">
          {downloads.length === 0 ? (
            <p className="text-sm text-gray-500">No downloads available</p>
          ) : (
            <div>
              <div className="flex justify-between items-center bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 mb-2">
                <button
                  className="text-gray-500 text-sm"
                  onClick={() => {
                    if (sortBy === "name") {
                      setSortAsc(!sortAsc);
                    } else {
                      setSortBy("name");
                      setSortAsc(true);
                    }
                  }}
                >
                  File Name {sortBy === "name" && (sortAsc ? "▲" : "▼")}
                </button>
                <button
                  className="text-gray-500 text-sm"
                  onClick={() => {
                    if (sortBy === "date") {
                      setSortAsc(!sortAsc);
                    } else {
                      setSortBy("date");
                      setSortAsc(true);
                    }
                  }}
                >
                  Date Modified {sortBy === "date" && (sortAsc ? "▲" : "▼")}
                </button>
              </div>
              <PaginatedItems itemsPerPage={10} items={downloads
                .slice() // create copy before sort
                .sort((a, b) => {
                  if (sortBy === "name") {
                    return sortAsc
                      ? a.name.localeCompare(b.name)
                      : b.name.localeCompare(a.name);
                  } else {
                    return sortAsc
                      ? new Date(a.date) - new Date(b.date)
                      : new Date(b.date) - new Date(a.date);
                  }
                })} />

            </div>
          )}

        </div>
      </section>
    </div>
  );
}

export default App;