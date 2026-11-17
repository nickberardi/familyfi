/**
 * The platform's own QR scanner for pairing codes: VisionKit's `DataScannerViewController` shown
 * inline on iOS (as familyfi-ios does), and Google's full-screen code scanner on Android.
 */
import { requireNativeModule, requireNativeView } from "expo";
import type { ComponentType } from "react";
import { Platform, type ViewProps } from "react-native";

export type ScannerAvailability = {
  /** The device can scan (VisionKit supports it). */
  supported: boolean;
  cameraAccess: "granted" | "undetermined" | "denied";
};

type NativeScanner = {
  /** iOS. */
  availability(): Promise<ScannerAvailability>;
  /** Android: opens the system scanner; the code, or null when the person backs out. */
  scan(): Promise<string | null>;
};

export default requireNativeModule<NativeScanner>("FamilyfiScanner");

type ScannerViewProps = ViewProps & {
  onCode: (event: { nativeEvent: { code: string } }) => void;
  /** The camera was refused, or scanning stopped being possible; re-read `availability`. */
  onUnavailable?: () => void;
};

/** iOS: the live scanner, which reports the first QR code it reads. (Android has no inline view.) */
export const ScannerView: ComponentType<ScannerViewProps> =
  Platform.OS === "ios" ? requireNativeView<ScannerViewProps>("FamilyfiScanner") : () => null;
