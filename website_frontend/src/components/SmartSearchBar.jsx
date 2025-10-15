// SmartSearchBar.jsx — fixed filters (no double-stringify), note history, floating scroll
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useSystemsFetch } from "../hooks/useSystemsFetch.jsx";
import { useHistoryFetch } from "../hooks/useHistoryFetch.jsx";
import useApi from "../hooks/useApi.jsx";

const debounce = (fn, ms = 250) => {
  let t;
  return (...a) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...a), ms);
  };
};

const parseQuery = (q) => {
  const parts = q.match(/"[^"]+"|\S+/g) || [];
  const tokens = [],
    text = [];
  for (const raw of parts) {
    const piece = raw.replace(/^"|"$/g, "");
    const m = piece.match(/^([a-z_]+):(.*)$/i);
    if (!m) {
      if (piece) text.push(piece);
      continue;
    }
    const key = m[1].toLowerCase();
    let value = m[2].replace(/^"|"$/g, "");
    let op = "=";
    if (value.includes("*")) {
      op = "ILIKE";
      value = value.replace(/\*/g, "").trim();
    }
    tokens.push({ key, op, value });
  }
  return { tokens, text };
};

const highlight = (s, needles) => {
  if (!s) return null;
  if (!needles.length) return s;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp("(" + needles.map(esc).join("|") + ")", "ig");
  return s
    .split(re)
    .map((chunk, i) =>
      re.test(chunk) ? (
        <mark key={i}>{chunk}</mark>
      ) : (
        <span key={i}>{chunk}</span>
      )
    );
};

const buildSystemFilters = ({ tokens, text }) => {
  const conditions = [];
  const push = (field, val, op = "=") =>
    conditions.push({ field, values: [val], op });

  tokens.forEach(({ key, op, value }) => {
    const OP = op === "ILIKE" ? "ILIKE" : "=";
    if (["st", "service", "service_tag"].includes(key))
      push("service_tag", `%${value}%`, "ILIKE");
    else if (key === "ppid")
      push("ppid", OP === "ILIKE" ? `%${value}%` : value, OP);
    else if (key === "dpn")
      push("dpn", OP === "ILIKE" ? `%${value}%` : value, OP);
    else if (key === "config") push("config", value, "=");
    else if (key === "loc" || key === "location")
      push("location", OP === "ILIKE" ? `%${value}%` : value, OP);
    else if (["cust", "customer", "dell_customer"].includes(key))
      push("dell_customer", OP === "ILIKE" ? `%${value}%` : value, OP);
    else if (key === "issue") push("issue", `%${value}%`, "ILIKE");
    else if (key === "rc") push("root_cause", `%${value}%`, "ILIKE");
    else if (key === "rcsub")
      push("root_cause_sub_category", `%${value}%`, "ILIKE");
    else if (key === "factory")
      push("factory", OP === "ILIKE" ? `%${value}%` : value, OP);
    else if (key === "location_id") push("location_id", value, "=");
  });

  if (text.length) {
    const cols = [
      "service_tag",
      "issue",
      "dpn",
      "dell_customer",
      "location",
      "factory",
      "root_cause",
      "root_cause_sub_category",
    ];
    const or = { op: "OR", conditions: [] };
    text.forEach((term) =>
      cols.forEach((c) =>
        or.conditions.push({ field: c, values: [`%${term}%`], op: "ILIKE" })
      )
    );
    conditions.push(or);
  }
  return conditions.length ? { op: "AND", conditions } : null;
};

const buildHistoryFilters = (noteTerms = []) => {
  // IMPORTANT: Your /systems/history route must map `note: "h.note"` in buildWhereClause.
  const conditions = [];
  noteTerms.forEach((t) =>
    conditions.push({ field: "note", values: [`%${t}%`], op: "ILIKE" })
  );
  return conditions.length ? { op: "AND", conditions } : null;
};

export default function SmartSearchBar() {
  const [q, setQ] = useState("");
  const [parsed, setParsed] = useState(parseQuery(""));
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  const _fetchSystems = useSystemsFetch();
  const _fetchHistory = useHistoryFetch();
  const api = useApi();

  const fetchSystemsRef = useRef(_fetchSystems);
  const fetchHistoryRef = useRef(_fetchHistory);
  const getPalletsRef = useRef(api?.getPallets);

  useEffect(() => {
    fetchSystemsRef.current = _fetchSystems;
  }, [_fetchSystems]);
  useEffect(() => {
    fetchHistoryRef.current = _fetchHistory;
  }, [_fetchHistory]);
  useEffect(() => {
    getPalletsRef.current = api?.getPallets;
  }, [api]);

  const debounced = useMemo(
    () => debounce((v) => setParsed(parseQuery(v)), 200),
    []
  );
  useEffect(() => {
    debounced(q);
  }, [q, debounced]);

  const needles = useMemo(
    () =>
      [...parsed.text, ...parsed.tokens.map((t) => t.value)].filter(Boolean),
    [parsed]
  );
  const shouldSearch = useMemo(
    () => parsed.tokens.length > 0 || parsed.text.join(" ").trim().length >= 2,
    [parsed]
  );

  const noteTerms = useMemo(
    () => parsed.tokens.filter((t) => t.key === "note").map((t) => t.value),
    [parsed]
  );

  const palletParams = useMemo(() => {
    const p = {};
    parsed.tokens.forEach(({ key, value }) => {
      if (key === "pallet") p.pallet_number = value;
      if (key === "status") p.status = value;
      if (key === "factory") p.factory_code = value;
      if (key === "dpn") p.dpn = value;
    });
    const maybePal = parsed.text.find((t) => /^pal/i.test(t));
    if (maybePal && !p.pallet_number) p.pallet_number = maybePal;
    return p;
  }, [parsed]);

  const reqRef = useRef({ aborted: false });

  useEffect(() => {
    if (!shouldSearch) {
      setRows([]);
      if (open) setOpen(false);
      return;
    }

    const tag = { aborted: false };
    reqRef.current.aborted = true;
    reqRef.current = tag;

    (async () => {
      setLoading(true);
      try {
        const fetchSystems = fetchSystemsRef.current;
        const fetchHistory = fetchHistoryRef.current;
        const getPallets = getPalletsRef.current;

        // 1) Direct systems via backend filters (PASS OBJECT, NOT STRING)
        const sysFilters = buildSystemFilters(parsed);
        const sysPromise = sysFilters
          ? fetchSystems({
              page: 1,
              page_size: 50,
              sort_by: "date_modified",
              sort_order: "desc",
              filters: sysFilters, // <-- object
            }).then((r) => r?.data || [])
          : Promise.resolve([]);

        // 2) Note history -> tags -> systems IN
        const histPromise = noteTerms.length
          ? (async () => {
              const hFilters = buildHistoryFilters(noteTerms);
              const hr = await fetchHistory({
                page: 1,
                page_size: 50,
                sort_by: "changed_at",
                sort_order: "desc",
                filters: hFilters, // object; useHistoryFetch will stringify
              });
              const tags = Array.from(
                new Set((hr.data || []).map((h) => h.service_tag))
              ).slice(0, 100);
              if (!tags.length) return [];
              const inFilter = {
                op: "AND",
                conditions: [{ field: "service_tag", values: tags, op: "IN" }],
              };
              const sr = await fetchSystems({
                page: 1,
                page_size: 50,
                sort_by: "date_modified",
                sort_order: "desc",
                filters: inFilter, // <-- object
              });
              return sr?.data || [];
            })()
          : Promise.resolve([]);

        // 3) Systems inside pallets -> tags -> systems IN
        const palPromise = Object.keys(palletParams).length
          ? (async () => {
              let pallets = [];
              if (getPallets) {
                const res = await getPallets(palletParams);
                pallets = res?.data || res || [];
              } else {
                const r = await fetch(
                  `${
                    import.meta.env.VITE_BACKEND_URL
                  }/pallets?${new URLSearchParams(palletParams)}`
                );
                const j = await r.json();
                pallets = j?.data || [];
              }
              const tags = Array.from(
                new Set(
                  pallets.flatMap((p) =>
                    [
                      ...(p.active_systems || []),
                      ...(p.released_systems || []),
                      ...(p.systems || []),
                    ].map((s) => s.service_tag)
                  )
                )
              ).slice(0, 100);
              if (!tags.length) return [];
              const inFilter = {
                op: "AND",
                conditions: [{ field: "service_tag", values: tags, op: "IN" }],
              };
              const sr = await fetchSystems({
                page: 1,
                page_size: 50,
                sort_by: "date_modified",
                sort_order: "desc",
                filters: inFilter, // <-- object
              });
              return sr?.data || [];
            })()
          : Promise.resolve([]);

        const [direct, fromNotes, fromPallets] = await Promise.all([
          sysPromise,
          histPromise,
          palPromise,
        ]);
        if (tag.aborted) return;

        const map = new Map();
        [...direct, ...fromNotes, ...fromPallets].forEach((s) => {
          if (!map.has(s.service_tag)) map.set(s.service_tag, s);
        });
        setRows(Array.from(map.values()));
        if (!open) setOpen(true);
      } finally {
        if (!tag.aborted) setLoading(false);
      }
    })();

    return () => {
      tag.aborted = true;
    };
  }, [parsed, shouldSearch, noteTerms, palletParams, open]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => rows.length && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder={`Search units — e.g. bianca dpn:KR7T5 loc:"RMA VID" note:Bianca pallet:PAL-123 status:open`}
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />

      {open && (
        <div
          className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-64 overflow-auto"
          role="listbox"
        >
          {loading ? (
            <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
          ) : rows.length ? (
            rows.map((s) => (
              <a
                key={`${s.id}-${s.service_tag}`}
                href={`/${encodeURIComponent(s.service_tag)}`}
                className="block px-3 py-2 text-sm hover:bg-gray-50"
              >
                <div className="font-medium">
                  {highlight(s.service_tag, needles)}{" "}
                  <span className="text-gray-400">#{s.id}</span>
                </div>
                <div className="text-gray-600">
                  {highlight(s.issue || "", needles)}
                </div>
                <div className="text-gray-500">
                  DPN {highlight(s.dpn || "", needles)} ·{" "}
                  {highlight(s.location || "", needles)} ·{" "}
                  {highlight(s.dell_customer || "", needles)}
                </div>
              </a>
            ))
          ) : (
            <div className="px-3 py-2 text-xs text-gray-400">No matches.</div>
          )}
        </div>
      )}
    </div>
  );
}
