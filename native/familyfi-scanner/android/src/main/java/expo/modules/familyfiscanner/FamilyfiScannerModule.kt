package expo.modules.familyfiscanner

import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.codescanner.GmsBarcodeScannerOptions
import com.google.mlkit.vision.codescanner.GmsBarcodeScanning
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Google's code scanner (Google Play services): the system's full-screen QR scanner, which needs no
 * camera permission, as Android's counterpart to VisionKit on iOS. `scan` resolves the code, or null
 * when the person backs out.
 */
class FamilyfiScannerModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("FamilyfiScanner")

    AsyncFunction("scan") { promise: Promise ->
      val activity = appContext.currentActivity
      if (activity == null) {
        promise.reject("E_NO_ACTIVITY", "FamilyFi is not in the foreground.", null)
        return@AsyncFunction
      }
      val options = GmsBarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .enableAutoZoom()
        .build()
      GmsBarcodeScanning.getClient(activity, options).startScan()
        .addOnSuccessListener { barcode -> promise.resolve(barcode.rawValue) }
        .addOnCanceledListener { promise.resolve(null) }
        .addOnFailureListener { error -> promise.reject("E_SCAN", error.message ?: "Scanning failed.", error) }
    }
  }
}
