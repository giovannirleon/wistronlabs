import React, { useEffect, useState } from 'react';
import ReactPaginate from 'react-paginate';


function Items({ currentItems }) {
    return (
        <>
            {currentItems &&
                currentItems.map((item, index) => (
                    !item ?
                        // null items with the same spacing to make the last page the same size as the others
                        <div
                            key={index}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex justify-between items-center bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 my-1 ${!item ? "invisible" : ""
                                }`}
                        >
                            <span className="text-blue-600 font-medium">
                                null
                            </span>
                            <span className="text-gray-500 text-sm">
                                null
                            </span>
                        </div>
                        :
                        <a
                            key={index}
                            href={item.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={`flex justify-between items-center bg-white border border-gray-300 rounded px-4 py-2 hover:bg-blue-50 my-1 ${!item ? "invisible" : ""
                                }`}
                        >
                            <span className="text-blue-600 font-medium">
                                {item.name}
                            </span>
                            <span className="text-gray-500 text-sm">
                                {item.date}
                            </span>
                        </a>
                ))}
        </>
    );
}

function PaginatedItems({ itemsPerPage, items }) {
    // Here we use item offsets; we could also use page offsets
    // following the API or data you're working with.
    const [itemOffset, setItemOffset] = useState(0);

    // Simulate fetching items from another resources.
    // (This could be items from props; or items loaded in a local state
    // from an API endpoint with useEffect and useState)
    const endOffset = itemOffset + itemsPerPage;
    console.log(`Loading items from ${itemOffset} to ${endOffset}`);
    const currentItems = items.slice(itemOffset, endOffset);
    const pageCount = Math.ceil(items.length / itemsPerPage);
    // Invoke when user click to request another page.
    const handlePageClick = (event) => {
        const newOffset = (event.selected * itemsPerPage) % items.length;
        console.log(
            `User requested page number ${event.selected}, which is offset ${newOffset}`
        );
        setItemOffset(newOffset);
    };

    // Fill with placeholders if needed
    const paddedItems = [
        ...currentItems,
        ...Array(itemsPerPage - currentItems.length).fill(null),
    ];

    return (
        <>
            <Items currentItems={paddedItems} />
            <ReactPaginate
                breakLabel="..."
                nextLabel="next >"
                onPageChange={handlePageClick}
                pageRangeDisplayed={1} // only show 3 pages at a time in the middle
                marginPagesDisplayed={2}
                pageCount={pageCount}
                previousLabel="< previous"
                renderOnZeroPageCount={null}
                // container is the <ul>
                containerClassName="flex justify-center items-center gap-1 mt-4 text-sm"

                // each <li> element
                pageClassName=""
                pageLinkClassName="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"

                // active page
                activeLinkClassName="bg-blue-600 text-white border-blue-600"

                // prev/next buttons
                previousClassName=""
                nextClassName=""
                previousLinkClassName="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"
                nextLinkClassName="px-3 py-1 rounded-md border border-gray-300 text-gray-700 hover:bg-blue-50 hover:text-blue-700 transition-colors cursor-pointer select-none"

                // ellipsis
                breakClassName=""
                breakLinkClassName="px-3 py-1 text-gray-400 cursor-default select-none"

                // disabled prev/next
                disabledClassName="opacity-50 cursor-not-allowed cursor-default select-none"
            />
        </>
    );
}

export default PaginatedItems