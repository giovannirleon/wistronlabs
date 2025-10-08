import React, { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import ReactPaginate from "react-paginate";

function Items({
  currentItems,
  displayOrder,
  visibleFields = [],
  fieldStyles,
  linkType,
  rootHref,
  onDirChange,
  truncate,
  onAction,
  actionButtonClass,
  actionButtonVisibleIf,
  hasActionColumn,
}) {
  const filteredDisplayOrder = visibleFields
    ? displayOrder.filter((field) => visibleFields.includes(field))
    : displayOrder;

  return (
    <>
      {currentItems.map((item, index) => {
        const commonClasses =
          "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1 select-text";

        const hoverClass =
          linkType === "internal" || linkType === "external"
            ? " hover:bg-blue-50"
            : "";

        if (!item) {
          return (
            <div
              key={`placeholder-${index}`}
              className={commonClasses + " invisible w-full min-w-0"}
            >
              {filteredDisplayOrder.map((field, fieldIndex) => {
                const alignment =
                  fieldIndex === 0
                    ? "text-left"
                    : fieldIndex === displayOrder.length - 1
                    ? "text-right"
                    : "text-left";

                const truncateClasses = truncate
                  ? "truncate overflow-hidden text-ellipsis whitespace-nowrap"
                  : "";

                return (
                  <span
                    key={field}
                    className={`flex-1 min-w-0 ${alignment} ${truncateClasses} select-text ${
                      hasActionColumn &&
                      fieldIndex === filteredDisplayOrder.length - 1
                        ? "pr-3 sm:pr-4"
                        : ""
                    }`}
                  >
                    filler
                  </span>
                );
              })}

              {hasActionColumn && (
                <div className="shrink-0 w-7 flex justify-end">
                  <button
                    type="button"
                    className={`${actionButtonClass} invisible inline-flex items-center justify-center rounded-full w-7 h-7 border`}
                    aria-hidden
                  />
                </div>
              )}
            </div>
          );
        }

        const RowContent = filteredDisplayOrder.map((field, fieldIndex) => {
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
              className={`flex-1 min-w-0 ${alignment} ${classes} ${truncateClasses} select-text ${
                hasActionColumn &&
                fieldIndex === filteredDisplayOrder.length - 1
                  ? "pr-3 sm:pr-4"
                  : ""
              }`}
            >
              {content}
            </span>
          );
        });

        const isButtonVisible =
          onAction &&
          (!actionButtonVisibleIf ||
            item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals);

        const ActionCell = hasActionColumn ? (
          <div className="shrink-0 w-10 flex justify-end">
            <button
              type="button"
              className={`${actionButtonClass} ${
                isButtonVisible ? "" : "invisible"
              } 
                  inline-flex items-center justify-center rounded-full 
                  w-7 h-7 text-2xl leading-none border border-gray-300 
                  bg-white hover:bg-blue-50 focus:outline-none 
                  focus-visible:ring-2 focus-visible:ring-blue-600`}
              onClick={(e) => {
                e.stopPropagation();
                if (isButtonVisible) onAction?.(item);
              }}
              aria-label="Action"
              title="Action"
            >
              X
            </button>
          </div>
        ) : null;

        return (
          <div
            key={item.id ?? item.link ?? `${item.changed_at}-${index}`}
            className={commonClasses + hoverClass + " w-full min-w-0"}
          >
            {/* Link wraps ONLY the data cells */}
            {linkType === "external" ? (
              (() => {
                const href = item.href || "#";
                const isDir = href.endsWith("/");

                if (isDir && rootHref && onDirChange) {
                  // Directory: clickable <a> that calls onDirChange instead of navigating
                  return (
                    <a
                      href={href}
                      className="flex flex-1 min-w-0 items-center gap-x-4"
                      onClick={(e) => {
                        e.preventDefault();
                        try {
                          const url = new URL(href, window.location.origin);
                          const root = new URL(
                            rootHref,
                            window.location.origin
                          );
                          let rel = decodeURIComponent(
                            url.pathname.replace(root.pathname, "")
                          );
                          rel = rel.replace(/^\/+/, "").replace(/\/?$/, "/");
                          onDirChange(rel);
                        } catch {
                          let rel = decodeURIComponent(
                            href.replace(rootHref, "")
                          )
                            .replace(/^\/+/, "")
                            .replace(/\/?$/, "/");
                          onDirChange(rel);
                        }
                      }}
                      rel="noopener noreferrer"
                    >
                      {RowContent}
                    </a>
                  );
                }

                // Normal external link
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex flex-1 min-w-0 items-center gap-x-4"
                  >
                    {RowContent}
                  </a>
                );
              })()
            ) : linkType === "internal" ? (
              <Link
                to={`/${item.link || ""}`}
                className="flex flex-1 min-w-0 items-center gap-x-4"
              >
                {RowContent}
              </Link>
            ) : (
              <div className="flex flex-1 min-w-0 items-center gap-x-4">
                {RowContent}
              </div>
            )}

            {/* Action button sits OUTSIDE the link */}
            {ActionCell}
          </div>
        );
      })}
    </>
  );
}

export default function PaginatedItems({
  itemsPerPage,
  items,
  searchTerm,
  displayOrder,
  visibleFields = [],
  fieldStyles,
  linkType,
  rootHref,
  onDirChange,
  defaultPage = "first",
  truncate = false, // ⬅️ new optional prop
  onAction = null, // ⬅️ new optional prop
  actionButtonClass = "",
  actionButtonVisibleIf = null, // ⬅️ new optional prop
}) {
  const hasActionColumn =
    !!onAction &&
    (actionButtonVisibleIf === null ||
      items.some(
        (item) =>
          item &&
          item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals
      ));

  const pageCount = Math.ceil(items.length / itemsPerPage);

  const getInitialOffset = () =>
    defaultPage === "last" ? Math.max((pageCount - 1) * itemsPerPage, 0) : 0;

  const [itemOffset, setItemOffset] = useState(getInitialOffset);

  useEffect(() => {
    setItemOffset(getInitialOffset());
  }, [searchTerm, items.length, defaultPage, pageCount]);

  const endOffset = itemOffset + itemsPerPage;
  const currentItems = useMemo(
    () => items.slice(itemOffset, endOffset),
    [items, itemOffset, endOffset]
  );
  const handlePageClick = ({ selected }) => {
    const newOffset = selected * itemsPerPage;
    setItemOffset(newOffset);
  };

  const paddedItems = useMemo(
    () => [
      ...currentItems,
      ...Array(itemsPerPage - currentItems.length).fill(null),
    ],
    [currentItems, itemsPerPage]
  );

  return (
    <>
      <Items
        currentItems={paddedItems}
        displayOrder={displayOrder}
        visibleFields={visibleFields} // ⬅️ pass down
        fieldStyles={fieldStyles}
        linkType={linkType}
        rootHref={rootHref}
        onDirChange={onDirChange}
        truncate={truncate} // ⬅️ pass down
        onAction={onAction} // ⬅️ pass down
        actionButtonClass={actionButtonClass}
        actionButtonVisibleIf={actionButtonVisibleIf}
        hasActionColumn={hasActionColumn}
      />
      <ReactPaginate
        breakLabel="…"
        nextLabel={<span className="hidden sm:inline">next &gt;</span> || ">"}
        previousLabel={
          <span className="hidden sm:inline">&lt; previous</span> || "<"
        }
        onPageChange={handlePageClick}
        pageRangeDisplayed={1}
        marginPagesDisplayed={1} // fewer page numbers for mobile
        pageCount={pageCount}
        renderOnZeroPageCount={null}
        forcePage={Math.floor(itemOffset / itemsPerPage)}
        containerClassName="flex flex-wrap justify-center items-center gap-1 mt-4 text-xs sm:text-sm"
        pageLinkClassName="px-2 sm:px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
        activeLinkClassName="bg-blue-600 text-white border-blue-600"
        previousLinkClassName="px-2 sm:px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
        nextLinkClassName="px-2 sm:px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
        breakLinkClassName="px-2 sm:px-3 py-1 text-gray-400 cursor-default select-none"
        disabledClassName="opacity-50 cursor-not-allowed cursor-default select-none"
      />
    </>
  );
}
