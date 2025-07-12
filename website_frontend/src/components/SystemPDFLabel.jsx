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

const styles = StyleSheet.create({
  page: {
    padding: 0,
  },
  label: {
    width: LABEL_WIDTH,
    height: LABEL_HEIGHT,
    position: "relative",
  },
  qr: {
    position: "absolute",
    left: 75,
    top: 0,
    width: 70,
    height: 70,
  },
  text: {
    position: "absolute",
    left: 7,
    top: 10,
    width: 80, // slight reduction to avoid overlap
    fontSize: 16,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  wistron_text: {
    position: "absolute",
    left: 7,
    top: 30,
    width: 85,
    fontSize: 10,
    fontFamily: "Helvetica",
    fontWeight: "light",
    letterSpacing: 0.2,
    lineHeight: 1.2,
    color: "#6B7280", // gray-500
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
            <View style={styles.label}>
              <Text style={styles.text}>{system.service_tag}</Text>
              <Text style={styles.wistron_text}>TRACKED BY WISTRON</Text>
              <Image style={styles.qr} src={qrDataUrl} />
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

export default SystemPDFLabel;
