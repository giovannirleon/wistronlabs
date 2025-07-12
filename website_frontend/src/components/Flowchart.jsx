export default function Flowchart({ currentLocation_id, locations }) {
  const layoutMap = [
    { id: 1, x: 0, y: 150 },
    { id: 2, x: 200, y: 150 },
    { id: 5, x: 400, y: 150 },
    { id: 9, x: 600, y: 0 },
    { id: 6, x: 600, y: 100 },
    { id: 8, x: 600, y: 200 },
    { id: 7, x: 600, y: 300 },
    { id: 4, x: 200, y: 50 },
    { id: 3, x: 200, y: 250 },
  ];

  const states = locations
    .map((loc) => {
      const layout = layoutMap.find((l) => l.id === loc.id);
      if (!layout) return null;
      return {
        ...loc,
        x: layout.x,
        y: layout.y,
      };
    })
    .filter(Boolean);

  const arrows = [
    {
      x: 155,
      y: 175,
      stemHeight: 20,
      totalLenth: 40,
      direction: "right",
      ids: [1, 5],
    },
    {
      x: 355,
      y: 175,
      stemHeight: 20,
      totalLenth: 40,
      direction: "right",
      ids: [2],
    },
    {
      x: 225,
      y: 205,
      stemHeight: 20,
      totalLenth: 40,
      direction: "down",
      ids: [2],
    },
    {
      x: 225,
      y: 145,
      stemHeight: 20,
      totalLenth: 40,
      direction: "up",
      ids: [2],
    },
    {
      x: 325,
      y: 245,
      stemHeight: 20,
      totalLenth: 40,
      direction: "up",
      ids: [3],
    },
    {
      x: 325,
      y: 105,
      stemHeight: 20,
      totalLenth: 40,
      direction: "down",
      ids: [4],
    },
    {
      x: 555,
      y: 25,
      stemHeight: 20,
      totalLenth: 40,
      direction: "right",
      ids: [5],
    },
    {
      x: 555,
      y: 125,
      stemHeight: 20,
      totalLenth: 40,
      direction: "right",
      ids: [5],
    },
    {
      x: 555,
      y: 225,
      stemHeight: 20,
      totalLenth: 40,
      direction: "right",
      ids: [5],
    },
    {
      x: 555,
      y: 325,
      stemHeight: 20,
      totalLenth: 40,
      direction: "right",
      ids: [5],
    },
  ];

  const rects = [
    { x: 552, y: 165, width: 4, height: 20, direction: "horizontal", ids: [5] },
    { x: 555, y: 25, width: 295, height: 15, direction: "vertical", ids: [5] },
    { x: 465, y: 205, width: 125, height: 15, direction: "vertical", ids: [5] },
    { x: 155, y: 180, width: 140, height: 15, direction: "vertical", ids: [5] },
    {
      x: 155,
      y: 315,
      width: 315,
      height: 15,
      direction: "horizontal",
      ids: [5],
    },
  ];

  const getFill = (id) => {
    if (id === currentLocation_id) return "url(#activeGradient)";
    return "#f9fafb";
  };

  const getTextColor = (id) => {
    if (id === currentLocation_id) return "#fff";
    return "#111827";
  };

  return (
    <svg
      viewBox="0 0 750 400"
      className="w-full h-auto"
      preserveAspectRatio="xMinYMin meet"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="activeGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#2563eb" />
          <stop offset="100%" stopColor="#1d4ed8" />
        </linearGradient>
        <filter id="boxShadow" x="-20%" y="-20%" width="140%" height="140%">
          <feDropShadow
            dx="1"
            dy="1"
            stdDeviation="1"
            floodColor="#000"
            floodOpacity="0.2"
          />
        </filter>
      </defs>

      {/* Render states */}
      {states.map((state) => (
        <g key={state.id}>
          <rect
            x={state.x}
            y={state.y}
            width="150"
            height="50"
            fill={getFill(state.id)}
            stroke="#d1d5db"
            rx="8"
            ry="8"
            filter={state.id === currentLocation_id ? "url(#boxShadow)" : ""}
          />
          <text
            x={state.x + 75}
            y={state.y + 28}
            textAnchor="middle"
            fontSize="13"
            fill={getTextColor(state.id)}
            fontWeight="600"
          >
            {state.name}
          </text>
        </g>
      ))}

      {/* Render rects */}
      {rects.map((rect, idx) => {
        const baseX = rect.x;
        const baseY = rect.y;

        let w = rect.width ?? 50;
        let h = rect.height ?? 20;

        if (rect.direction === "vertical") {
          [w, h] = [h, w];
        }

        const isActive = rect.ids?.includes(currentLocation_id);
        const fill = isActive ? "#bfdbfe" : "#9ca3af";

        return (
          <rect
            key={idx}
            x={baseX}
            y={baseY}
            width={w}
            height={h}
            fill={fill}
          />
        );
      })}

      {/* Render arrows */}
      {arrows.map((arrow, idx) => {
        const stemThickness = arrow.stemHeight ?? 20;
        const totalLength = arrow.totalLenth ?? 40;
        const direction = arrow.direction ?? "right";

        const headLength = totalLength * 0.4;
        const stemLength = totalLength - headLength;

        const headHeightFactor = 1.8;
        const headHeight = stemThickness * headHeightFactor;

        const cx = arrow.x;
        const cy = arrow.y;

        const isActive = arrow.ids?.includes(currentLocation_id);
        const fill = isActive ? "#bfdbfe" : "#9ca3af";

        let stemX = cx;
        let stemY = cy;
        let stemWidth = 0;
        let stemHeight = 0;
        let points = "";

        if (direction === "right") {
          stemX = cx;
          stemY = cy - stemThickness / 2;
          stemWidth = stemLength + 1;
          stemHeight = stemThickness;

          const headBaseX = cx + stemLength;

          points = `
            ${headBaseX},${cy - headHeight / 2}
            ${headBaseX + headLength},${cy}
            ${headBaseX},${cy + headHeight / 2}
          `;
        } else if (direction === "left") {
          stemX = cx - stemLength - 1;
          stemY = cy - stemThickness / 2;
          stemWidth = stemLength + 1;
          stemHeight = stemThickness;

          const headBaseX = cx - stemLength;

          points = `
            ${headBaseX},${cy - headHeight / 2}
            ${headBaseX - headLength},${cy}
            ${headBaseX},${cy + headHeight / 2}
          `;
        } else if (direction === "down") {
          stemX = cx - stemThickness / 2;
          stemY = cy;
          stemWidth = stemThickness;
          stemHeight = stemLength + 1;

          const headBaseY = cy + stemLength;

          points = `
            ${cx - headHeight / 2},${headBaseY}
            ${cx},${headBaseY + headLength}
            ${cx + headHeight / 2},${headBaseY}
          `;
        } else if (direction === "up") {
          stemX = cx - stemThickness / 2;
          stemY = cy - stemLength - 1;
          stemWidth = stemThickness;
          stemHeight = stemLength + 1;

          const headBaseY = cy - stemLength;

          points = `
            ${cx - headHeight / 2},${headBaseY}
            ${cx},${headBaseY - headLength}
            ${cx + headHeight / 2},${headBaseY}
          `;
        }

        return (
          <g key={idx}>
            <rect
              x={stemX}
              y={stemY}
              width={stemWidth}
              height={stemHeight}
              fill={fill}
            />
            <polygon points={points} fill={fill} />
          </g>
        );
      })}
    </svg>
  );
}
