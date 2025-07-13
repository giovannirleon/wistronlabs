import React, { useEffect, useState } from "react";
import SearchContainer from "../components/SearchContainer";

import { getStations } from "../api/apis.js";
import useIsMobile from "../hooks/useIsMobile.jsx";

import Rack from "../components/Rack";
import Table from "../components/Table";

import { formatDateHumanReadable } from "../utils/date_format";

function HomePage() {
  const [stations, setStations] = useState([]);
  const [downloads, setDownloads] = useState([]);
  const [loading, setLoading] = useState(false);

  const isMobile = useIsMobile();

  const baseUrl =
    import.meta.env.MODE === "development"
      ? "http://html.tss.wistronlabs.com" // is "/l10_logs/" in development
      : "https://tss.wistronlabs.com"; // is "/l10_logs/" in production

  const fetchStations = async () => {
    try {
      const data = await getStations();
      setStations(data);
    } catch (err) {
      console.error("Failed to fetch stations:", err);
    }
  };

  const fetchData = async () => {
    setLoading(true);
    try {
      const [stationData] = await Promise.all([getStations()]);
      setStations(stationData);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // fetch stations every 1s
    fetchData();
    const interval = setInterval(fetchStations, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    // fetch downloads once
    const fetchDownloads = async () => {
      try {
        const link = `${baseUrl}/l10_logs/`;
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

            const formattedDate = formatDateHumanReadable(rawDate);

            //push entry
            entries.push({
              name,
              href: link + href,
              name_title: "File Name",
              date: formattedDate,
              date_title: "Date Modified",
            });
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
      <main className="max-w-10/12 mx-auto mt-8 bg-white rounded shadow-md p-4">
        <h1 className="text-2xl font-semibold mb-6">Station Status</h1>

        <div className="flex flex-col md:flex-row justify-between gap-8 mt-8 w-full">
          {/* Left Column */}
          <div className="flex flex-col w-full">
            <Table
              stations={stations}
              stationNumbers={[1, 2]}
              tableNumber={1}
              link={true}
            />
            <Table
              stations={stations}
              stationNumbers={[3, 4]}
              tableNumber={2}
              link={true}
            />
          </div>

          {/* Right Column */}
          <div className="flex flex-col w-full">
            <Rack stations={stations} rackNumber={1} link={true} />
          </div>
        </div>
      </main>
      {/* Available Downloads */}
      <section className="max-w-[1000px] mx-auto mt-8 bg-white rounded shadow-md p-4">
        <SearchContainer
          data={downloads}
          title={"Available Logs"}
          displayOrder={["name", "date"]}
          defaultSortBy={"date"}
          defaultSortAsc={false}
          fieldStyles={{
            name: "text-blue-600 font-medium",
            date: "text-gray-500 text-sm",
          }}
          linkType="external"
          visibleFields={isMobile ? ["name", "date"] : ["name", "date"]}
        />
      </section>
    </>
  );
}

export default HomePage;
