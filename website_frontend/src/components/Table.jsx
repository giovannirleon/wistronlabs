import Station from "./Station";

function Table({ stations, stationNumbers, tableNumber, link }) {
  return (
    <>
      <h2 className="text-xl font-medium mb-4">Debug Table {tableNumber}</h2>
      <div className="pb-4 w-full">
        <table className="w-full bg-white rounded shadow-sm overflow-hidden border-collapse">
          <thead>
            <tr>
              <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3 text-left">
                Station
              </th>
              <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3 text-middle">
                Status
              </th>
              <th className="bg-gray-50 font-semibold uppercase text-xs text-gray-600 p-3 text-right">
                Service Tag
              </th>
            </tr>
          </thead>
          <tbody>
            {stations
              .filter((s) =>
                stationNumbers.includes(
                  parseInt(s.station_name.match(/\d+/)?.[0] || 0)
                )
              )
              .map((s, index) => (
                <Station key={index} stationInfo={s} link={link} />
              ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default Table;
