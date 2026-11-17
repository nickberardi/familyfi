import AVFoundation
import ExpoModulesCore
import UIKit
import VisionKit

/// The system's QR scanner (VisionKit `DataScannerViewController`), shown inline in the Scan step as
/// familyfi-ios does. Copied from familyfi-ios `App/Features/Setup/PairingCodeScanner.swift` at
/// a1814cc, as an Expo view.
public class FamilyfiScannerModule: Module {
  public func definition() -> ModuleDefinition {
    Name("FamilyfiScanner")

    /// Whether this device can scan, and whether FamilyFi may use the camera.
    AsyncFunction("availability") { () -> [String: Any] in
      let access: String
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized: access = "granted"
      case .notDetermined: access = "undetermined"
      default: access = "denied"
      }
      // Runs on the main queue (below), where VisionKit's main-actor property may be read.
      let supported = MainActor.assumeIsolated { DataScannerViewController.isSupported }
      return ["supported": supported, "cameraAccess": access]
    }.runOnQueue(.main)

    View(FamilyfiScannerView.self) {
      Events("onCode", "onUnavailable")
    }
  }
}

final class FamilyfiScannerView: ExpoView, DataScannerViewControllerDelegate {
  let onCode = EventDispatcher()
  /// The camera was refused, or VisionKit could not scan: the screen re-reads `availability`.
  let onUnavailable = EventDispatcher()
  private var scanner: DataScannerViewController?
  private var accepted = false

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    clipsToBounds = true
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil { start() } else { stop() }
  }

  private func start() {
    guard scanner == nil, DataScannerViewController.isSupported else { return }
    let scanner = DataScannerViewController(
      recognizedDataTypes: [.barcode(symbologies: [.qr])],
      qualityLevel: .balanced,
      recognizesMultipleItems: false,
      isHighFrameRateTrackingEnabled: false,
      isPinchToZoomEnabled: true
    )
    scanner.delegate = self
    let parent = hostViewController()
    parent?.addChild(scanner)
    scanner.view.frame = bounds
    scanner.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    addSubview(scanner.view)
    scanner.didMove(toParent: parent)
    self.scanner = scanner
    // Asks for the camera the first time, as familyfi-ios does, and reports a refusal.
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: begin()
    case .notDetermined:
      AVCaptureDevice.requestAccess(for: .video) { granted in
        DispatchQueue.main.async { [weak self] in granted ? self?.begin() : self?.onUnavailable() }
      }
    default: onUnavailable()
    }
  }

  private func begin() {
    guard let scanner else { return }
    do {
      try scanner.startScanning()
    } catch {
      onUnavailable()
    }
  }

  func dataScanner(_ dataScanner: DataScannerViewController, becameUnavailableWithError error: DataScannerViewController.ScanningUnavailable) {
    onUnavailable()
  }

  private func stop() {
    guard let scanner else { return }
    scanner.stopScanning()
    scanner.willMove(toParent: nil)
    scanner.view.removeFromSuperview()
    scanner.removeFromParent()
    self.scanner = nil
  }

  private func hostViewController() -> UIViewController? {
    var responder: UIResponder? = self
    while let next = responder?.next {
      if let controller = next as? UIViewController { return controller }
      responder = next
    }
    return nil
  }

  func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
    guard !accepted,
          let item = addedItems.first,
          case let .barcode(code) = item,
          let value = code.payloadStringValue else { return }
    accepted = true
    dataScanner.stopScanning()
    onCode(["code": value])
  }
}
