// DownloadReportModal.jsx
import ReactDatePicker from "react-datepicker";
import "react-datepicker/dist/react-datepicker.css";

function parseLocalDateString(yyyyMmDd) {
  const [year, month, day] = yyyyMmDd.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export default function DownloadReportModal({
  onClose,
  reportDate,
  setReportDate,
  onDownload,
  reportMode,
  setReportMode,
  // NEW ↓ props
  idiotProof,
  setIdiotProof,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full max-w-lg p-8 relative space-y-6">
        <h2 className="text-lg font-semibold mb-2">Select Date</h2>

        <label className="block mb-2">
          <span className="mr-2">Date: </span>
          <ReactDatePicker
            selected={reportDate ? parseLocalDateString(reportDate) : null}
            onChange={(date) =>
              setReportDate(date ? date.toLocaleDateString("en-CA") : "")
            }
            dateFormat="MM/dd/yyyy"
            className="border rounded p-1 w-full mt-1"
            placeholderText="Select a date"
            isClearable
            popperPlacement="bottom-start"
            showPopperArrow={false}
          />
        </label>

        {/* NEW: Idiot Proof toggle */}
        <div className="flex items-center justify-between border rounded-lg p-3 bg-gray-50">
          <div>
            <div className="font-medium">Idiot Proof</div>
            <div className="text-sm text-gray-500">
              Use simplified status labels in the report
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIdiotProof(!idiotProof)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition ${
              idiotProof ? "bg-green-600" : "bg-gray-300"
            }`}
            aria-pressed={idiotProof}
            aria-label="Toggle Idiot Proof"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition ${
                idiotProof ? "translate-x-6" : "translate-x-1"
              }`}
            />
          </button>
        </div>

        <div className="mt-4">
          <div className="flex gap-6">
            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="reportMode"
                value="cumulative"
                checked={reportMode === "cumulative"}
                onChange={() => setReportMode("cumulative")}
                className="accent-blue-600"
              />
              Cumulative
            </label>

            <label className="inline-flex items-center gap-2 text-sm text-gray-700">
              <input
                type="radio"
                name="reportMode"
                value="perday"
                checked={reportMode === "perday"}
                onChange={() => setReportMode("perday")}
                className="accent-blue-600"
              />
              Per Day
            </label>
          </div>

          <p className="text-sm text-gray-500 mt-3">
            You can download data for this date as a cumulative total of all
            completed items up to that day, or only the items completed on that
            specific day.
          </p>
        </div>

        <div className="flex justify-end space-x-2 mt-4">
          <button
            onClick={onClose}
            className="px-3 py-1 bg-gray-300 rounded hover:bg-gray-400"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              onDownload(); // will read idiotProof from parent scope
              onClose();
            }}
            className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
          >
            Download
          </button>
        </div>
      </div>
    </div>
  );
}
