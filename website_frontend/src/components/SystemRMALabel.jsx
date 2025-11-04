import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
  Svg,
  Path,
  Circle,
} from "@react-pdf/renderer";
import { generateQRPNG } from "../utils/generateQR";

const LABEL_WIDTH = 144;
const LABEL_HEIGHT = 72;

// helper: "…ABCDEFGH" -> "AB CD EF GH"
const formatLast8AsPairs = (s = "") => {
  if (s.length < 8) return { head: s, paired: "" };
  const head = s.slice(0, -8);
  const tail = s.slice(-8);
  const pairs = tail.match(/.{1,2}/g) || [tail];
  return { head, paired: pairs.join(" ") };
};

const styles = StyleSheet.create({
  page: { padding: 0 },
  label: { width: LABEL_WIDTH, height: LABEL_HEIGHT, position: "relative" },
  qr: { position: "absolute", left: 91, top: 27, width: 45, height: 45 },
  rma_text: {
    position: "absolute",
    left: 7,
    top: 3,
    width: 300,
    fontSize: 14,
    fontFamily: "Helvetica",
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827",
  },
  pallet_text: {
    position: "absolute",
    left: 7,
    top: 20,
    width: 300,
    fontSize: 10,
    fontFamily: "Helvetica",
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827",
  },
  dpn_text: {
    position: "absolute",
    left: 7,
    top: 35,
    width: 300,
    fontSize: 8,
    fontFamily: "Helvetica",
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827",
  },
  factory_text: {
    position: "absolute",
    left: 7,
    top: 45,
    width: 80,
    fontSize: 8,
    fontFamily: "Helvetica",
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.2,
    color: "#111827",
  },
  shapeBadge: {
    position: "absolute",
    right: 4,
    top: 4,
  },
  pallet_pairs: { letterSpacing: 0, wordSpacing: 1.5 },
});

/** ---------- Shape rendering helpers (PDF-safe via <Svg/>) ---------- **/

const BASE_SHAPES = new Set([
  "star",
  "triangle_up",
  "triangle_right",
  "triangle_left",
  "triangle_down",
  "circle",
  "square",
  "diamond",
  "pentagon",
  "hexagon",
]);

const hash = (s = "") => {
  let h = 2166136261; // FNV-1a-ish
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

// regular polygon as SVG path
function polygonPath(cx, cy, r, sides, rotationDeg = 0) {
  const rad = Math.PI / 180;
  let d = "";
  for (let i = 0; i < sides; i++) {
    const a = (rotationDeg + i * (360 / sides)) * rad;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  d += " Z";
  return d;
}

// classic 5-point star
function starPath(cx, cy, rOuter, rInner, rotationDeg = -90) {
  const rad = Math.PI / 180;
  let d = "";
  for (let i = 0; i < 10; i++) {
    const angle = (rotationDeg + i * 36) * rad;
    const r = i % 2 === 0 ? rOuter : rInner;
    const x = cx + r * Math.cos(angle);
    const y = cy + r * Math.sin(angle);
    d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  d += " Z";
  return d;
}

function ShapeBadge({ shape, palletNumber, size = 18 }) {
  // normalize (e.g., "star-2" -> "star")
  const base = (shape || "").toLowerCase().split("-")[0];

  // SVG viewport
  const W = size,
    H = size;
  const cx = W / 2,
    cy = H / 2;
  const strokeW = 1;

  // Preferred stroke fill for thermal clarity
  const stroke = "#111827"; // gray-900
  const fill = "#111827";

  let content = null;

  switch (base) {
    case "star": {
      const d = starPath(cx, cy, W / 2 - 1, (W / 2) * 0.45);
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "triangle_up": {
      const d = polygonPath(cx, cy + 1, W / 2 - 1, 3, -90);
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "triangle_right": {
      const d = polygonPath(cx - 1, cy, W / 2 - 1, 3, 0);
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "triangle_left": {
      const d = polygonPath(cx + 1, cy, W / 2 - 1, 3, 180);
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "triangle_down": {
      const d = polygonPath(cx, cy - 1, W / 2 - 1, 3, 90);
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "circle": {
      content = <Circle cx={cx} cy={cy} r={W / 2 - 1} fill={fill} />;
      break;
    }
    case "square": {
      const d = polygonPath(cx, cy, W / 2 - 1, 4, 45); // axis-aligned looks like diamond; rotate 45 to look square on label
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "diamond": {
      const d = polygonPath(cx, cy, W / 2 - 1, 4, 0); // 0deg => diamond (pointing up)
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "pentagon": {
      const d = polygonPath(cx, cy, W / 2 - 1, 5, -90);
      content = <Path d={d} fill={fill} />;
      break;
    }
    case "hexagon": {
      const d = polygonPath(cx, cy, W / 2 - 1, 6, 0);
      content = <Path d={d} fill={fill} />;
      break;
    }
    default: {
      // Fallback: generate a deterministic N-gon (7..12 sides) + rotation from palletNumber or shape string
      const seed = hash((palletNumber || "") + "|" + (shape || ""));
      const sides = 7 + (seed % 6); // 7..12
      const rotation = (seed >>> 8) % 360;
      const d = polygonPath(cx, cy, W / 2 - 1, sides, rotation);
      content = <Path d={d} fill={fill} />;
      break;
    }
  }

  return (
    <View style={[styles.shapeBadge, { width: W, height: H }]}>
      <Svg width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {content}
      </Svg>
    </View>
  );
}

const SystemRMALabel = ({ systems }) => {
  return (
    <Document>
      {systems.map((system, index) => {
        const qrDataUrl = generateQRPNG(system.url);
        const pn = system.pallet_number || "";
        const { head, paired } = formatLast8AsPairs(pn);

        return (
          <Page
            key={index}
            size={{ width: LABEL_WIDTH, height: LABEL_HEIGHT }}
            style={styles.page}
          >
            <View style={styles.label}>
              {/* Shape badge (uses backend-provided system.shape) */}
              <ShapeBadge shape={system.shape} palletNumber={pn} size={18} />

              <Image style={styles.qr} src={qrDataUrl} />
              <Text style={styles.rma_text}>RMA - {system.service_tag}</Text>

              <Text style={styles.pallet_text}>
                {head}
                <Text style={styles.pallet_pairs}>{paired}</Text>
              </Text>

              <Text style={styles.dpn_text}>
                {system.dpn} - Config {system.config}
              </Text>

              <Text style={styles.factory_text}>{system.dell_customer}</Text>
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

export default SystemRMALabel;
