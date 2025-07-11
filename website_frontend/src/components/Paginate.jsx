import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactPaginate from "react-paginate";

function Items({
  currentItems,
  displayOrder,
  fieldStyles,
  linkType,
  truncate,
}) {
  return (
    <>
      {currentItems.map((item, index) => {
        const commonClasses =
          "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1";

        if (!item) {
          return (
            <div key={index} className={commonClasses + " invisible"}>
              {displayOrder.map((field, fieldIndex) => {
                const isFirst = fieldIndex === 0;
                const isLast = fieldIndex === displayOrder.length - 1;

                const alignment = isFirst
                  ? "text-left"
                  : isLast
                  ? "text-right"
                  : "text-left";

                let content = null;
                let classes = ""; // "text-sm text-transparent"; // invisible text still takes up space

                if (typeof fieldStyles?.[field] === "function") {
                  const styleResult = fieldStyles[field](null);

                  if (styleResult?.type === "pill") {
                    content = (
                      <span
                        className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium opacity-0 ${
                          styleResult.color || "bg-gray-200 text-gray-700"
                        }`}
                      >
                        filler
                      </span>
                    );
                    classes = "";
                  } else if (typeof styleResult === "string") {
                    classes += ` ${styleResult}`;
                  }
                } else if (typeof fieldStyles?.[field] === "string") {
                  classes += ` ${fieldStyles[field]}`;
                }

                const truncateClasses = truncate
                  ? "truncate overflow-hidden text-ellipsis whitespace-nowrap"
                  : "";

                return (
                  <span
                    key={field}
                    className={`flex-1 ${alignment} ${classes} ${truncateClasses}`}
                  >
                    {content || "filler"}
                  </span>
                );
              })}
            </div>
          );
        }

        // populated row
        const RowContent = displayOrder.map((field, fieldIndex) => {
          const isFirst = fieldIndex === 0;
          const isLast = fieldIndex === displayOrder.length - 1;

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
        });

        if (linkType === "internal") {
          return (
            <Link
              key={index}
              to={`/${item.service_tag || ""}`}
              className={commonClasses + " hover:bg-blue-50"}
            >
              {RowContent}
            </Link>
          );
        }

        if (linkType === "external") {
          return (
            <a
              key={index}
              href={item.href || "#"}
              target="_blank"
              rel="noopener noreferrer"
              className={commonClasses + " hover:bg-blue-50"}
            >
              {RowContent}
            </a>
          );
        }

        return (
          <div key={index} className={commonClasses}>
            {RowContent}
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
  fieldStyles,
  linkType,
  defaultPage = "first",
  truncate = false, // ⬅️ new optional prop
}) {
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
        fieldStyles={fieldStyles}
        linkType={linkType}
        truncate={truncate} // ⬅️ pass down
      />
      <ReactPaginate
        breakLabel="…"
        nextLabel="next >"
        onPageChange={handlePageClick}
        pageRangeDisplayed={1}
        marginPagesDisplayed={2}
        pageCount={pageCount}
        previousLabel="< previous"
        renderOnZeroPageCount={null}
        containerClassName="flex justify-center items-center gap-1 mt-4 text-sm"
        pageLinkClassName="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
        activeLinkClassName="bg-blue-600 text-white border-blue-600"
        previousLinkClassName="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
        nextLinkClassName="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
        breakLinkClassName="px-3 py-1 text-gray-400 cursor-default select-none"
        disabledClassName="opacity-50 cursor-not-allowed cursor-default select-none"
        forcePage={Math.floor(itemOffset / itemsPerPage)}
      />
    </>
  );
}
