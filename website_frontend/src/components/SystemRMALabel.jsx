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
    left: 85,
    top: 27,
    width: 45,
    height: 45,
  },
  rma_text: {
    position: "absolute",
    left: 5,
    top: 3,
    width: 300, // slight reduction to avoid overlap
    fontSize: 14,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  pallet_text: {
    position: "absolute",
    left: 7,
    top: 20,
    width: 300, // slight reduction to avoid overlap
    fontSize: 10,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  dpn_text: {
    position: "absolute",
    left: 7,
    top: 31,
    width: 300, // slight reduction to avoid overlap
    fontSize: 10,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  factory_text: {
    position: "absolute",
    left: 7,
    top: 42,
    width: 300, // slight reduction to avoid overlap
    fontSize: 10,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  st_text: {
    position: "absolute",
    left: 5,
    top: 55,
    width: 300, // slight reduction to avoid overlap
    fontSize: 14,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
});

const SystemRMALabel = ({ systems }) => {
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
              <Image style={styles.qr} src={qrDataUrl} />
              <Text style={styles.rma_text}>Wistron RMA</Text>
              <Text style={styles.pallet_text}>{system.pallet_number}</Text>
              <Text style={styles.dpn_text}>DPN: {system.dpn}</Text>
              <Text style={styles.factory_text}>
                LOC: {system.factory_code}
              </Text>
              <Text style={styles.st_text}>{system.service_tag}</Text>
            </View>
          </Page>
        );
      })}
    </Document>
  );
};

export default SystemRMALabel;
