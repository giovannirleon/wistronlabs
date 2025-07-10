import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import ReactPaginate from "react-paginate";

// Row renderer
function Items({ currentItems, displayOrder, fieldStyles, linkType }) {
  return (
    <>
      {currentItems &&
        currentItems.map((item, index) =>
          !item ? (
            <div
              key={index}
              className="flex justify-between items-center bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 my-1 invisible"
            >
              {displayOrder.map((field) => (
                <span key={field} className="flex-1 text-sm text-gray-400">
                  null
                </span>
              ))}
            </div>
          ) : (
            (() => {
              const RowContent = (
                <>
                  {displayOrder.map((field, fieldIndex) => {
                    const isFirst = fieldIndex === 0;
                    const isLast = fieldIndex === displayOrder.length - 1;

                    const alignment = isFirst
                      ? "text-left"
                      : isLast
                      ? "text-right"
                      : "text-left";

                    return (
                      <span
                        key={field}
                        className={`flex-1 ${alignment} ${
                          fieldStyles?.[field] || "text-sm"
                        }`}
                      >
                        {item[field] ?? ""}
                      </span>
                    );
                  })}
                </>
              );

              if (linkType === "internal") {
                return (
                  <Link
                    key={index}
                    to={`/${item.service_tag || ""}`}
                    className="flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 my-1"
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
                    className="flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 my-1"
                  >
                    {RowContent}
                  </a>
                );
              }

              // default: no link
              return (
                <div
                  key={index}
                  className="flex items-center gap-x-4 bg-white border border-gray-300 rounded px-4 py-2 my-1"
                >
                  {RowContent}
                </div>
              );
            })()
          )
        )}
    </>
  );
}

function PaginatedItems({
  itemsPerPage,
  items,
  searchTerm,
  displayOrder,
  fieldStyles,
  linkType,
}) {
  const [itemOffset, setItemOffset] = useState(0);

  useEffect(() => {
    setItemOffset(0); // Reset to first page when items or search term changes
  }, [searchTerm]);

  const endOffset = itemOffset + itemsPerPage;
  const currentItems = items.slice(itemOffset, endOffset);
  const pageCount = Math.ceil(items.length / itemsPerPage);

  const handlePageClick = (event) => {
    const newOffset = (event.selected * itemsPerPage) % items.length;
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
        breakLabel="..."
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
        forcePage={itemOffset / itemsPerPage}
      />
    </>
  );
}

export default PaginatedItems;
