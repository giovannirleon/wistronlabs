import QRCode from "qrcode";

export const generateQRPNG = async (value) => {
  const dataUrl = await QRCode.toDataURL(value, { width: 256 });
  return dataUrl; // PNG data:image/png;base64,...
};
