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
} from "@react-pdf/renderer";

const LABEL_WIDTH = 144;
const LABEL_HEIGHT = 72;
const SCALE = 1;
const S = (n) => Math.round(n * SCALE * 100) / 100;

const styles = StyleSheet.create({
  page: {
    padding: 0,
    justifyContent: "center",
    alignItems: "center",
  },
  canvas: {
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT,
    justifyContent: "center",
    alignItems: "center",
  },
  label: {
    width: S(LABEL_WIDTH),
    height: S(LABEL_HEIGHT),
    position: "relative",
  },

  // ✅ Top-right corner of the page/label
  checkWrap: {
    position: "absolute",
    top: S(10),
    right: S(10),
    width: S(20),
    height: S(20),
  },

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
    width: S(300),
    fontSize: S(13),
    fontFamily: "Helvetica",
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827",
  },
  wistron_wrap: {
    position: "absolute",
    left: S(7),
    top: S(27),
    width: S(300),
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
    width: S(300),
    fontSize: S(7),
    fontFamily: "Helvetica",
    lineHeight: 1.2,
  },
});

const SystemPDFLabel = ({ systems }) => (
  <Document>
    {systems.map((system, index) => (
      <Page
        key={index}
        size={{ width: LABEL_WIDTH, height: LABEL_HEIGHT }}
        style={styles.page}
      >
        <View style={styles.canvas}>
          <View style={styles.label}>
            {/* ✅ Vector checkmark */}
            <View style={styles.checkWrap}>
              <Svg viewBox="0 0 24 24" width="100%" height="100%">
                <Path
                  d="M20 6L9 17l-5-5"
                  stroke="#111827"
                  strokeWidth={2}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </Svg>
            </View>

            <Text style={styles.text}>{system.service_tag}</Text>
            <View style={styles.wistron_wrap}>
              <Text style={styles.issue_text}>Passed L10</Text>
            </View>
            <Text style={styles.dpn_text}>
              {system.dpn} - Config {system.config}
            </Text>
            <Text style={styles.dell_customer_text}>
              {system.dell_customer}
            </Text>
          </View>
        </View>
      </Page>
    ))}
  </Document>
);

export default SystemPDFLabel;
