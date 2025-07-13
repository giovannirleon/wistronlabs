import React, { useEffect, useState } from "react";
import { Html5QrcodeScanner } from "html5-qrcode";

import useIsMobile from "../hooks/useIsMobile.jsx";

export default function AddSystemModal({
  onClose,
  bulkMode,
  setBulkMode,
  onSubmit,
  addSystemFormError,
}) {
  const [showScanner, setShowScanner] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => {
    let scanner;

    if (showScanner) {
      scanner = new Html5QrcodeScanner("scanner", {
        fps: 10,
        qrbox: { width: 250, height: 250 },
      });

      scanner.render(
        (decodedText) => {
          const input = document.querySelector("input[name='service_tag']");
          if (input) input.value = decodedText;

          scanner.clear();
          setShowScanner(false);
        },
        (err) => {
          console.warn(err);
        }
      );
    }

    return () => {
      if (scanner) {
        scanner.clear();
      }
    };
  }, [showScanner]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full sm:max-w-lg p-4 sm:p-8 mx-2 relative space-y-4 sm:space-y-6">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-gray-400 hover:text-gray-600"
        >
          ✕
        </button>

        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">
          Add System
        </h2>

        {/* Bulk toggle */}
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setBulkMode(false)}
            className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
              !bulkMode
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Single
          </button>
          <button
            onClick={() => setBulkMode(true)}
            className={`px-3 py-1 rounded-lg text-sm shadow-sm ${
              bulkMode
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            Bulk CSV
          </button>
        </div>

        <form className="space-y-4" onSubmit={onSubmit}>
          {!bulkMode ? (
            <>
              <div
                className={`${isMobile && "flex justify-between items-center"}`}
              >
                <InputField label="Service Tag" name="service_tag" />

                {isMobile && (
                  <button
                    type="button"
                    onClick={() => setShowScanner(!showScanner)}
                    className={`ml-2 mt-6 inline-flex items-center gap-1 px-2.5 py-1.5 rounded text-sm shadow-sm border 
    ${
      showScanner
        ? "bg-red-100 text-red-700 border-red-300 hover:bg-red-200"
        : "bg-gray-100 text-gray-700 border-gray-300 hover:bg-gray-200"
    }`}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M4 4h2v16H4V4zm14 0h2v16h-2V4zM9 4h2v16H9V4zm4 0h2v16h-2V4z" />
                    </svg>
                    {showScanner ? "Stop Scanner" : "Scan Barcode"}
                  </button>
                )}
              </div>

              {showScanner && (
                <div id="scanner" className="my-2 rounded border"></div>
              )}

              <InputField label="Issue" name="issue" />
              <TextAreaField label="Note" name="note" />
              {addSystemFormError ? (
                <p className="text-red-500 text-sm">All fields are required.</p>
              ) : (
                <p className="text-red-500 text-sm invisible">
                  All fields are required.
                </p>
              )}
            </>
          ) : (
            <>
              <TextAreaField
                label="CSV Input (service_tag,issue,note)"
                name="bulk_csv"
                placeholder={`ABC123,Fails POST intermittently,Initial intake\nDEF456,Does not power on,Initial intake`}
                rows={5}
              />
              {addSystemFormError ? (
                <p className="text-red-500 text-sm">All fields are required.</p>
              ) : (
                <p className="text-red-500 text-sm invisible">
                  All fields are required.
                </p>
              )}
            </>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 shadow-sm"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 shadow-sm"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const InputField = ({ label, name }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <input
      type="text"
      name={name}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

const TextAreaField = ({ label, name, placeholder = "", rows = 3 }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <textarea
      name={name}
      rows={rows}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      placeholder={placeholder}
    ></textarea>
  </div>
);
