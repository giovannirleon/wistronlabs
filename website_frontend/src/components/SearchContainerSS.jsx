import React, { useEffect, useState, useRef } from "react";
import { Link } from "react-router-dom";
import ReactPaginate from "react-paginate";
import TagBar from "./TagBar.jsx";
import { useDebounce } from "../hooks/useDebounce.jsx";

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
  fetchData,
  allowSearch = true,
  itemsPerPage = 10,
  page: externalPage,
  onPageChange,
  possibleSearchTags = [],
}) {
  const [internalPage, setInternalPage] = useState(1);
  const [sortBy, setSortBy] = useState(defaultSortBy || displayOrder[0]);
  const [sortAsc, setSortAsc] = useState(defaultSortAsc ?? true);
  const [searchTerm, setSearchTerm] = useState("");

  const [data, setData] = useState([]);
  const [displayedData, setDisplayedData] = useState([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const [open, setOpen] = useState(false);
  const [searchTags, setSearchTags] = useState([]);
  const [availableTags, setAvailableTags] = useState(possibleSearchTags);
  const [tagGroups, setTagGroups] = useState([]);
  const [currentGroup, setCurrentGroup] = useState(0);

  const searchRef = useRef(null);

  const debouncedSearchTerm = useDebounce(searchTerm, 300);

  const page = externalPage ?? internalPage;

  const handlePageChange = (newPage) => {
    if (onPageChange) onPageChange(newPage);
    else setInternalPage(newPage);
  };

  useEffect(() => {
    setLoading(true);
    fetchData({
      page,
      page_size: itemsPerPage,
      sort_by: sortBy,
      sort_order: sortAsc ? "asc" : "desc",
      search: debouncedSearchTerm || undefined,
      filters: tagGroups.some((tg) => tg.searchTags.length > 0) ? { op: "AND", conditions: [
        { op: "OR", conditions: tagGroups.filter((tg) => tg.searchTags.length > 0).map((tg) => ({
            op: "AND",
            conditions: tg.searchTags.map((t) => ({
              field: t.field,
              values: [t.value],
              op: "=",
            }))
          })) 
        },
        { field: "issue", values: [debouncedSearchTerm], op: "ILIKE" }
      ]} : null,
    })
      .then((res) => {
        setData(res.data);
        setTotalCount(res.total_count);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [debouncedSearchTerm, page, sortBy, sortAsc, itemsPerPage, fetchData, searchTags]);

  useEffect(() => {
    if (!loading) setDisplayedData(data);
  }, [loading, data]);

  const pageCount = Math.ceil(totalCount / itemsPerPage);

  const filteredDisplayOrder = visibleFields
    ? displayOrder.filter((field) => visibleFields.includes(field))
    : displayOrder;

  const hasActionColumn =
    !!onAction &&
    (actionButtonVisibleIf === null ||
      displayedData.some(
        (item) =>
          item &&
          item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals
      ));

  const matchTag = (word, tag) => `${tag.field}: ${tag.value}`.toLowerCase().includes(word.toLowerCase());

  const getHeaderLabel = (data, field) => {
    const titleField = `${field}_title`;
    return data?.[0]?.[titleField] || field;
  };

  return (
    <div className="flex flex-col pt-2 space-y-2">
      <div className="flex justify-between items-center mb-6 gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
        {allowSearch && (
          <div className={"relative"}>
            {tagGroups.length > 0 && (
              tagGroups.map((tg, i) => (
                <TagBar
                  possibleTags={tg.availableTags}
                  tags={tg.searchTags}
                  isActive={i === currentGroup && open}
                  handleChange={(st, at) => {
                    tagGroups[i] = {searchTags: st, availableTags: at};
                    setTagGroups([...tagGroups]);
                  }}
                  handleClick={() => {
                    setCurrentGroup(i);
                    setSearchTags(tagGroups[i].searchTags);
                    setAvailableTags(tagGroups[i].availableTags);
                    searchRef.current.focus();
                  }}
                  handleRemoval={() => {
                    setCurrentGroup(0);
                    const filteredTagGroups = tagGroups.filter((t, j) => j !== i);
                    if (filteredTagGroups.length < 1) {
                      setSearchTags([]);
                      setAvailableTags(possibleSearchTags);
                    }
                    else {
                      setSearchTags(filteredTagGroups[0].searchTags);
                      setAvailableTags(filteredTagGroups[0].availableTags);
                    }
                    setTagGroups(filteredTagGroups);
                  }}
                />
              ))
            )}
            <input
              type="text"
              placeholder="Search…"
              className="border rounded px-2 py-1 text-sm w-64 md:w-96 lg:w-[32rem]" // 👈 wider
              value={searchTerm}
              ref={searchRef}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                // setOpen(e.target.value.length > 0 && availableTags.length > 0);
                handlePageChange(1);
              }}
              onFocus={() => {
                setOpen(possibleSearchTags.length > 0);
              }}
              onBlur={() => {
                setOpen(false);
              }}
            />

            {(open) && (
              <div
                className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-36 overflow-auto"
                onMouseDown={(e) => e.preventDefault()}
              >
                {(availableTags.some((t) => matchTag(searchTerm, t)) && searchTerm.length > 0) &&
                  availableTags.filter((t) => matchTag(searchTerm, t)).map((t,i) => (
                    <div 
                      key={`tag-${i}`}
                      onClick={() => {
                        setAvailableTags(availableTags.filter((at) => !matchTag(`${at.field}: ${at.value}`, t)));
                        setSearchTags([...searchTags, t]);
                        tagGroups[currentGroup] = {
                          searchTags: [...searchTags, t], 
                          availableTags: availableTags.filter((at) => !matchTag(`${at.field}: ${at.value}`, t))
                        };
                        setTagGroups([...tagGroups]);
                        setSearchTerm("");
                        searchRef.current.blur();
                        setOpen(false);
                      }}
                      className="block px-3 py-2 text-sm hover:bg-gray-50"
                    >
                      {`${t.field}: ${t.value}`}
                    </div>
                  ))
                }
                <div 
                  className="block px-3 py-2 text-sm hover:bg-gray-50"
                  onClick={() => {
                    //Set the current focused group to the new group
                    setCurrentGroup(tagGroups.length);
                    setTagGroups([...tagGroups, {
                      searchTags: [],
                      availableTags: possibleSearchTags
                    }]);
                    setSearchTags([]);
                    setAvailableTags(possibleSearchTags);
                    // setOpen(false);
                  }}
                >
                  Create new tag group
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className=" bg-gray-100 rounded border border-gray-300 shadow-sm p-4">
        <div className="relative min-h-[300px]">
          {loading && displayedData.length === 0 && (
            <div className="absolute inset-0 flex justify-center items-center bg-gray-50 bg-opacity-50 z-10">
              <p className="text-sm text-gray-500">Loading…</p>
            </div>
          )}

          {!loading && displayedData.length === 0 && (
            <div className="flex justify-center items-center h-full">
              <p className="text-sm text-gray-500">No Data Available</p>
            </div>
          )}

          {displayedData.length > 0 && (
            <>
              {/* Header */}
              <div className="flex items-center bg-white border border-gray-300 rounded px-4 py-2 mb-2">
                {filteredDisplayOrder.map((field, fieldIndex) => {
                  const isFirst = fieldIndex === 0;
                  const isLast = fieldIndex === filteredDisplayOrder.length - 1;
                  const alignment = isFirst
                    ? "text-left"
                    : isLast
                    ? "text-right"
                    : "text-left";

                  return (
                    <button
                      key={field}
                      className={`cursor-pointer text-gray-500 text-sm flex-1 ${alignment}`}
                      onClick={() => {
                        if (sortBy === field) setSortAsc(!sortAsc);
                        else {
                          setSortBy(field);
                          setSortAsc(true);
                        }
                        setPage(1);
                      }}
                    >
                      {getHeaderLabel(displayedData, field)}{" "}
                      {sortBy === field && (sortAsc ? "▲" : "▼")}
                    </button>
                  );
                })}
                {hasActionColumn && <span className="w-4" />}
              </div>

              {/* Rows */}
              {displayedData.map((item) => {
                const commonClasses =
                  "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1";

                const RowContent = filteredDisplayOrder.map(
                  (field, fieldIndex) => {
                    const isFirst = fieldIndex === 0;
                    const isLast =
                      fieldIndex === filteredDisplayOrder.length - 1;
                    const alignment = isFirst
                      ? "text-left"
                      : isLast
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

              {/* Fill empty rows */}
              {Array.from({ length: itemsPerPage - displayedData.length }).map(
                (_, idx) => (
                  <div
                    key={`empty-${idx}`}
                    className="flex items-center gap-x-4 bg-transparent px-4 py-2 my-1"
                    style={{ minHeight: "42px" }} // same height as a row
                  />
                )
              )}

              {/* Pagination */}
              <ReactPaginate
                breakLabel="…"
                nextLabel="›"
                previousLabel="‹"
                pageRangeDisplayed={1}
                marginPagesDisplayed={1}
                pageCount={pageCount}
                onPageChange={({ selected }) => handlePageChange(selected + 1)}
                forcePage={page - 1}
                containerClassName="flex flex-wrap justify-center items-center gap-1 mt-4 text-xs sm:text-sm"
                pageLinkClassName="cursor-pointer select-none px-2 sm:px-3 py-1 rounded-md border border-gray-300"
                activeLinkClassName="cursor-pointer select-none bg-blue-600 text-white border-blue-600"
                previousLinkClassName="cursor-pointer select-none px-2 sm:px-3 py-1 rounded-md border border-gray-300"
                nextLinkClassName="cursor-pointer select-none px-2 sm:px-3 py-1 rounded-md border border-gray-300"
                breakLinkClassName="select-none px-2 sm:px-3 py-1 text-gray-400"
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
