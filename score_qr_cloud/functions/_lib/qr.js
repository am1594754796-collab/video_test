import { renderSVG } from "./uqr.mjs";

export function qrSvg(text, moduleSize = 4) {
  return renderSVG(text, {
    ecc: "L",
    pixelSize: moduleSize,
    whiteColor: "#ffffff",
    blackColor: "#000000",
  });
}
