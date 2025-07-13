import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";

function Station({ stationInfo, link = false }) {
  const renderStatus = (status, message) => {
    const base = "inline-block px-2 py-1 rounded-full text-xs font-medium";
    if (status === 0)
      return (
        <span className={`${base} bg-yellow-100 text-yellow-800`}>
          {message}
        </span>
      );
    if (status === 1)
      return (
        <span className={`${base} bg-green-100 text-green-800`}>{message}</span>
      );
    return <span className={`${base} bg-red-100 text-red-800`}>{message}</span>;
  };

  return (
    <tr key={stationInfo.station}>
      <td className="p-3 border-b border-gray-200">
        Station {stationInfo.station_name}
      </td>
      <td className="p-3 border-b border-gray-200">
        {renderStatus(stationInfo.status, stationInfo.message)}
      </td>
      <td className="p-3 border-b border-gray-200">
        {stationInfo.system_service_tag === null ? (
          <p className="text-green-500">Available</p>
        ) : link ? (
          <Link
            to={`/systems/${stationInfo.system_service_tag}`}
            className="text-blue-600 hover:underline"
          >
            {stationInfo.system_service_tag}
          </Link>
        ) : (
          <p className="text-gray-500">{stationInfo.system_service_tag}</p>
        )}
      </td>
    </tr>
  );
}

export default Station;
