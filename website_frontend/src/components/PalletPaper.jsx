// PalletPaper.jsx
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Image,
} from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: {
    padding: 40,
    fontFamily: "Helvetica",
    fontSize: 10,
    color: "#111827",
  },
  line: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  tableHeader: {
    flexDirection: "row",
    borderBottom: "1 solid #ccc",
    paddingBottom: 4,
    marginTop: 12,
  },
  headerCell: {
    flex: 1,
    fontWeight: "bold",
  },
  row: {
    flexDirection: "row",
    marginBottom: 10,
  },
  cell: {
    flex: 1,
  },
  ppid_barcode: {
    marginTop: 2,
    marginBottom: 4,
    width: 200,
    height: 35,
  },
  doa_barcode: {
    marginTop: 2,
    marginBottom: 4,
    width: 200,
    height: 20,
  },
  dpn_barcode: {
    marginTop: 2,
    marginBottom: 4,
    width: 80,
    height: 20,
  },
  st_barcode: {
    marginTop: 2,
    marginBottom: 4,
    width: 120,
    height: 35,
  },
  // Add these below existing styles
  headerCellST: {
    flex: 1, // 1/3
    fontWeight: "bold",
  },
  headerCellPPID: {
    flex: 2, // 2/3
    fontWeight: "bold",
  },
  cellST: {
    flex: 1, // 1/3
  },
  cellPPID: {
    flex: 2, // 2/3
  },
  titleBlock: {
    alignItems: "center", // centers children horizontally
    marginBottom: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 6,
  },
  title_barcode: {
    width: 300,
    height: 40,
    // alignSelf ensures centering even outside a centered container
    alignSelf: "center",
  },
});

const PalletPaper = ({ pallet }) => {
  return (
    <Document>
      <Page style={styles.page}>
        <View style={styles.titleBlock}>
          <Text style={styles.title}>{pallet.pallet_number}</Text>
          {pallet.pallet_number_barcode && (
            <Image
              src={pallet.pallet_number_barcode}
              style={styles.title_barcode}
            />
          )}
        </View>
        <View style={styles.line}>
          <Text>DOA #: {pallet.doa_number}</Text>
          <Text>Released: {pallet.date_released}</Text>
        </View>
        <View style={styles.line}>
          <Image src={pallet.pallet_doa_barcode} style={styles.doa_barcode} />
        </View>
        <View style={styles.line}>
          <Text>DPN: {pallet.dpn}</Text>
          <Text>Destination: {pallet.factory_id}</Text>
        </View>
        <View style={styles.line}>
          <Image src={pallet.pallet_dpn_barcode} style={styles.dpn_barcode} />
        </View>
        <View style={styles.tableHeader}>
          <Text style={styles.headerCellST}>Service Tag</Text>
          <Text style={styles.headerCellPPID}>PPID</Text>
        </View>
        {pallet.systems.map((sys, idx) => (
          <View key={idx} style={styles.row}>
            <View style={styles.cellST}>
              <Text>{sys.service_tag}</Text>
              <Image src={sys.service_tag_barcode} style={styles.st_barcode} />
            </View>
            <View style={styles.cellPPID}>
              <Text>{sys.ppid}</Text>
              <Image src={sys.ppid_barcode} style={styles.ppid_barcode} />
            </View>
          </View>
        ))}
      </Page>
    </Document>
  );
};

export default PalletPaper;
