import React from "react";
import {
  Document,
  Page,
  View,
  Text,
  Image,
  StyleSheet,
} from "@react-pdf/renderer";
import { generateQRPNG } from "../utils/generateQR";

const LABEL_WIDTH = 144;
const LABEL_HEIGHT = 72;
const SCALE = 0.9;
const S = (n) => Math.round(n * SCALE * 100) / 100; // neat rounding

const styles = StyleSheet.create({
  // Make the page act like a centering canvas
  page: {
    padding: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  // Full-size canvas so we can center the scaled label in it
  canvas: {
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  // Scaled label box (same relative layout, smaller absolute size)
  label: {
    width: S(LABEL_WIDTH),
    height: S(LABEL_HEIGHT),
    position: "relative",
  },

  // --- scaled children ---
  qr: {
    position: "absolute",
    left: S(75),
    top: S(0),
    width: S(70),
    height: S(70),
  },
  text: {
    position: "absolute",
    left: S(7),
    top: S(13),
    width: S(80),
    fontSize: S(13),
    fontFamily: "Helvetica",
    fontWeight: "bold",
    letterSpacing: 0.5, // keep tracking as-is (non-px; okay to leave)
    lineHeight: 1.3, // unitless line-height is fine
    color: "#111827",
  },
  wistron_wrap: {
    position: "absolute",
    left: S(7),
    top: S(27),
    width: S(66),
    height: S(12),
    overflow: "hidden",
  },
  issue_text: {
    fontSize: S(10),
    fontFamily: "Helvetica",
    fontWeight: "light",
    letterSpacing: 0.2,
    lineHeight: 1.2,
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  dpn_text: {
    position: "absolute",
    left: S(7),
    top: S(40),
    width: S(95),
    fontSize: S(7),
    fontFamily: "Helvetica",
    lineHeight: 1.2,
  },
  dell_customer_text: {
    position: "absolute",
    left: S(7),
    top: S(48),
    width: S(70),
    fontSize: S(7),
    fontFamily: "Helvetica",
    lineHeight: 1.2,
  },
  note_text: {
    position: "absolute",
    left: S(7),
    top: S(50),
    width: S(70),
    fontSize: S(7),
    fontFamily: "Helvetica",
    lineHeight: 1.2,
  },
});

const SystemPDFLabel = ({ systems }) => {
  return (
    <Document>
      {systems.map((system, index) => {
        const qrDataUrl = generateQRPNG(system.url);
        return (
          <Page
            key={index}
            size={{ width: LABEL_WIDTH, height: LABEL_HEIGHT }}
            style={styles.page}
          >
            <View style={styles.canvas}>
              <View style={styles.label}>
                <Text style={styles.text}>{system.service_tag}</Text>

                <View style={styles.wistron_wrap}>
                  <Text style={styles.issue_text}>{system.issue}</Text>
                </View>

                <Text style={styles.dpn_text}>
                  {system.dpn} - Config {system.config}
                </Text>

                <Text style={styles.dell_customer_text}>
                  {system.dell_customer}
                </Text>

                <Image style={styles.qr} src={qrDataUrl} />
              </View>
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

export default SystemPDFLabel;
