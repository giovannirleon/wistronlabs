// src/components/SystemPendingPartsLabel.jsx
import React from "react";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";

const LABEL_WIDTH = 144;
const LABEL_HEIGHT = 72;

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
  card: {
    width: LABEL_WIDTH - 8, // small padding so text doesn’t hug edges
    height: LABEL_HEIGHT - 8,
    padding: 6,
    //border: 1,
    //borderColor: "#111827",
    //borderRadius: 2,
    justifyContent: "flex-start",
  },
  title: {
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    textAlign: "center",
    marginBottom: 4,
  },
  item: {
    fontFamily: "Helvetica",
    fontSize: 8,
    lineHeight: 1.2,
    marginBottom: 1.5,
  },
  empty: {
    fontFamily: "Helvetica-Oblique",
    fontSize: 8,
    textAlign: "center",
    marginTop: 8,
  },
});

const SystemPendingPartsLabel = ({ parts = [] }) => {
  const names = (parts || [])
    .map((p) => (p || "").toString().trim())
    .filter(Boolean);

  return (
    <Document>
      <Page
        size={{ width: LABEL_WIDTH, height: LABEL_HEIGHT }}
        style={styles.page}
      >
        <View style={styles.canvas}>
          <View style={styles.card}>
            <Text style={styles.title}>Pending Parts</Text>
            {names.length ? (
              names.map((name, i) => (
                <Text key={i} style={styles.item}>
                  • {name}
                </Text>
              ))
            ) : (
              <Text style={styles.empty}>No parts listed</Text>
            )}
          </View>
        </View>
      </Page>
    </Document>
  );
};

export default SystemPendingPartsLabel;
