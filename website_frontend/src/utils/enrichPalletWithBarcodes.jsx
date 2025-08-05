// utils/enrichPalletWithBarcodes.js
import { generateBarcodePNG } from "./generateBarcode";

export const enrichPalletWithBarcodes = (pallet) => {
  return {
    ...pallet,
    systems: pallet.systems.map((sys) => ({
      ...sys,
      service_tag_barcode: generateBarcodePNG(sys.service_tag),
      ppid_barcode: generateBarcodePNG(sys.ppid),
    })),
  };
};
