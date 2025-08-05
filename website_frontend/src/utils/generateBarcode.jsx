// utils/generateBarcode.js
import JsBarcode from "jsbarcode";

export const generateBarcodePNG = (text) => {
  const canvas = document.createElement("canvas");
  JsBarcode(canvas, text, {
    format: "CODE128",
    height: 60,
    width: 2.5,
    displayValue: false,
    margin: 0,
  });
  return canvas.toDataURL("image/png");
};
