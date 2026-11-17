# ML Kit finds its components through Firebase's ComponentDiscovery, which reads the registrar class
# names from the manifest and creates each one by reflection. R8 in release builds removes their
# no-argument constructors, so ML Kit starts without components and GmsBarcodeScanning.getClient
# throws before the scanner opens. Debug builds are not shrunk, so only release builds break.
-keep class * implements com.google.firebase.components.ComponentRegistrar {
  <init>();
}
