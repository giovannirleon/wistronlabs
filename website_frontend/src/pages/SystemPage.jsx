import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import SearchContainer from "../components/SearchContainer";

function SystemPage() {
  const { serviceTag } = useParams();
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const res = await fetch(
          `http://tss.wistronlabs.com:4000/api/v1/systems/${serviceTag}/history`
        );
        if (!res.ok) throw new Error("Failed to fetch history");
        const data = await res.json();
        setHistory(data);
      } catch (err) {
        console.error(err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [serviceTag]);

  if (loading) return <p>Loading history…</p>;
  if (error) return <p>Error: {error}</p>;

  return (
    <main className="max-w-[1000px] mx-auto mt-8 bg-white rounded shadow-md p-4">
      <h1 className="text-2xl font-semibold mb-4">History for {serviceTag}</h1>

      <SearchContainer
        data={history}
        title=""
        displayOrder={["from_location", "to_location", "note", "changed_at"]}
        defaultSortBy={"changed_at"}
        defaultSortAsc={false}
        fieldStyles={{
          changed_at: "text-gray-500 text-sm",
        }}
        linkType="external"
      />
    </main>
  );
}

export default SystemPage;
