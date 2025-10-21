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

// helper: "…ABCDEFGH" -> "AB CD EF GH"
const formatLast8AsPairs = (s = "") => {
  if (s.length < 8) return { head: s, paired: "" };
  const head = s.slice(0, -8);
  const tail = s.slice(-8);
  const pairs = tail.match(/.{1,2}/g) || [tail];
  return { head, paired: pairs.join(" ") }; // plain spaces
};

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
    left: 91,
    top: 27,
    width: 45,
    height: 45,
  },
  rma_text: {
    position: "absolute",
    left: 7,
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
    top: 35,
    width: 300, // slight reduction to avoid overlap
    fontSize: 8,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  factory_text: {
    position: "absolute",
    left: 7,
    top: 45,
    width: 80, // slight reduction to avoid overlap
    fontSize: 8,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.2,
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
  pallet_pairs: {
    letterSpacing: 0, // keep pairs tight
    wordSpacing: 1.5, // small space between pairs (tweak 1.0–3.0)
  },
});

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
