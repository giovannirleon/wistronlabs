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
    top: 13,
    width: 80, // slight reduction to avoid overlap
    fontSize: 13,
    fontFamily: "Helvetica", // modern sans-serif look
    fontWeight: "bold",
    letterSpacing: 0.5,
    lineHeight: 1.3,
    color: "#111827", // gray-900
  },
  wistron_wrap: {
    position: "absolute",
    left: 7,
    top: 27,
    width: 66, // 75 (qr left) - 7 (this left) - a little padding
    height: 12, // one line tall
    overflow: "hidden",
  },
  issue_text: {
    fontSize: 10,
    fontFamily: "Helvetica",
    fontWeight: "light",
    letterSpacing: 0.2,
    lineHeight: 1.2,
    // Truncate instead of wrapping:
    maxLines: 1,
    textOverflow: "ellipsis",
  },
  dpn_text: {
    position: "absolute",
    left: 7,
    top: 40,
    width: 95, // enough room for DPN + sep + config
    fontSize: 7,
    fontFamily: "Helvetica",
    lineHeight: 1.2,
  },
  dell_customer_text: {
    position: "absolute",
    left: 7,
    top: 48,
    width: 70, // enough room for DPN + sep + config
    fontSize: 7,
    fontFamily: "Helvetica",
    lineHeight: 1.2,
  },
  note_text: {
    position: "absolute",
    left: 7,
    top: 50,
    width: 70, // enough room for DPN + sep + config
    fontSize: 7,
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
          </Page>
        );
      })}
    </Document>
  );
};

export default SystemPDFLabel;
