import { useState, useCallback } from "react";
import { DateTime } from "luxon";
import useApi from "./useApi";

export default function useDetailsModal(showToast, onUpdated) {
  const [isOpen, setIsOpen] = useState(false);
  const [details, setDetails] = useState(null);
  const [ppidInput, setPpidInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  const { updateSystemPPID } = useApi();

  const openDetails = useCallback((data) => {
    setDetails(data);
    setIsOpen(true);
  }, []);

  const closeDetails = useCallback(() => {
    setIsOpen(false);
    setDetails(null);
    setPpidInput("");
    setCopied(false);
  }, []);

  const isIncomplete = (d) => {
    if (!d) return true;
    const fields = [
      "dpn",
      "serial",
      "rev",
      "factory_name",
      "factory_code",
      "manufactured_date",
    ];
    return fields.some((f) => !d[f]);
  };

  const handleCopy = async () => {
    if (!details?.ppid) return;
    try {
      await navigator.clipboard.writeText(details.ppid);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
      showToast?.("PPID copied", "success", 1500, "bottom-right");
    } catch {
      showToast?.("Failed to copy PPID", "error", 2000, "bottom-right");
    }
  };

  const handleManualSubmit = async (e) => {
    e.preventDefault();
    if (!ppidInput) return;
    setLoading(true);
    try {
      const res = await updateSystemPPID(details.service_tag, ppidInput);
      showToast?.(res.message, "success", 3000, "bottom-right");
      closeDetails();
      if (onUpdated) {
        await onUpdated();
      }
    } catch (err) {
      console.error("Failed to update PPID", err);
      let message = "Cannot update system, please make sure PPID is correct";
      if (err?.message?.includes("failed:")) {
        const parts = err.message.split(/failed:\s*\d+\s*/);
        if (parts.length > 1) message = parts[1];
      }
      showToast?.(message, "error", 5000, "bottom-right");
    } finally {
      setLoading(false);
    }
  };

  const modal = isOpen && (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      style={{ zIndex: 9999 }}
    >
      <div className="bg-white rounded-2xl shadow-2xl border border-gray-100 w-full sm:max-w-lg p-6 transform transition-all scale-100 animate-fadeIn mx-2">
        <h2 className="text-xl font-bold text-gray-900 mb-3 border-b border-gray-100 pb-2">
          System Details
        </h2>

        {/* PPID: monofont with copy button */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <code
            className="font-mono text-sm sm:text-base bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-900 w-full break-all"
            title="PPID"
          >
            {details?.ppid || "—"}
          </code>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!details?.ppid}
            className={`shrink-0 px-3 py-2 rounded-lg text-sm font-medium shadow
              ${
                details?.ppid
                  ? "bg-gray-800 text-white hover:bg-gray-900"
                  : "bg-gray-200 text-gray-500 cursor-not-allowed"
              }`}
            aria-label="Copy PPID"
          >
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {details && !isIncomplete(details) ? (
          <div className="text-gray-700 text-sm sm:text-base space-y-3">
            <div className="flex justify-between">
              <span className="font-medium">DPN:</span>
              <span>{details.dpn}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Serial:</span>
              <span>{details.serial}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Rev:</span>
              <span>{details.rev}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Factory:</span>
              <span>{details.factory_name}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Factory Code:</span>
              <span>{details.factory_code}</span>
            </div>
            <div className="flex justify-between">
              <span className="font-medium">Manufactured Date:</span>
              <span>
                {DateTime.fromISO(details.manufactured_date, {
                  zone: "utc",
                }).toFormat("MM/dd/yyyy")}
              </span>
            </div>
          </div>
        ) : (
          <form
            className="text-gray-700 text-sm sm:text-base space-y-4"
            onSubmit={handleManualSubmit}
          >
            <p className="text-gray-600">
              System details are incomplete. To populate them:
            </p>
            <ul className="list-disc pl-5 text-gray-600">
              <li>
                Run{" "}
                <code className="bg-gray-100 px-1 rounded">l10_test.sh</code> or{" "}
                <code className="bg-gray-100 px-1 rounded">
                  system_details.sh
                </code>
              </li>
              <li>Or manually enter the unit PPID below</li>
            </ul>
            <input
              type="text"
              value={ppidInput}
              onChange={(e) => setPpidInput(e.target.value)}
              placeholder="Enter full PPID"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
            <button
              type="submit"
              disabled={!ppidInput || loading}
              className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-lg shadow disabled:opacity-50 transition"
            >
              {loading ? "Submitting…" : "Submit PPID"}
            </button>
          </form>
        )}

        <div className="mt-6 flex justify-end">
          <button
            onClick={closeDetails}
            type="button"
            className="px-5 py-2 rounded-lg bg-gray-200 text-gray-800 font-medium text-sm shadow hover:bg-gray-300 focus:outline-none transition"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return { openDetails, closeDetails, modal };
}
