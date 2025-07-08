import React, { useEffect, useState } from "react";

function Station({ stationInfo }) {

    const renderStatus = (status, message) => {
        const base =
            "inline-block px-2 py-1 rounded-full text-xs font-medium";
        if (status === 0)
            return <span className={`${base} bg-yellow-100 text-yellow-800`}>{message}</span>;
        if (status === 1)
            return <span className={`${base} bg-green-100 text-green-800`}>{message}</span>;
        return <span className={`${base} bg-red-100 text-red-800`}>{message}</span>;
    };

    return (
        <tr key={stationInfo.station}>
            <td className="p-3 border-b border-gray-200">{stationInfo.station}</td>
            <td className="p-3 border-b border-gray-200">
                {renderStatus(stationInfo.status, stationInfo.message)}
            </td>
        </tr>
    );
}

export default Station