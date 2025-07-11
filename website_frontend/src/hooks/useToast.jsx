import { useState, useCallback } from "react";

export default function useToast() {
  const [toast, setToast] = useState(null);

  const showToast = useCallback(
    (
      message,
      type = "success",
      duration = 3000,
      position = "bottom-right" // default position
    ) => {
      setToast({ message, type, position, visible: true });

      if (duration > 0) {
        setTimeout(() => {
          setToast((prev) => prev && { ...prev, visible: false });
          setTimeout(() => setToast(null), 300); // wait for exit animation
        }, duration);
      }
    },
    []
  );

  const getPositionClasses = (position) => {
    switch (position) {
      case "top-left":
        return "top-4 left-4";
      case "top-right":
        return "top-4 right-4";
      case "bottom-left":
        return "bottom-4 left-4";
      case "bottom-right":
      default:
        return "bottom-4 right-4";
    }
  };

  const Toast = () =>
    toast ? (
      <div
        className={`fixed z-[9999] px-4 py-2 rounded-lg shadow-lg text-sm font-medium text-white transition-all duration-300 ease-in-out
        ${getPositionClasses(toast.position)}
        ${
          toast.visible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-4 pointer-events-none"
        }
        ${
          toast.type === "error"
            ? "bg-red-600"
            : toast.type === "info"
            ? "bg-blue-600"
            : "bg-green-600"
        }`}
      >
        {toast.message}
      </div>
    ) : null;

  return { showToast, Toast };
}
