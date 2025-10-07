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
          if (input) input.value = decodedText.toUpperCase();
          scanner.clear();
          setShowScanner(false);
        },
        (err) => console.warn(err)
      );
    }
    return () => {
      if (scanner) scanner.clear();
    };
  }, [showScanner]);

  // ⬇️ Close on Esc
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose?.(); // unmounts modal; your scanner cleanup runs
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full sm:max-w-lg p-4 sm:p-8 mx-2 relative space-y-4 sm:space-y-6">
        <h2 className="text-xl sm:text-2xl font-semibold text-gray-800">
          Add System
        </h2>

        {/* Bulk toggle */}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
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
            type="button"
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

        <form className="space-y-4" onSubmit={onSubmit} noValidate>
          {!bulkMode ? (
            <>
              <div
                className={`${isMobile && "flex justify-between items-center"}`}
              >
                <InputField
                  label="Service Tag"
                  name="service_tag"
                  required
                  autoUpper
                />
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
                <div id="scanner" className="my-2 rounded border" />
              )}

              <InputField label="Issue" name="issue" required />

              <InputField
                label="PPID"
                name="ppid"
                required
                autoUpper
                pattern="^[A-Z0-9]{23}$"
                title="PPID must be exactly 23 uppercase alphanumeric characters"
                maxLength={23}
              />

              <InputField
                label="Rack Service Tag"
                name="rack_service_tag"
                required
                autoUpper
              />

              {addSystemFormError ? (
                <p className="text-red-500 text-sm">
                  Service Tag, Issue, PPID, and Rack Service Tag are all
                  required.
                </p>
              ) : (
                <p className="text-red-500 text-sm invisible">placeholder</p>
              )}
            </>
          ) : (
            <>
              <TextAreaField
                label="CSV Input (service_tag,issue,ppid,rack_service_tag) — all required"
                name="bulk_csv"
                placeholder={`ABCDE64,Post fail,MX0JJ3MGWSJ0057200JMA00,DEFGHI4
ABCDE64,No power,MX0JJ3MGWSJ0057200JMA00,DEFGHI4`}
                rows={5}
                required
              />
              {addSystemFormError ? (
                <p className="text-red-500 text-sm">
                  CSV requires four comma- or tab-separated values per line:
                  service_tag, issue, ppid (23 chars), rack_service_tag.
                </p>
              ) : (
                <p className="text-red-500 text-sm invisible">placeholder</p>
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

/* ---------- Inputs ---------- */

const InputField = ({
  label,
  name,
  required = false,
  autoUpper = false,
  pattern,
  title,
  maxLength,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <input
      type="text"
      name={name}
      required={required}
      pattern={pattern}
      title={title}
      maxLength={maxLength}
      autoComplete="off"
      inputMode="text"
      onChange={
        autoUpper
          ? (e) => (e.target.value = e.target.value.toUpperCase())
          : undefined
      }
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
    />
  </div>
);

const TextAreaField = ({
  label,
  name,
  placeholder = "",
  rows = 3,
  required = false,
}) => (
  <div>
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {label}
    </label>
    <textarea
      name={name}
      rows={rows}
      required={required}
      className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
      placeholder={placeholder}
    />
  </div>
);
