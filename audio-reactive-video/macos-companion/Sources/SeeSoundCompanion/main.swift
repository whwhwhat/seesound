import AppKit
import CoreMedia
import Network
import ScreenCaptureKit

private let bridgeHttpPort: UInt16 = 43821
private let bridgeWebSocketPort: UInt16 = 43822

struct BridgeStatus: Codable {
  let running: Bool
  let status: String
  let sourceName: String?
  let lastError: String?
}

final class SharedBridgeState {
  private let queue = DispatchQueue(label: "seesound.bridge.state")
  private var status = BridgeStatus(
    running: false,
    status: "Idle. Choose Start Desktop Capture from the menu bar app.",
    sourceName: nil,
    lastError: nil
  )

  func updateStatus(running: Bool, status message: String, sourceName: String? = nil, lastError: String? = nil) {
    queue.sync {
      status = BridgeStatus(
        running: running,
        status: message,
        sourceName: sourceName ?? status.sourceName,
        lastError: lastError
      )
    }
  }

  func currentStatus() -> BridgeStatus {
    queue.sync { status }
  }
}

final class SystemAudioCaptureController: NSObject, SCStreamOutput, SCStreamDelegate {
  private let bridgeState: SharedBridgeState
  private let audioQueue = DispatchQueue(label: "seesound.companion.audio")
  private var stream: SCStream?
  private var pcmBroadcaster: LocalPcmWebSocketServer?
  private(set) var isRunning = false

  init(bridgeState: SharedBridgeState) {
    self.bridgeState = bridgeState
  }

  func setPcmBroadcaster(_ broadcaster: LocalPcmWebSocketServer) {
    pcmBroadcaster = broadcaster
  }

  func startCapture() async throws {
    if isRunning {
      return
    }

    let content = try await SCShareableContent.current
    guard let display = content.displays.first else {
      throw NSError(domain: "SeeSoundCompanion", code: 1001, userInfo: [
        NSLocalizedDescriptionKey: "No shareable display was found for ScreenCaptureKit."
      ])
    }

    let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
    let configuration = SCStreamConfiguration()
    configuration.width = 2
    configuration.height = 2
    configuration.minimumFrameInterval = CMTime(value: 1, timescale: 5)
    configuration.queueDepth = 1
    configuration.showsCursor = false
    configuration.capturesAudio = true
    configuration.sampleRate = 48_000
    configuration.channelCount = 1
    configuration.excludesCurrentProcessAudio = false

    let stream = SCStream(filter: filter, configuration: configuration, delegate: self)
    try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: audioQueue)
    try await stream.startCapture()

    self.stream = stream
    isRunning = true
    bridgeState.updateStatus(
      running: true,
      status: "Capturing system output from the active macOS display.",
      sourceName: "macOS system output"
    )
  }

  func stopCapture() async {
    guard let stream else {
      isRunning = false
      bridgeState.updateStatus(
        running: false,
        status: "Idle. Choose Start Desktop Capture from the menu bar app.",
        sourceName: nil
      )
      return
    }

    do {
      try await stream.stopCapture()
    } catch {
      bridgeState.updateStatus(
        running: false,
        status: "Capture stopped after an error.",
        sourceName: "macOS system output",
        lastError: error.localizedDescription
      )
    }

    self.stream = nil
    isRunning = false
    bridgeState.updateStatus(
      running: false,
      status: "Idle. Choose Start Desktop Capture from the menu bar app.",
      sourceName: nil
    )
  }

  func stream(_ stream: SCStream, didStopWithError error: Error) {
    isRunning = false
    bridgeState.updateStatus(
      running: false,
      status: "ScreenCaptureKit stopped delivering system audio.",
      sourceName: "macOS system output",
      lastError: error.localizedDescription
    )
  }

  func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of outputType: SCStreamOutputType) {
    guard outputType == .audio else {
      return
    }
    guard let samples = decodeMonoSamples(from: sampleBuffer), !samples.isEmpty else {
      return
    }
    pcmBroadcaster?.broadcastPcm(samples: samples)
  }

  private func decodeMonoSamples(from sampleBuffer: CMSampleBuffer) -> [Float]? {
    guard let formatDescription = CMSampleBufferGetFormatDescription(sampleBuffer) else {
      return nil
    }
    guard let asbdPointer = CMAudioFormatDescriptionGetStreamBasicDescription(formatDescription) else {
      return nil
    }
    let asbd = asbdPointer.pointee
    let channels = max(Int(asbd.mChannelsPerFrame), 1)
    let isFloat = (asbd.mFormatFlags & kAudioFormatFlagIsFloat) != 0
    let isNonInterleaved = (asbd.mFormatFlags & kAudioFormatFlagIsNonInterleaved) != 0
    let bitsPerChannel = Int(asbd.mBitsPerChannel)
    let bytesPerSample = max(bitsPerChannel / 8, 1)
    let frameCount = CMSampleBufferGetNumSamples(sampleBuffer)
    guard frameCount > 0 else {
      return nil
    }

    let bufferCount = isNonInterleaved ? channels : 1
    let audioBufferListSize = MemoryLayout<AudioBufferList>.size + max(0, bufferCount - 1) * MemoryLayout<AudioBuffer>.size
    let audioBufferListPointer = UnsafeMutableRawPointer.allocate(
      byteCount: audioBufferListSize,
      alignment: MemoryLayout<AudioBufferList>.alignment
    )
    defer {
      audioBufferListPointer.deallocate()
    }

    var blockBuffer: CMBlockBuffer?
    let status = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      bufferListSizeNeededOut: nil,
      bufferListOut: audioBufferListPointer.assumingMemoryBound(to: AudioBufferList.self),
      bufferListSize: audioBufferListSize,
      blockBufferAllocator: nil,
      blockBufferMemoryAllocator: nil,
      flags: UInt32(kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment),
      blockBufferOut: &blockBuffer
    )
    guard status == noErr else {
      return nil
    }

    let audioBufferList = audioBufferListPointer.assumingMemoryBound(to: AudioBufferList.self)
    let buffers = UnsafeMutableAudioBufferListPointer(audioBufferList)
    var samples = [Float](repeating: 0, count: frameCount)

    if isNonInterleaved {
      for buffer in buffers {
        guard let data = buffer.mData else {
          continue
        }
        for frameIndex in 0..<frameCount {
          samples[frameIndex] += readSample(
            from: data,
            sampleIndex: frameIndex,
            bytesPerSample: bytesPerSample,
            isFloat: isFloat
          )
        }
      }
      let scale = 1.0 / Float(channels)
      for frameIndex in 0..<frameCount {
        samples[frameIndex] *= scale
      }
      return samples
    }

    guard let data = buffers.first?.mData else {
      return nil
    }
    for frameIndex in 0..<frameCount {
      var mixed: Float = 0
      for channelIndex in 0..<channels {
        mixed += readSample(
          from: data,
          sampleIndex: frameIndex * channels + channelIndex,
          bytesPerSample: bytesPerSample,
          isFloat: isFloat
        )
      }
      samples[frameIndex] = mixed / Float(channels)
    }
    return samples
  }

  private func readSample(
    from data: UnsafeMutableRawPointer,
    sampleIndex: Int,
    bytesPerSample: Int,
    isFloat: Bool
  ) -> Float {
    let offset = sampleIndex * bytesPerSample
    if isFloat && bytesPerSample == MemoryLayout<Float>.size {
      return data.load(fromByteOffset: offset, as: Float.self)
    }
    if bytesPerSample == MemoryLayout<Int16>.size {
      let value = data.load(fromByteOffset: offset, as: Int16.self)
      return Float(value) / Float(Int16.max)
    }
    if bytesPerSample == MemoryLayout<Int32>.size {
      let value = data.load(fromByteOffset: offset, as: Int32.self)
      return Float(value) / Float(Int32.max)
    }
    return 0
  }
}

final class LocalPcmWebSocketServer: @unchecked Sendable {
  private let listener: NWListener
  private let queue = DispatchQueue(label: "seesound.companion.websocket")
  private var connections: [ObjectIdentifier: NWConnection] = [:]

  init() throws {
    let websocketOptions = NWProtocolWebSocket.Options()
    websocketOptions.autoReplyPing = true
    let parameters = NWParameters(tls: nil, tcp: NWProtocolTCP.Options())
    parameters.allowLocalEndpointReuse = true
    parameters.defaultProtocolStack.applicationProtocols.insert(websocketOptions, at: 0)
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: bridgeWebSocketPort)!)
    self.listener = try NWListener(using: parameters)
  }

  func start() {
    listener.newConnectionHandler = { [weak self] connection in
      self?.handle(connection: connection)
    }
    listener.start(queue: queue)
  }

  func broadcastPcm(samples: [Float]) {
    guard !samples.isEmpty else {
      return
    }
    let payload = samples.withUnsafeBufferPointer { buffer in
      Data(buffer: buffer)
    }
    let metadata = NWProtocolWebSocket.Metadata(opcode: .binary)
    let context = NWConnection.ContentContext(identifier: "pcm", metadata: [metadata])

    queue.async {
      for connection in self.connections.values {
        connection.send(content: payload, contentContext: context, isComplete: true, completion: .idempotent)
      }
    }
  }

  private func handle(connection: NWConnection) {
    let connectionID = ObjectIdentifier(connection)
    queue.async {
      self.connections[connectionID] = connection
    }
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      switch state {
      case .failed, .cancelled:
        self.queue.async {
          self.connections.removeValue(forKey: connectionID)
        }
      default:
        break
      }
    }
    connection.start(queue: queue)
    receiveNextMessage(on: connection)
  }

  private func receiveNextMessage(on connection: NWConnection) {
    connection.receiveMessage { [weak self] _, _, _, error in
      guard let self else { return }
      if error != nil {
        self.queue.async {
          self.connections.removeValue(forKey: ObjectIdentifier(connection))
        }
        connection.cancel()
        return
      }
      self.receiveNextMessage(on: connection)
    }
  }
}

final class LocalBridgeHttpServer: @unchecked Sendable {
  private let bridgeState: SharedBridgeState
  private let captureController: SystemAudioCaptureController
  private let listener: NWListener
  private let queue = DispatchQueue(label: "seesound.companion.http")

  init(bridgeState: SharedBridgeState, captureController: SystemAudioCaptureController) throws {
    self.bridgeState = bridgeState
    self.captureController = captureController
    let parameters = NWParameters.tcp
    parameters.allowLocalEndpointReuse = true
    parameters.requiredLocalEndpoint = .hostPort(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: bridgeHttpPort)!)
    self.listener = try NWListener(using: parameters)
  }

  func start() {
    listener.newConnectionHandler = { [weak self] connection in
      self?.handle(connection: connection)
    }
    listener.start(queue: queue)
  }

  private func handle(connection: NWConnection) {
    connection.start(queue: queue)
    connection.receive(minimumIncompleteLength: 1, maximumLength: 65_536) { [weak self] data, _, _, _ in
      guard let self, let data, let request = String(data: data, encoding: .utf8) else {
        connection.cancel()
        return
      }
      self.respond(to: request, over: connection)
    }
  }

  private func respond(to request: String, over connection: NWConnection) {
    let requestLine = request.split(separator: "\r\n", maxSplits: 1).first ?? ""
    let components = requestLine.split(separator: " ")
    let method = components.count > 0 ? String(components[0]) : "GET"
    let path = components.count > 1 ? String(components[1]) : "/"

    switch (method, path) {
    case ("GET", "/health"), ("GET", "/status"):
      sendJSON(bridgeState.currentStatus(), statusCode: 200, over: connection)
    case ("POST", "/capture/start"):
      Task { [weak self] in
        guard let self else { return }
        do {
          try await self.captureController.startCapture()
          self.sendJSON(self.bridgeState.currentStatus(), statusCode: 200, over: connection)
        } catch {
          self.bridgeState.updateStatus(
            running: false,
            status: "Unable to start ScreenCaptureKit system audio capture.",
            sourceName: "macOS system output",
            lastError: error.localizedDescription
          )
          self.sendJSON(self.bridgeState.currentStatus(), statusCode: 500, over: connection)
        }
      }
    case ("POST", "/capture/stop"):
      Task { [weak self] in
        guard let self else { return }
        await self.captureController.stopCapture()
        self.sendJSON(self.bridgeState.currentStatus(), statusCode: 200, over: connection)
      }
    case ("OPTIONS", _):
      sendRawResponse(statusCode: 204, body: Data(), over: connection)
    default:
      sendRawResponse(statusCode: 404, body: Data("Not found".utf8), contentType: "text/plain; charset=utf-8", over: connection)
    }
  }

  private func sendJSON<T: Encodable>(_ value: T, statusCode: Int, over connection: NWConnection) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.withoutEscapingSlashes]
    let body = (try? encoder.encode(value)) ?? Data("{}".utf8)
    sendRawResponse(statusCode: statusCode, body: body, over: connection)
  }

  private func sendRawResponse(
    statusCode: Int,
    body: Data,
    contentType: String = "application/json; charset=utf-8",
    over connection: NWConnection
  ) {
    let statusText: String
    switch statusCode {
    case 200: statusText = "OK"
    case 204: statusText = "No Content"
    case 404: statusText = "Not Found"
    case 500: statusText = "Internal Server Error"
    case 503: statusText = "Service Unavailable"
    default: statusText = "OK"
    }

    var header = "HTTP/1.1 \(statusCode) \(statusText)\r\n"
    header += "Content-Type: \(contentType)\r\n"
    header += "Content-Length: \(body.count)\r\n"
    header += "Access-Control-Allow-Origin: *\r\n"
    header += "Access-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    header += "Access-Control-Allow-Headers: Content-Type\r\n"
    header += "Connection: close\r\n\r\n"

    var response = Data(header.utf8)
    response.append(body)
    connection.send(content: response, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }
}

final class AppDelegate: NSObject, NSApplicationDelegate {
  private let bridgeState = SharedBridgeState()
  private lazy var captureController = SystemAudioCaptureController(bridgeState: bridgeState)
  private var bridgeHttpServer: LocalBridgeHttpServer?
  private var pcmWebSocketServer: LocalPcmWebSocketServer?
  private var statusItem: NSStatusItem?
  private var statusMenuItem: NSMenuItem?
  private var toggleCaptureItem: NSMenuItem?

  @MainActor
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.accessory)
    setUpMenuBar()

    do {
      let webSocketServer = try LocalPcmWebSocketServer()
      webSocketServer.start()
      pcmWebSocketServer = webSocketServer
      captureController.setPcmBroadcaster(webSocketServer)

      let httpServer = try LocalBridgeHttpServer(bridgeState: bridgeState, captureController: captureController)
      httpServer.start()
      bridgeHttpServer = httpServer
      updateMenuState(status: "Bridge listening on localhost:\(bridgeHttpPort) and \(bridgeWebSocketPort)")
    } catch {
      updateMenuState(status: "Failed to start localhost bridge")
      bridgeState.updateStatus(
        running: false,
        status: "Failed to start localhost bridge.",
        lastError: error.localizedDescription
      )
    }
  }

  @MainActor
  private func setUpMenuBar() {
    let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    item.button?.title = "SeeSound"

    let menu = NSMenu()
    let status = NSMenuItem(title: "Idle", action: nil, keyEquivalent: "")
    status.isEnabled = false
    menu.addItem(status)
    menu.addItem(.separator())

    let toggle = NSMenuItem(title: "Start Desktop Capture", action: #selector(toggleCapture), keyEquivalent: "")
    toggle.target = self
    menu.addItem(toggle)

    let openWeb = NSMenuItem(title: "Open Web UI", action: #selector(openWebUI), keyEquivalent: "")
    openWeb.target = self
    menu.addItem(openWeb)

    menu.addItem(.separator())

    let quit = NSMenuItem(title: "Quit", action: #selector(quitApp), keyEquivalent: "q")
    quit.target = self
    menu.addItem(quit)

    item.menu = menu
    statusItem = item
    statusMenuItem = status
    toggleCaptureItem = toggle
  }

  @MainActor
  private func updateMenuState(status: String) {
    statusMenuItem?.title = status
    toggleCaptureItem?.title = captureController.isRunning ? "Stop Desktop Capture" : "Start Desktop Capture"
  }

  @MainActor
  @objc private func toggleCapture() {
    if captureController.isRunning {
      Task {
        await captureController.stopCapture()
        await MainActor.run {
          self.updateMenuState(status: "Idle")
        }
      }
      return
    }

    updateMenuState(status: "Starting desktop capture…")
    Task {
      do {
        try await captureController.startCapture()
        await MainActor.run {
          self.updateMenuState(status: "Capturing macOS system output")
        }
      } catch {
        bridgeState.updateStatus(
          running: false,
          status: "Unable to start ScreenCaptureKit system audio capture.",
          sourceName: "macOS system output",
          lastError: error.localizedDescription
        )
        await MainActor.run {
          self.updateMenuState(status: "Capture failed: \(error.localizedDescription)")
        }
      }
    }
  }

  @MainActor
  @objc private func openWebUI() {
    if let url = URL(string: "http://127.0.0.1:5173") {
      NSWorkspace.shared.open(url)
    }
  }

  @MainActor
  @objc private func quitApp() {
    Task {
      await captureController.stopCapture()
      await MainActor.run {
        NSApp.terminate(nil)
      }
    }
  }
}

@main
struct SeeSoundCompanionMain {
  static func main() {
    let application = NSApplication.shared
    let delegate = AppDelegate()
    application.delegate = delegate
    application.run()
  }
}
