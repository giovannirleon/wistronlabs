import Station from "./Station"

function Rack({ stations, rackNumber }) {

    const stationsPlace = rackNumber * 100;

    return (
        <>
            <h2 className="text-xl font-medium mb-4">Debug Rack {rackNumber}</h2>
            <div className="pb-4 w-full">
                <table className="w-full bg-white rounded shadow-sm overflow-hidden border-collapse">
                    <thead>
                        <tr>
                            <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3">Station</th>
                            <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {stations
                            .filter(
                                (s) =>
                                    parseInt(s.station.match(/\d+/)?.[0] || 0) >= stationsPlace + 27 &&
                                    parseInt(s.station.match(/\d+/)?.[0] || 0) <= stationsPlace + 36
                            ).reverse()
                            .map((s) => (
                                <Station stationInfo={s} />
                            ))}
                        <tr className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3" key={"switches"}>
                            <td className="p-3 border-b border-gray-200">NVlink Switches(18 - 26)</td>
                            <td className="p-3 border-b border-gray-200">
                            </td>
                        </tr>
                        {stations
                            .filter(
                                (s) =>
                                    parseInt(s.station.match(/\d+/)?.[0] || 0) >= stationsPlace + 10 &&
                                    parseInt(s.station.match(/\d+/)?.[0] || 0) <= stationsPlace + 17
                            ).reverse()
                            .map((s) => (
                                <Station stationInfo={s} />
                            ))}
                    </tbody>
                </table>
            </div>
        </>
    )
}

export default Rack