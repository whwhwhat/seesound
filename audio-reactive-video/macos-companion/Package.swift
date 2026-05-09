// swift-tools-version: 6.1

import PackageDescription

let package = Package(
  name: "SeeSoundCompanion",
  platforms: [
    .macOS(.v13),
  ],
  products: [
    .executable(
      name: "SeeSoundCompanion",
      targets: ["SeeSoundCompanion"]
    ),
  ],
  targets: [
    .executableTarget(
      name: "SeeSoundCompanion"
    ),
  ]
)
