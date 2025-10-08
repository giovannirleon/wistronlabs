import React, { useState } from "react";
import PaginatedItems from "./Paginate";

function SearchContainer({
  data,
  title,
  displayOrder,
  defaultSortBy,
  defaultSortAsc,
  fieldStyles,
  visibleFields,
  linkType,
  allowSort = true,
  allowSearch = true, // added: allows disabling search
  defaultPage = "first", // added: accepts 'first' or 'last'
  truncate,
  // directory navigation (optional)
  rootHref,
  currentDir = "",
  onDirChange,
  onAction = null,
  actionButtonClass,
  actionButtonVisibleIf,
}) {
  const [sortBy, setSortBy] = useState(defaultSortBy || displayOrder[0]);
  const [sortAsc, setSortAsc] = useState(defaultSortAsc ?? false);
  const [searchTerm, setSearchTerm] = useState("");

  // add near top of component body
  const hasActionColumn =
    !!onAction &&
    (actionButtonVisibleIf === null ||
      data.some(
        (item) =>
          item &&
          item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals
      ));

  const filteredDisplayOrder = visibleFields
    ? displayOrder.filter((field) => visibleFields.includes(field))
    : displayOrder;

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
      <div className="flex justify-between items-center mt-4">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {rootHref && onDirChange && (
          <div className="flex gap-2 mr-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-sm font-medium"
              onClick={() => onDirChange("")}
              disabled={!currentDir}
              title="Back to root"
            >
              ⌂ Root Directory
            </button>

            <button
              type="button"
              className={`px-3 py-1.5 rounded bg-gray-200 hover:bg-gray-300 text-sm font-medium ${
                !currentDir ? "opacity-30 pointer-events-none" : ""
              }`}
              onClick={() => {
                const parts = currentDir
                  .replace(/\/+$/, "")
                  .split("/")
                  .filter(Boolean);
                parts.pop();
                onDirChange(parts.length ? parts.join("/") + "/" : "");
              }}
              disabled={!currentDir}
              title="Up one level"
            >
              ↑ Up a Directory
            </button>
          </div>
        )}
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
            <div className="flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 mb-2 min-w-0 overflow-hidden">
              {filteredDisplayOrder.map((field, fieldIndex) => {
                const isFirst = fieldIndex === 0;
                const isLastDataCol =
                  fieldIndex === filteredDisplayOrder.length - 1;

                const alignment = isFirst
                  ? "text-left"
                  : isLastDataCol
                  ? "text-right"
                  : "text-left";
                const headerLabel = getHeaderLabel(data, field);

                return (
                  <button
                    key={field}
                    className={`text-gray-500 text-sm flex-1 min-w-0 ${alignment} ${
                      hasActionColumn && isLastDataCol ? "pr-3 sm:pr-4" : ""
                    } ${!allowSort ? "cursor-default" : ""}`}
                    disabled={!allowSort}
                    onClick={() => {
                      if (!allowSort) return;
                      if (sortBy === field) setSortAsc(!sortAsc);
                      else {
                        setSortBy(field);
                        setSortAsc(true);
                      }
                    }}
                  >
                    {headerLabel}{" "}
                    {allowSort && sortBy === field && (sortAsc ? "▲" : "▼")}
                  </button>
                );
              })}

              {hasActionColumn && (
                <span className="shrink-0 w-10 text-right text-gray-500 text-sm">
                  Action
                </span>
              )}
            </div>

            {/* Paginated body */}
            <PaginatedItems
              itemsPerPage={10}
              items={filteredData}
              searchTerm={searchTerm}
              displayOrder={displayOrder}
              visibleFields={visibleFields}
              fieldStyles={fieldStyles}
              linkType={linkType}
              defaultPage={defaultPage}
              truncate={truncate}
              onAction={onAction} // Pass down the onAction prop
              actionButtonClass={actionButtonClass}
              actionButtonVisibleIf={actionButtonVisibleIf}
              rootHref={rootHref}
              onDirChange={onDirChange}
            />
          </div>
        )}
      </div>
    </>
  );
}

export default SearchContainer;
