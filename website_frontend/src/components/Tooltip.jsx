import React from "react";

export default function Tooltip({
  children,
  text,
  position = "top",
  show = false,
}) {
  const posClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1",
    left: "right-full top-1/2 -translate-y-1/2 mr-1",
    right: "left-full top-1/2 -translate-y-1/2 ml-1",
  };

  if (!show) {
    return <>{children}</>;
  }
  return (
    <div className="relative group inline-flex">
      {children}
      <div
        className={`absolute ${posClasses[position]} hidden group-hover:flex bg-gray-800 text-white text-xs px-2 py-1 rounded shadow z-10 whitespace-nowrap`}
      >
        {text}
      </div>
    </div>
  );
}
