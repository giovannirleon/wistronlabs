import React, { useState } from "react";
import PaginatedItems from "./Paginate";

function SearchContainer({
  data,
  title,
  displayOrder,
  defaultSortBy,
  defaultSortAsc,
  fieldStyles,
  linkType,
  allowSort = true,
  allowSearch = true, // ✅ new prop
  defaultPage = "first", // added: accepts 'first' or 'last'
}) {
  const [sortBy, setSortBy] = useState(defaultSortBy || displayOrder[0]);
  const [sortAsc, setSortAsc] = useState(defaultSortAsc ?? false);
  const [searchTerm, setSearchTerm] = useState("");

  const filteredData = data
    .filter((item) => {
      if (!allowSearch || !searchTerm) return true;
      return displayOrder.some((field) =>
        String(item[field]).toLowerCase().includes(searchTerm.toLowerCase())
      );
    })
    .sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];

      if (Date.parse(aVal) && Date.parse(bVal)) {
        return sortAsc
          ? new Date(aVal) - new Date(bVal)
          : new Date(bVal) - new Date(aVal);
      }

      return sortAsc
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });

  function getHeaderLabel(data, field) {
    const titleField = `${field}_title`;
    return data[0]?.[titleField] || field;
  }

  return (
    <>
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {allowSearch && (
          <input
            type="text"
            placeholder="Search…"
            className="border rounded px-2 py-1 text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        )}
      </div>

      <div className="flex flex-col p-4 bg-gray-100 rounded border border-gray-300 shadow-sm mt-4 space-y-2">
        {data.length === 0 ? (
          <p className="text-sm text-gray-500">No Data Available</p>
        ) : (
          <div>
            {/* Table header */}
            <div className="flex items-center bg-white border border-gray-300 rounded px-4 py-2  mb-2">
              {displayOrder.map((field, fieldIndex) => {
                const isFirst = fieldIndex === 0;
                const isLast = fieldIndex === displayOrder.length - 1;

                const alignment = isFirst
                  ? "text-left"
                  : isLast
                  ? "text-right"
                  : "text-left";

                const headerLabel = getHeaderLabel(data, field);

                return (
                  <button
                    key={field}
                    className={`text-gray-500 text-sm flex-1 ${alignment} ${
                      !allowSort ? "cursor-default" : ""
                    }`}
                    disabled={!allowSort}
                    onClick={() => {
                      if (!allowSort) return;
                      if (sortBy === field) {
                        setSortAsc(!sortAsc);
                      } else {
                        setSortBy(field);
                        setSortAsc(true);
                      }
                    }}
                  >
                    {headerLabel} {sortBy === field && (sortAsc ? "▲" : "▼")}
                  </button>
                );
              })}
            </div>

            {/* Paginated body */}
            <PaginatedItems
              itemsPerPage={10}
              items={filteredData}
              searchTerm={searchTerm}
              displayOrder={displayOrder}
              fieldStyles={fieldStyles}
              linkType={linkType}
              defaultPage={defaultPage}
            />
          </div>
        )}
      </div>
    </>
  );
}

export default SearchContainer;
