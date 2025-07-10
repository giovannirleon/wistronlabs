import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactPaginate from "react-paginate";

function Items({ currentItems, displayOrder, fieldStyles, linkType }) {
  return (
    <>
      {currentItems.map((item, index) =>
        !item ? (
          <div
            key={index}
            className="flex justify-between items-center bg-white border border-gray-300 rounded px-4 py-2 my-1 invisible"
          >
            {displayOrder.map((field) => (
              <span key={field} className="flex-1 text-sm text-gray-400">
                null
              </span>
            ))}
          </div>
        ) : (
          (() => {
            const RowContent = displayOrder.map((field, fieldIndex) => {
              const isFirst = fieldIndex === 0;
              const isLast = fieldIndex === displayOrder.length - 1;

              const alignment = isFirst
                ? "text-left"
                : isLast
                ? "text-right"
                : "text-left";

              const value = item[field];

              // Check if fieldStyles returns pill intent
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

              return (
                <span key={field} className={`flex-1 ${alignment} ${classes}`}>
                  {content}
                </span>
              );
            });

            const commonClasses =
              "flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 my-1";

            if (linkType === "internal") {
              return (
                <Link
                  key={index}
                  to={`/${item.service_tag || ""}`}
                  className={commonClasses}
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
                  className={commonClasses}
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
          })()
        )
      )}
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
  defaultPage = "first", // accepts 'first' or 'last'
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
