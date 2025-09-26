import React, { useEffect, useState } from "react";
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
          "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1";

        if (!item) {
          return (
            <div key={index} className={commonClasses + " invisible"}>
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
                    className={`flex-1 ${alignment} ${truncateClasses}`}
                  >
                    filler
                  </span>
                );
              })}
              {hasActionColumn && (
                <button
                  type="button"
                  className={`${actionButtonClass} invisible`}
                  aria-hidden
                >
                  ×
                </button>
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
              className={`flex-1 ${alignment} ${classes} ${truncateClasses}`}
            >
              {content}
            </span>
          );
        });

        const isButtonVisible =
          onAction &&
          (!actionButtonVisibleIf ||
            item[actionButtonVisibleIf.field] === actionButtonVisibleIf.equals);

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
          if (linkType === "external") {
            const href = item.href || "#";
            const isDir = href.endsWith("/");
            if (isDir && rootHref && onDirChange) {
              return (
                <a
                  href={href}
                  className={commonClasses + " hover:bg-blue-50 cursor-pointer"}
                  onClick={(e) => {
                    e.preventDefault();
                    try {
                      const url = new URL(href, window.location.origin);
                      const root = new URL(rootHref, window.location.origin);
                      let rel = decodeURIComponent(
                        url.pathname.replace(root.pathname, "")
                      );
                      rel = rel.replace(/^\/+/, "").replace(/\/?$/, "/");
                      onDirChange(rel);
                    } catch {
                      // Fallback: string replace if URL ctor fails
                      let rel = decodeURIComponent(href.replace(rootHref, ""))
                        .replace(/^\/+/, "")
                        .replace(/\/?$/, "/");
                      onDirChange(rel);
                    }
                  }}
                  rel="noopener noreferrer"
                >
                  {children}
                </a>
              );
            }

            // normal file
            return (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className={commonClasses + " hover:bg-blue-50"}
              >
                {children}
              </a>
            );
          } else if (linkType === "internal") {
            return (
              <Link
                to={`/${item.link || ""}`}
                className={commonClasses + " hover:bg-blue-50"}
              >
                {children}
              </Link>
            );
          }
          return <div className={commonClasses}>{children}</div>;
        };

        return (
          <Wrapper key={index}>
            {RowContent}
            {ActionButton}
          </Wrapper>
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
  const currentItems = items.slice(itemOffset, endOffset);

  const handlePageClick = ({ selected }) => {
    const newOffset = selected * itemsPerPage;
    setItemOffset(newOffset);
  };

  const paddedItems = [
    ...currentItems,
    ...Array(itemsPerPage - currentItems.length).fill(null),
  ];

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
