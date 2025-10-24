// SmartSearchBar.jsx — stable fetch (no flicker), opens as results arrive
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useSystemsFetch } from "../hooks/useSystemsFetch.jsx";
import { useHistoryFetch } from "../hooks/useHistoryFetch.jsx";
import useApi from "../hooks/useApi.jsx";

// Build a tag -> [note strings] map from history rows
function groupNotesByTag(historyRows) {
  const m = new Map();
  for (const h of historyRows || []) {
    if (!h?.service_tag || !h?.note) continue;
    const arr = m.get(h.service_tag) || [];
    arr.push(h.note);
    m.set(h.service_tag, arr);
  }
  return m;
}

// AND across free-text terms in notes (each term must appear in some note for that tag)
async function fetchNotesAND(fetchHistory, terms, dateConds) {
  let tagSet = null;
  let noteMap = new Map();

  // fetch once per term; intersect tag sets
  for (const term of terms) {
    const hr = await fetchHistory({
      page: 1,
      page_size: 200,
      sort_by: "changed_at",
      sort_order: "desc",
      filters: {
        op: "AND",
        conditions: [
          ...dateConds,
          { field: "note", values: [`%${term}%`], op: "ILIKE" },
        ],
      },
    });

    const thisMap = groupNotesByTag(hr?.data || []);
    const thisTags = new Set(thisMap.keys());

    // union note lists for tags that survive the intersection
    if (!tagSet) {
      tagSet = thisTags;
      noteMap = thisMap;
    } else {
      const nextSet = new Set();
      const nextMap = new Map();
      for (const t of tagSet) {
        if (thisTags.has(t)) {
          nextSet.add(t);
          nextMap.set(t, [
            ...(noteMap.get(t) || []),
            ...(thisMap.get(t) || []),
          ]);
        }
      }
      tagSet = nextSet;
      noteMap = nextMap;
    }
  }

  return { tagSet: tagSet || new Set(), noteMap };
}

async function fetchNotesOR(fetchHistory, groups, dateConds) {
  let accSet = null;
  let accMap = new Map();

  for (const group of groups) {
    let groupSet = new Set();
    let groupMap = new Map();

    for (const term of group) {
      const hr = await fetchHistory({
        page: 1,
        page_size: 200,
        sort_by: "changed_at",
        sort_order: "desc",
        filters: {
          op: "AND",
          conditions: [
            ...dateConds,
            { field: "note", values: [`%${term}%`], op: "ILIKE" },
          ],
        },
      });

      const m = groupNotesByTag(hr?.data || []);
      // union within the group
      for (const [tag, notes] of m) {
        groupSet.add(tag);
        groupMap.set(tag, [...(groupMap.get(tag) || []), ...notes]);
      }
    }

    // intersect across groups
    if (accSet == null) {
      accSet = groupSet;
      accMap = groupMap;
    } else {
      const nextSet = new Set();
      const nextMap = new Map();
      for (const t of accSet) {
        if (groupSet.has(t)) {
          nextSet.add(t);
          nextMap.set(t, [
            ...(accMap.get(t) || []),
            ...(groupMap.get(t) || []),
          ]);
        }
      }
      accSet = nextSet;
      accMap = nextMap;
    }
  }

  return { tagSet: accSet || new Set(), accMap };
}

// ---------- utils ----------
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const upper = (s) => (s || "").toString().toUpperCase();

const highlight = (s, needles) => {
  if (!s) return null;
  if (!needles.length) return s;
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = new RegExp("(" + needles.map(esc).join("|") + ")", "ig");
  const probe = new RegExp("(" + needles.map(esc).join("|") + ")", "i");
  return s
    .split(body)
    .map((c, i) =>
      probe.test(c) ? <mark key={i}>{c}</mark> : <span key={i}>{c}</span>
    );
};

function buildHaystack(row) {
  return upper(
    [
      row.service_tag,
      row.issue,
      row.dpn,
      row.dell_customer,
      row.location,
      row.factory_code,
      row.root_cause,
      row.root_cause_sub_category,
      ...(row.__notes || []),
    ]
      .filter(Boolean)
      .join(" ")
  );
}

function applyBooleanFilter(map, textAND, textOR, negatives) {
  if (!textAND?.length && !textOR?.length && !negatives?.length) return map;

  const andTerms = (textAND || []).map(upper);
  const orGroups = (textOR || []).map((g) => g.map(upper));
  const negs = (negatives || []).map(upper);

  const out = new Map();
  for (const [k, row] of map) {
    const hay = buildHaystack(row);

    // AND: every term must exist somewhere (fields or notes)
    const andOK = andTerms.every((t) => hay.includes(t));

    // OR: for each group, at least one term must exist
    const orOK = orGroups.every(
      (group) => group.length === 0 || group.some((t) => hay.includes(t))
    );

    // Negatives: none may exist
    const negOK = negs.every((n) => !hay.includes(n));

    if (andOK && orOK && negOK) out.set(k, row);
  }
  return out;
}

// debounced value hook
function useDebounced(value, delay = 180) {
  const [d, setD] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setD(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return d;
}

function parseQuery(q) {
  const parts = q.match(/"[^"]+"|\S+/g) || [];
  const tokens = [];
  const textAND = [];
  const textOR = [];
  const negatives = [];
  let currentOR = null;
  let lastWasOR = false;

  const pushTerm = (t) => {
    if (!t) return;
    if (t.startsWith("-") && t.length > 1) {
      negatives.push(t.slice(1));
      return;
    }
    if (lastWasOR) {
      // we just saw "OR", so we must be inside a group
      if (!currentOR) {
        const prev = textAND.pop();
        currentOR = prev ? [prev] : [];
        textOR.push(currentOR);
      }
      currentOR.push(t);
    } else {
      // no OR linking this token -> finish any previous group
      currentOR = null;
      textAND.push(t);
    }
    lastWasOR = false;
  };

  for (const raw of parts) {
    const piece = raw.replace(/^"|"$/g, "");
    if (/^or$/i.test(piece)) {
      lastWasOR = true;
      continue;
    }

    const m = piece.match(/^([a-z_]+):(.*)$/i);
    if (!m) {
      pushTerm(piece);
      continue;
    }

    const key = m[1].toLowerCase();
    let value = m[2].replace(/^"|"$/g, "");
    let op = value.includes("*") ? "ILIKE" : "=";
    value = value.replace(/\*/g, "");
    if (["before", "after", "on"].includes(key) && isDate(value)) {
      tokens.push({ key, value });
    } else {
      tokens.push({ key, value, op });
    }
    // chips break OR runs
    currentOR = null;
    lastWasOR = false;
  }

  return { tokens, textAND, textOR, negatives };
}

// ---------- system/history filter helpers ----------
function flatSystemLeavesFromTokens(tokens) {
  const leaves = [];
  const like = (v) => `%${v}%`;
  for (const { key, op, value } of tokens) {
    const OP = op === "ILIKE" ? "ILIKE" : "=";
    if (["st", "service", "service_tag"].includes(key))
      leaves.push({ field: "service_tag", values: [like(value)], op: "ILIKE" });
    else if (key === "ppid")
      leaves.push({
        field: "ppid",
        values: [OP === "ILIKE" ? like(value) : value],
        op: OP,
      });
    else if (key === "dpn")
      leaves.push({
        field: "dpn",
        values: [OP === "ILIKE" ? like(value) : value],
        op: OP,
      });
    else if (key === "config")
      leaves.push({ field: "config", values: [value], op: "=" });
    else if (key === "loc" || key === "location")
      leaves.push({
        field: "location",
        values: [OP === "ILIKE" ? like(value) : value],
        op: OP,
      });
    else if (["cust", "customer", "dell_customer"].includes(key))
      leaves.push({
        field: "dell_customer",
        values: [OP === "ILIKE" ? like(value) : value],
        op: OP,
      });
    else if (key === "issue")
      leaves.push({ field: "issue", values: [like(value)], op: "ILIKE" });
    else if (key === "rc")
      leaves.push({ field: "root_cause", values: [like(value)], op: "ILIKE" });
    else if (key === "rcsub")
      leaves.push({
        field: "root_cause_sub_category",
        values: [like(value)],
        op: "ILIKE",
      });
    else if (key === "factory")
      leaves.push({
        field: "factory_code",
        values: [OP === "ILIKE" ? like(value) : value],
        op: OP,
      });
    else if (key === "location_id")
      leaves.push({ field: "location_id", values: [value], op: "=" });
  }
  return leaves;
}

function flatHistoryLeaves(tokens) {
  const conds = [];
  const before = tokens.find((t) => t.key === "before");
  const after = tokens.find((t) => t.key === "after");
  const on = tokens.find((t) => t.key === "on");
  tokens
    .filter((t) => t.key === "note")
    .forEach((t) =>
      conds.push({ field: "note", values: [`%${t.value}%`], op: "ILIKE" })
    );
  if (on) {
    conds.push({
      field: "changed_at",
      values: [`${on.value}T00:00:00Z`],
      op: ">=",
    });
    conds.push({
      field: "changed_at",
      values: [`${on.value}T23:59:59Z`],
      op: "<=",
    });
  } else {
    if (after)
      conds.push({
        field: "changed_at",
        values: [`${after.value}T00:00:00Z`],
        op: ">=",
      });
    if (before)
      conds.push({
        field: "changed_at",
        values: [`${before.value}T23:59:59Z`],
        op: "<=",
      });
  }
  return conds;
}

function valuesCoveredByFieldTokens(tokens) {
  const fieldKeys = new Set([
    "st",
    "service",
    "service_tag",
    "ppid",
    "dpn",
    "config",
    "loc",
    "location",
    "cust",
    "customer",
    "dell_customer",
    "issue",
    "rc",
    "rcsub",
    "factory",
    "factory_code",
    "location_id",
    "pallet",
    "status", // add any others you consider “field chips”
  ]);
  const vals = new Set();
  for (const { key, value } of tokens) {
    if (fieldKeys.has(key)) vals.add(upper(value));
  }
  return vals;
}

// ---------- client-side set ops ----------
const byTag = (rows) => new Map(rows.map((r) => [r.service_tag, r]));
const union = (a, b) => new Map([...a, ...b]);
const intersect = (a, b) => {
  const m = new Map();
  for (const [k, v] of a) if (b.has(k)) m.set(k, v);
  return m;
};
const difference = (a, needles) => {
  if (!needles?.length) return a;
  const out = new Map();
  for (const [k, v] of a) {
    const hay = upper(
      [
        v.service_tag,
        v.issue,
        v.dpn,
        v.dell_customer,
        v.location,
        v.factory_code,
        v.root_cause,
        v.root_cause_sub_category,
        ...(Array.isArray(v.__notes) ? v.__notes : []), // 👈 include notes
      ].join(" ")
    );
    if (!needles.some((n) => hay.includes(upper(n)))) out.set(k, v);
  }
  return out;
};

export default function SmartSearchBar() {
  const [q, setQ] = useState("");
  const qDebounced = useDebounced(q, 200);
  const parsed = useMemo(() => parseQuery(qDebounced), [qDebounced]);
  const inputRef = useRef(null);

  // NEW: values covered by "field chips" (ppid:, dpn:, etc.)
  const coveredValues = useMemo(
    () => valuesCoveredByFieldTokens(parsed.tokens || []),
    [parsed]
  );

  // NEW: free-text terms that aren't already covered by field chips
  const { ANDforFilter, ORforFilter } = useMemo(() => {
    const AND = (parsed.textAND || []).filter(
      (t) => !coveredValues.has(upper(t))
    );
    const OR = (parsed.textOR || []).map((g) =>
      g.filter((t) => !coveredValues.has(upper(t)))
    );
    return { ANDforFilter: AND, ORforFilter: OR };
  }, [parsed, coveredValues]);

  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState([]);

  const focusedRef = useRef(false);
  useEffect(() => {
    focusedRef.current = focused;
  }, [focused]);

  // hooks
  const _fetchSystems = useSystemsFetch();
  const _fetchHistory = useHistoryFetch();
  const api = useApi();

  // Use the same AND/OR for gating the search
  const shouldSearch = useMemo(() => {
    return (
      (parsed.tokens && parsed.tokens.length > 0) ||
      ANDforFilter.join(" ").trim().length >= 2 ||
      ORforFilter.length > 0
    );
  }, [parsed, ANDforFilter, ORforFilter]);

  const needles = useMemo(() => {
    const { tokens, textAND, textOR } = parsed;
    return [
      ...(textAND || []),
      ...(textOR?.flat?.() || []),
      ...(tokens || [])
        .filter((t) => !["before", "after", "on"].includes(t.key))
        .map((t) => t.value),
    ].filter(Boolean);
  }, [parsed]);

  // keep latest functions in refs
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

  // ignore stale async completions
  const seqRef = useRef(0);

  useEffect(() => {
    const fetchSystems = fetchSystemsRef.current;
    const fetchHistory = fetchHistoryRef.current;
    const getPallets = getPalletsRef.current;
    const seq = ++seqRef.current;

    if (!shouldSearch) {
      setRows([]);
      setOpen(false);
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      setLoading(true);
      try {
        const { tokens } = parsed;

        // these now exist because they’re defined inside the component
        const uniqAND = [...new Set(ANDforFilter)].sort(
          (a, b) => b.length - a.length
        );
        const uniqOR = ORforFilter.map((g) =>
          [...new Set(g)].sort((a, b) => b.length - a.length).slice(0, 5)
        );

        const fieldLeaves = flatSystemLeavesFromTokens(tokens);
        const baseSet = fieldLeaves.length
          ? await fetchSystems({
              page: 1,
              page_size: 50,
              sort_by: "date_modified",
              sort_order: "desc",
              filters: { op: "AND", conditions: fieldLeaves },
            }).then((r) => r?.data || r || [])
          : [];

        let textSetMap = null;
        if (!fieldLeaves.length && uniqAND.length && baseSet.length === 0) {
          for (const term of uniqAND) {
            const chunk = await fetchSystems({
              page: 1,
              page_size: 50,
              sort_by: "date_modified",
              sort_order: "desc",
              search: term,
            }).then((r) => r?.data || r || []);
            const chunkMap = byTag(chunk);
            textSetMap = textSetMap
              ? intersect(textSetMap, chunkMap)
              : chunkMap;
            if (seq !== seqRef.current || cancelled) return;
          }
        }

        let orMap = null;
        for (const group of uniqOR) {
          let groupMap = new Map();
          for (const term of group) {
            const chunk = await fetchSystems({
              page: 1,
              page_size: 50,
              sort_by: "date_modified",
              sort_order: "desc",
              search: term,
            }).then((r) => r?.data || r || []);
            groupMap = union(groupMap, byTag(chunk));
          }
          orMap = orMap ? intersect(orMap, groupMap) : groupMap;
          if (seq !== seqRef.current || cancelled) return;
        }

        const histLeaves = flatHistoryLeaves(tokens);
        // Build date conditions (same as flatHistoryLeaves but only the date parts)
        const dateConds = [];
        const before = tokens.find((t) => t.key === "before");
        const after = tokens.find((t) => t.key === "after");
        const on = tokens.find((t) => t.key === "on");
        if (on) {
          dateConds.push({
            field: "changed_at",
            values: [`${on.value}T00:00:00Z`],
            op: ">=",
          });
          dateConds.push({
            field: "changed_at",
            values: [`${on.value}T23:59:59Z`],
            op: "<=",
          });
        } else {
          if (after)
            dateConds.push({
              field: "changed_at",
              values: [`${after.value}T00:00:00Z`],
              op: ">=",
            });
          if (before)
            dateConds.push({
              field: "changed_at",
              values: [`${before.value}T23:59:59Z`],
              op: "<=",
            });
        }

        // 1) explicit note:/date chips (your existing path)
        const fromNoteTokens =
          histLeaves.length > 0
            ? (async () => {
                const hr = await fetchHistory({
                  page: 1,
                  page_size: 200,
                  sort_by: "changed_at",
                  sort_order: "desc",
                  filters: { op: "AND", conditions: histLeaves },
                });
                return groupNotesByTag(hr?.data || []); // Map(tag -> [notes])
              })()
            : new Map();

        // 2) free-text AND terms in notes
        const notesAND =
          ANDforFilter.length > 0
            ? fetchNotesAND(fetchHistory, ANDforFilter, dateConds)
            : { tagSet: new Set(), noteMap: new Map() };

        // 3) free-text OR groups in notes
        const notesOR =
          (ORforFilter.flat?.() || []).length > 0
            ? fetchNotesOR(fetchHistory, ORforFilter, dateConds)
            : { tagSet: new Set(), accMap: new Map() };

        const { noteMap: andNoteMap, tagSet: andTags } = await notesAND;
        const { accMap: orNoteMap, tagSet: orTags } = await notesOR;

        const noteTokenMap = await fromNoteTokens; // Map

        // Merge all note maps: explicit note:, AND, OR
        const notesByTag = new Map(noteTokenMap); // clone
        for (const [t, arr] of andNoteMap) {
          notesByTag.set(t, [...(notesByTag.get(t) || []), ...arr]);
        }
        for (const [t, arr] of orNoteMap ?? new Map()) {
          notesByTag.set(t, [...(notesByTag.get(t) || []), ...arr]);
        }

        // Tag set for systems fetch (combine all note-discovered tags)
        const tagsFromNotes = new Set([
          ...notesByTag.keys(),
          ...andTags, // (redundant if andNoteMap is complete, but harmless)
          ...orTags,
        ]);

        // If we have any note tags, fetch those systems once
        const noteSystems =
          tagsFromNotes.size > 0
            ? await fetchSystems({
                page: 1,
                page_size: 200,
                sort_by: "date_modified",
                sort_order: "desc",
                filters: {
                  op: "AND",
                  conditions: [
                    {
                      field: "service_tag",
                      values: Array.from(tagsFromNotes),
                      op: "IN",
                    },
                  ],
                },
              }).then((r) => r?.data || [])
            : [];

        const palParams = {};
        tokens.forEach(({ key, value }) => {
          if (key === "pallet") palParams.pallet_number = value;
          if (key === "status") palParams.status = value;
          if (key === "factory") palParams.factory_code = value;
          if (key === "dpn") palParams.dpn = value;
        });
        const fromPallets =
          Object.keys(palParams).length > 0
            ? (async () => {
                const res = getPallets
                  ? await getPallets(palParams)
                  : await fetch(
                      `${
                        import.meta.env.VITE_BACKEND_URL
                      }/pallets?${new URLSearchParams(palParams)}`
                    ).then((r) => r.json());
                const pallets = res?.data || res || [];
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
                );
                if (!tags.length) return [];
                const sr = await fetchSystems({
                  page: 1,
                  page_size: 100,
                  sort_by: "date_modified",
                  sort_order: "desc",
                  filters: {
                    op: "AND",
                    conditions: [
                      { field: "service_tag", values: tags, op: "IN" },
                    ],
                  },
                });
                return sr?.data || [];
              })()
            : [];

        const palletRows = await fromPallets;

        let merged = new Map();
        if (baseSet.length) merged = union(merged, byTag(baseSet));
        if (textSetMap)
          merged = merged.size ? intersect(merged, textSetMap) : textSetMap;
        if (orMap) merged = merged.size ? intersect(merged, orMap) : orMap;

        // NEW: add note-discovered systems
        if (noteSystems.length) merged = union(merged, byTag(noteSystems));

        if (palletRows?.length) merged = union(merged, byTag(palletRows));

        // Attach notes to each merged row so negatives/ranking can see them
        for (const [tag, row] of merged) {
          row.__notes = notesByTag.get(tag) || [];
        }

        merged = applyBooleanFilter(
          merged,
          ANDforFilter || [],
          ORforFilter || [],
          parsed.negatives || []
        );
        const needleU = needles.map(upper);

        const ranked = Array.from(merged.values())
          .map((s) => {
            let score = 0;
            const tag = upper(s.service_tag);
            const notesJoined = upper((s.__notes || []).join(" || "));
            needleU.forEach((N) => {
              if (tag === N) score += 5;
              else if (tag.includes(N)) score += 2;
              if (upper(s.issue || "").includes(N)) score += 1.5;
              if (upper(s.location || "").includes(N)) score += 1;
              if (notesJoined.includes(N)) score += 1.25; // 👈 small bonus for note hits
            });
            if (s.date_modified)
              score += 0.000001 * new Date(s.date_modified).getTime();
            return { s, score };
          })
          .sort((a, b) => b.score - a.score)
          .map((x) => x.s)
          .slice(0, 50);

        if (!cancelled && seq === seqRef.current) {
          setRows((prev) => {
            if (
              prev.length === ranked.length &&
              prev.every((p, i) => p.service_tag === ranked[i].service_tag)
            ) {
              return prev;
            }
            return ranked;
          });

          // 👇 auto-open if input is focused and we have results
          if (focusedRef.current && ranked.length) setOpen(true);
        }
      } finally {
        if (!cancelled && seq === seqRef.current) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [parsed, shouldSearch, ANDforFilter, ORforFilter]);

  return (
    <div className="relative">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        ref={inputRef}
        onFocus={() => {
          setFocused(true);
          if (rows.length) setOpen(true); // immediate open if we already have rows
        }}
        onBlur={() => {
          setFocused(false);
          setTimeout(() => setOpen(false), 120);
        }}
        placeholder={`Search units (e.g., bianca OR "fan fail" -test dpn:KR7T5 note:Bianca before:2025-01-01 pallet:PAL-123)`}
        className="w-full border rounded-lg px-3 py-2 text-sm"
      />

      {open && (
        <div
          className="absolute z-20 mt-1 w-full bg-white border rounded-lg shadow-lg max-h-72 overflow-auto"
          onMouseDown={(e) => e.preventDefault()}
        >
          {rows.length === 0 && loading && (
            <div className="px-3 py-2 text-xs text-gray-500">Searching…</div>
          )}
          {rows.length > 0 ? (
            rows.map((s) => (
              <Link
                key={s.service_tag}
                to={`/${encodeURIComponent(s.service_tag)}`}
                className="block px-3 py-2 text-sm hover:bg-gray-50"
                onClick={() => {
                  setOpen(false);
                  setFocused(false);
                  inputRef.current?.blur();
                }}
              >
                <div className="font-medium text-gray-800">
                  {highlight(s.service_tag, needles)}
                </div>
                <div className="text-gray-600">
                  {highlight(s.issue || "", needles)}
                </div>

                {/* 👇 show first matching note */}
                {Array.isArray(s.__notes) && s.__notes.length > 0 && (
                  <div className="text-gray-600 text-xs line-clamp-2">
                    {highlight(s.__notes[0], needles)}
                  </div>
                )}

                <div className="text-gray-500 text-xs">
                  DPN {highlight(s.dpn || "", needles)} ·{" "}
                  {highlight(s.location || "", needles)} ·{" "}
                  {highlight(s.dell_customer || "", needles)}
                </div>
              </Link>
            ))
          ) : !loading ? (
            <div className="px-3 py-2 text-xs text-gray-400">No matches.</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
