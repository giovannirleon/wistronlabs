import { useState } from "react";

export default function useConfirm() {
  const [isOpen, setIsOpen] = useState(false);
  const [config, setConfig] = useState({});
  const [resolveFn, setResolveFn] = useState(() => () => {});

  const confirm = ({
    message,
    title = "Confirm",
    confirmText = "Confirm",
    cancelText = "Cancel",
    confirmClass = "bg-blue-600 text-white hover:bg-blue-700",
    cancelClass = "bg-gray-200 text-gray-700 hover:bg-gray-300",
  }) => {
    setConfig({
      message,
      title,
      confirmText,
      cancelText,
      confirmClass,
      cancelClass,
    });
    setIsOpen(true);
    return new Promise((resolve) => {
      setResolveFn(() => resolve);
    });
  };

  const handleConfirm = () => {
    setIsOpen(false);
    resolveFn(true);
  };

  const handleCancel = () => {
    setIsOpen(false);
    resolveFn(false);
  };

  const ConfirmDialog = () =>
    isOpen ? (
      <div
        className="fixed inset-0 flex items-center justify-center bg-black/50 px-2"
        style={{ zIndex: 9999 }}
      >
        <div className="bg-white rounded-xl shadow-xl border border-gray-200 w-full sm:max-w-md p-4 sm:p-6 space-y-4 sm:space-y-6 mx-2">
          <h2 className="text-lg sm:text-xl font-semibold text-gray-800">
            {config.title}
          </h2>
          <p className="text-gray-700 text-sm sm:text-base">{config.message}</p>
          <div className="flex flex-wrap justify-end gap-2">
            <button
              onClick={handleCancel}
              className={`px-3 py-1.5 text-sm rounded ${config.cancelClass}`}
            >
              {config.cancelText}
            </button>
            <button
              onClick={handleConfirm}
              className={`px-3 py-1.5 text-sm rounded ${config.confirmClass}`}
            >
              {config.confirmText}
            </button>
          </div>
        </div>
      </div>
    ) : null;

  return { confirm, ConfirmDialog };
}
