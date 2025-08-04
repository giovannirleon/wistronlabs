import { useState } from "react";

export default function usePrintConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [resolveFn, setResolveFn] = useState(null);

  const confirmPrint = () =>
    new Promise((resolve) => {
      setIsOpen(true);
      setResolveFn(() => resolve);
    });

  const handleChoice = (type) => {
    setIsOpen(false);
    resolveFn(type); // 'id' or 'rma'
  };

  const ConfirPrintmModal = () =>
    isOpen ? (
      <div className="fixed inset-0 flex items-center justify-center bg-black/40 z-[9999] px-2">
        <div className="bg-white p-6 rounded-xl shadow-xl w-full max-w-sm space-y-4">
          <h2 className="text-lg font-semibold text-gray-800">
            Choose Label Type
          </h2>
          <p className="text-sm text-gray-600">
            This system is in an RMA location. Which label would you like to
            print?
          </p>
          <div className="flex justify-between mt-4">
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              onClick={() => handleChoice("id")}
            >
              System ID Label
            </button>
            <button
              className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
              onClick={() => handleChoice("rma")}
            >
              System RMA Label
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return { confirmPrint, ConfirPrintmModal };
}
