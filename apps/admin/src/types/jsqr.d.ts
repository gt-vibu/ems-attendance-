// jsqr ships no TypeScript definitions and no @types/jsqr package exists —
// this is the minimal ambient shape this app actually uses.
declare module 'jsqr' {
  export interface QRCodePoint {
    x: number;
    y: number;
  }

  export interface QRCodeLocation {
    topRightCorner: QRCodePoint;
    topLeftCorner: QRCodePoint;
    bottomRightCorner: QRCodePoint;
    bottomLeftCorner: QRCodePoint;
  }

  export interface QRCode {
    binaryData: number[];
    data: string;
    chunks: unknown[];
    version: number;
    location: QRCodeLocation;
  }

  export interface Options {
    inversionAttempts?: 'dontInvert' | 'onlyInvert' | 'attemptBoth' | 'invertFirst';
  }

  export default function jsQR(
    data: Uint8ClampedArray,
    width: number,
    height: number,
    options?: Options
  ): QRCode | null;
}
