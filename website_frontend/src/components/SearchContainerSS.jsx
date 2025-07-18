import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactPaginate from "react-paginate";

export default function SearchContainerSS({
  title,
  displayOrder,
  defaultSortBy,
  defaultSortAsc,
  fieldStyles,
  visibleFields,
  linkType,
  truncate,
  onAction = null,
  actionButtonClass,
  actionButtonVisibleIf,
  fetchData, // ✅ NEW: function that calls your API
  allowSearch = true,
  defaultPage = "first",
  itemsPerPage = 10,
}) {
  const [page, setPage] = useState(1);
  const [sortBy, setSortBy] = useState(defaultSortBy || displayOrder[0]);
  const [sortAsc, setSortAsc] = useState(defaultSortAsc ?? true);
  const [searchTerm, setSearchTerm] = useState("");

  const [data, setData] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchData({
      page,
      page_size: itemsPerPage,
      sort_by: sortBy,
      sort_order: sortAsc ? "asc" : "desc",
      search: searchTerm || undefined,
    })
      .then((res) => {
        setData(res.data);
        setTotalCount(res.total_count);
      })
      .catch((err) => console.error(err))
      .finally(() => setLoading(false));
  }, [page, sortBy, sortAsc, searchTerm, itemsPerPage, fetchData]);

  const pageCount = Math.ceil(totalCount / itemsPerPage);

  const filteredDisplayOrder = visibleFields
    ? displayOrder.filter((field) => visibleFields.includes(field))
    : displayOrder;

  function getHeaderLabel(data, field) {
    const titleField = `${field}_title`;
    return data?.[0]?.[titleField] || field;
  }

  const hasActionColumn =
    !!onAction &&
    (actionButtonVisibleIf === null ||
      data.some(
        (item) =>
          item &&
          item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals
      ));

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
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setPage(1);
            }}
          />
        )}
      </div>

      <div className="flex flex-col p-4 bg-gray-100 rounded border border-gray-300 shadow-sm mt-4 space-y-2">
        {loading ? (
          <p className="text-sm text-gray-500">Loading…</p>
        ) : data.length === 0 ? (
          <p className="text-sm text-gray-500">No Data Available</p>
        ) : (
          <>
            {/* Header row */}
            <div className="flex items-center bg-white border border-gray-300 rounded px-4 py-2 mb-2">
              {filteredDisplayOrder.map((field, fieldIndex) => {
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
                    className={`text-gray-500 text-sm flex-1 ${alignment}`}
                    onClick={() => {
                      if (sortBy === field) {
                        setSortAsc(!sortAsc);
                      } else {
                        setSortBy(field);
                        setSortAsc(true);
                      }
                      setPage(1);
                    }}
                  >
                    {headerLabel} {sortBy === field && (sortAsc ? "▲" : "▼")}
                  </button>
                );
              })}

              {hasActionColumn && (
                <span className="text-gray-500 text-sm w-4 text-right" />
              )}
            </div>

            {/* Data rows */}
            {data.map((item, index) => {
              const commonClasses =
                "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1";

              const RowContent = filteredDisplayOrder.map(
                (field, fieldIndex) => {
                  const alignment =
                    fieldIndex === 0
                      ? "text-left"
                      : fieldIndex === displayOrder.length - 1
                      ? "text-right"
                      : "text-left";

                  const value = item[field];
                  let content = value ?? "";
                  let classes = "text-sm";

                  if (typeof fieldStyles?.[field] === "function") {
                    const styleResult = fieldStyles[field](value);
                    if (styleResult?.type === "pill") {
                      content = (
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            styleResult.color || "bg-gray-200 text-gray-700"
                          }`}
                        >
                          {value}
                        </span>
                      );
                      classes = "";
                    } else {
                      classes = styleResult || "text-sm";
                    }
                  } else if (fieldStyles?.[field]) {
                    classes = fieldStyles[field];
                  }

                  const truncateClasses = truncate
                    ? "truncate overflow-hidden text-ellipsis whitespace-nowrap"
                    : "";

                  return (
                    <span
                      key={field}
                      className={`flex-1 ${alignment} ${classes} ${truncateClasses}`}
                    >
                      {content}
                    </span>
                  );
                }
              );

              const isButtonVisible =
                onAction &&
                (!actionButtonVisibleIf ||
                  item[actionButtonVisibleIf.field] ===
                    actionButtonVisibleIf.equals);

              const ActionButton = hasActionColumn ? (
                <button
                  type="button"
                  className={`${actionButtonClass} ${
                    isButtonVisible ? "" : "invisible"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isButtonVisible) onAction?.(item);
                  }}
                  aria-label="Action"
                  title="Action"
                >
                  ×
                </button>
              ) : null;

              const Wrapper = ({ children }) => {
                if (linkType === "internal") {
                  return (
                    <Link
                      to={`/${item.link || ""}`}
                      className={commonClasses + " hover:bg-blue-50"}
                    >
                      {children}
                    </Link>
                  );
                }
                if (linkType === "external") {
                  return (
                    <a
                      href={item.href || "#"}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={commonClasses + " hover:bg-blue-50"}
                    >
                      {children}
                    </a>
                  );
                }
                return <div className={commonClasses}>{children}</div>;
              };

              return (
                <Wrapper key={item.service_tag}>
                  {RowContent}
                  {ActionButton}
                </Wrapper>
              );
            })}

            {/* Pagination */}
            <ReactPaginate
              breakLabel="…"
              nextLabel="›"
              previousLabel="‹"
              onPageChange={({ selected }) => setPage(selected + 1)}
              pageRangeDisplayed={1}
              marginPagesDisplayed={1}
              pageCount={pageCount}
              renderOnZeroPageCount={null}
              forcePage={page - 1}
              containerClassName="flex flex-wrap justify-center items-center gap-1 mt-4 text-xs sm:text-sm"
              pageLinkClassName="px-2 sm:px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
              activeLinkClassName="bg-blue-600 text-white border-blue-600"
              previousLinkClassName="px-2 sm:px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
              nextLinkClassName="px-2 sm:px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
              breakLinkClassName="px-2 sm:px-3 py-1 text-gray-400 cursor-default select-none"
              disabledClassName="opacity-50 cursor-not-allowed cursor-default select-none"
            />
          </>
        )}
      </div>
    </>
  );
}
