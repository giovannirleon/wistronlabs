// utils/enrichPalletWithBarcodes.js
import { generateBarcodePNG } from "./generateBarcode";

export const enrichPalletWithBarcodes = (pallet) => {
  return {
    ...pallet,
    systems: pallet.systems.map((sys) => {
      const safeServiceTag = sys.service_tag?.trim() || "MISSING-ST";
      const safePPID = sys.ppid?.trim() || "MISSING-PPID";

      return {
        ...sys,
        service_tag: safeServiceTag,
        ppid: safePPID,
        service_tag_barcode: generateBarcodePNG(safeServiceTag),
        ppid_barcode: generateBarcodePNG(safePPID),
      };
    }),
  };
};
