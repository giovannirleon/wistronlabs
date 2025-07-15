import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import useApi from "../hooks/useApi";
import { formatDateHumanReadable } from "../utils/date_format"; // Assuming you have a utility to format dates

export default function LocationHistoryEntry() {
  const { getHistoryById } = useApi();
  const { id } = useParams();

  const [historyEntry, setHistoryEntry] = useState(null);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    async function fetchEntry() {
      try {
        const entry = await getHistoryById(id);
        if (entry) {
          setHistoryEntry({
            ...entry,
            changed_at: formatDateHumanReadable(entry.changed_at),
          });
        } else {
          console.error("No history entry found with this id:", id);
          setIsError(true);
        }
      } catch (err) {
        console.error(err);
        setIsError(true);
      }
    }

    fetchEntry();
  }, [id, getHistoryById]);

  const { changed_at, from_location, to_location, moved_by, note } =
    historyEntry || {};

  return (
    <>
      {isError ? (
        <div className="text-red-600 text-center mt-4">
          No history entry found with this ID.
        </div>
      ) : (
        <div className="min-h-screen bg-gray-50 flex flex-col items-center px-4 py-6">
          <div className="w-full max-w-md bg-white shadow-md rounded-xl overflow-hidden">
            {/* Header */}
            <div className="bg-blue-600 text-white px-4 py-3 text-center">
              <h1 className="text-lg font-semibold">Location History Entry</h1>
            </div>

            {/* Content */}
            <div className="p-4 space-y-4">
              {/* Changed At */}
              <div>
                <h2 className="text-xs font-medium text-gray-500 uppercase">
                  Changed At
                </h2>
                <p className="text-sm mt-1 text-gray-800">{changed_at}</p>
              </div>

              {/* From & To Locations */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <h2 className="text-xs font-medium text-gray-500 uppercase">
                    From
                  </h2>
                  <p className="text-sm mt-1 text-yellow-800 bg-yellow-100 px-2 py-1 rounded">
                    {from_location}
                  </p>
                </div>
                <div>
                  <h2 className="text-xs font-medium text-gray-500 uppercase">
                    To
                  </h2>
                  <p className="text-sm mt-1 text-green-800 bg-green-100 px-2 py-1 rounded">
                    {to_location}
                  </p>
                </div>
              </div>

              {/* Moved By */}
              <div>
                <h2 className="text-xs font-medium text-gray-500 uppercase">
                  Moved By
                </h2>
                <p className="text-sm mt-1 text-gray-800">{moved_by}</p>
              </div>

              {/* Note */}
              <div>
                <h2 className="text-xs font-medium text-gray-500 uppercase">
                  Note
                </h2>
                <p className="text-sm mt-1 text-gray-700 bg-gray-50 rounded px-3 py-2 leading-relaxed">
                  {note}
                </p>
              </div>
            </div>

            {/* Footer
        <div className="bg-gray-50 px-4 py-2 text-center text-xs text-gray-400">
          Entry ID: {id}
        </div> */}
          </div>
        </div>
      )}
    </>
  );
}
