/**
 * The native HTTPS transport for household routes (Swift `URLSession`, Kotlin OkHttp).
 * A pinned route trusts only a leaf certificate whose SPKI SHA-256 equals the pin, with no system
 * evaluation and no hostname check; a system route uses the platform's trust. Redirects are
 * returned, not followed. See familyfi `src/lib/companion-request.ts`.
 */
import { requireNativeModule } from "expo";

import type { DeviceNetwork, TransportRequest, TransportResponse } from "@/lib/companion-request";

type Subscription = { remove(): void };

type NativeTransport = {
  /** The network the device is on now: Wi-Fi (with its subnet as `key`), cellular, or other (a VPN, none). */
  network(): DeviceNetwork;
  /** Each change of network. */
  addListener(event: "onNetwork", listener: (network: DeviceNetwork) => void): Subscription;
  request(request: TransportRequest): Promise<TransportResponse>;
  /** base64url SHA-256 of a DER certificate's SubjectPublicKeyInfo: its pin. For the pin vectors. */
  spkiPin(certificateBase64: string): string;
};

export default requireNativeModule<NativeTransport>("FamilyfiTransport");
