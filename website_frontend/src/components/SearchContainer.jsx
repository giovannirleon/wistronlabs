import React, { useState } from "react";
import PaginatedItems from "./Paginate";

function SearchContainer({ data, title }) {
  const [sortBy, setSortBy] = useState("date"); // default sort
  const [sortAsc, setSortAsc] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredData = data
    .filter((d) => d.name.toLowerCase().includes(searchTerm.toLowerCase()))
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
    });

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        <input
          type="text"
          placeholder="Search…"
          className="border rounded px-2 py-1 text-sm"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="flex flex-col p-4 bg-gray-100 rounded border border-gray-300 shadow-sm mt-4 space-y-2">
        {data.length === 0 ? (
          <p className="text-sm text-gray-500">No Data Available</p>
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

            <PaginatedItems itemsPerPage={10} items={filteredData} />
          </div>
        )}
      </div>
    </>
  );
}

export default SearchContainer;
