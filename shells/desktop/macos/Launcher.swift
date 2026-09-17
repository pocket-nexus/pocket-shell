// SPDX-License-Identifier: GPL-3.0-only
// Bundle launcher and read-only USB companion. PocketJS owns the native window.
import Foundation
import IOKit
import Darwin

struct Device: Codable, Equatable {
    let id: String
    let kind: String
    let name: String
    let connection: String
    let serial: String
    let vendor: Int
    let product: Int
}

func identify(vendor: Int, product: Int, serial: String, location: Int) -> Device? {
    let identity = serial.isEmpty ? "port-\(location)" : serial
    switch (vendor, product) {
    case (0x054c, 0x01c8), (0x054c, 0x01c9):
        return Device(id: "psp-\(identity)", kind: "psp", name: "PSP",
                      connection: product == 0x01c9 ? "PSPLINK USB" : "USB storage",
                      serial: serial, vendor: vendor, product: product)
    case (0x05ac, 0x129e):
        return Device(id: "ipodtouch4-\(identity)", kind: "ipodtouch4", name: "iPod touch 4",
                      connection: "USB", serial: serial, vendor: vendor, product: product)
    default:
        return nil
    }
}

func connectedDevices() throws -> [Device] {
    var iterator: io_iterator_t = 0
    let result = IOServiceGetMatchingServices(kIOMainPortDefault, IOServiceMatching("IOUSBHostDevice"), &iterator)
    guard result == KERN_SUCCESS else {
        throw NSError(domain: "IOKit", code: Int(result))
    }
    defer { IOObjectRelease(iterator) }
    var devices: [Device] = []
    while case let service = IOIteratorNext(iterator), service != 0 {
        defer { IOObjectRelease(service) }
        func property(_ key: String) -> Any? {
            IORegistryEntryCreateCFProperty(service, key as CFString, kCFAllocatorDefault, 0)?.takeRetainedValue()
        }
        guard let vendor = property("idVendor") as? NSNumber,
              let product = property("idProduct") as? NSNumber else { continue }
        let serial = property("USB Serial Number") as? String ?? ""
        let location = (property("locationID") as? NSNumber)?.intValue ?? 0
        if let device = identify(vendor: vendor.intValue, product: product.intValue,
                                 serial: serial, location: location) {
            devices.append(device)
        }
    }
    return devices.sorted { $0.id < $1.id }
}

func snapshot() -> Data {
    do {
        let devices = try JSONSerialization.jsonObject(with: JSONEncoder().encode(connectedDevices()))
        return try JSONSerialization.data(withJSONObject: ["t": "devices", "devices": devices], options: [.sortedKeys])
    } catch {
        return Data("{\"t\":\"devices\",\"devices\":[],\"error\":\"USB discovery is unavailable.\"}".utf8)
    }
}

func socketError(_ operation: String) -> NSError {
    NSError(domain: NSPOSIXErrorDomain, code: Int(errno), userInfo: [NSLocalizedDescriptionKey: "\(operation): \(String(cString: strerror(errno)))"])
}

func makeListener() throws -> (Int32, UInt16) {
    let listener = socket(AF_INET, SOCK_STREAM, 0)
    guard listener >= 0 else { throw socketError("socket") }
    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_addr.s_addr = inet_addr("127.0.0.1")
    let bound = withUnsafePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
            bind(listener, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
        }
    }
    guard bound == 0, listen(listener, 2) == 0 else {
        let error = socketError("listen"); close(listener); throw error
    }
    var size = socklen_t(MemoryLayout<sockaddr_in>.size)
    let named = withUnsafeMutablePointer(to: &address) {
        $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(listener, $0, &size) }
    }
    guard named == 0 else { let error = socketError("getsockname"); close(listener); throw error }
    return (listener, UInt16(bigEndian: address.sin_port))
}

func readExactly(_ socket: Int32, _ count: Int) -> [UInt8]? {
    var bytes = [UInt8](repeating: 0, count: count)
    var offset = 0
    while offset < count {
        let n = bytes.withUnsafeMutableBytes { recv(socket, $0.baseAddress!.advanced(by: offset), count - offset, 0) }
        if n <= 0 { return nil }
        offset += n
    }
    return bytes
}

func writeAll(_ socket: Int32, _ data: Data) -> Bool {
    var offset = 0
    while offset < data.count {
        let n = data.withUnsafeBytes { send(socket, $0.baseAddress!.advanced(by: offset), data.count - offset, 0) }
        if n <= 0 { return false }
        offset += n
    }
    return true
}

func sendFrame(_ socket: Int32, _ kind: UInt8, _ payload: Data) -> Bool {
    let length = UInt32(payload.count)
    var data = Data([kind, 0, 0, 0, UInt8(length & 255), UInt8((length >> 8) & 255),
                     UInt8((length >> 16) & 255), UInt8((length >> 24) & 255)])
    data.append(payload)
    return writeAll(socket, data)
}

func serve(_ client: Int32) {
    defer { close(client) }
    var timeout = timeval(tv_sec: 2, tv_usec: 0)
    var yes: Int32 = 1
    setsockopt(client, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    setsockopt(client, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout<timeval>.size))
    setsockopt(client, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout<Int32>.size))
    // PocketJS PKNT v1. Accept only this product's guest; cap all inbound records.
    guard let hello = readExactly(client, 7), Array(hello[0..<5]) == [0x50, 0x4b, 0x4e, 0x54, 1],
          hello[6] > 0, hello[6] <= 64,
          let name = readExactly(client, Int(hello[6])),
          String(bytes: name, encoding: .utf8) == "pocket-desktop-system-ui",
          writeAll(client, Data([0x50, 0x4b, 0x4e, 0x54, 1, 0, 0, 0])) else { return }
    let files = FileSession()
    var nextScan = Date.distantPast
    while true {
        if Date() >= nextScan {
            // A periodic snapshot also lets the guest detect a lost companion.
            guard sendFrame(client, 0x10, snapshot()) else { return }
            nextScan = Date().addingTimeInterval(1)
        }
        var descriptor = pollfd(fd: client, events: Int16(POLLIN), revents: 0)
        let ready = poll(&descriptor, 1, 200)
        if ready < 0 { return }
        if ready == 0 { continue }
        guard descriptor.revents & Int16(POLLERR | POLLHUP | POLLNVAL) == 0,
              let header = readExactly(client, 8) else { return }
        let length = Int(header[4]) | (Int(header[5]) << 8) | (Int(header[6]) << 16) | (Int(header[7]) << 24)
        guard length <= 4096, let payload = readExactly(client, length) else { return }
        if header[0] == 0x01 {
            guard sendFrame(client, 0x02, Data(payload)) else { return }
        } else if header[0] == 0x10,
                  let message = try? JSONSerialization.jsonObject(with: Data(payload)) as? [String: Any] {
            if message["t"] as? String == "devices-refresh" { nextScan = .distantPast }
            else if let reply = files.reply(message), !sendFrame(client, 0x10, reply) { return }
        }
    }
}

func run() throws {
    let arguments = Array(CommandLine.arguments.dropFirst())
    if arguments == ["--devices"] {
        FileHandle.standardOutput.write(snapshot() + Data([10]))
        return
    }
    if arguments == ["--self-test"] {
        precondition(identify(vendor: 0x054c, product: 0x01c9, serial: "", location: 1)?.connection == "PSPLINK USB")
        precondition(identify(vendor: 0x054c, product: 0x01c8, serial: "", location: 2)?.connection == "USB storage")
        precondition(identify(vendor: 0x05ac, product: 0x129e, serial: "a", location: 3)?.kind == "ipodtouch4")
        precondition(identify(vendor: 0x05ac, product: 0x12a8, serial: "b", location: 4) == nil)
        precondition(identify(vendor: 0x1234, product: 0x01c9, serial: "", location: 5) == nil)
        print("USB identity checks passed")
        return
    }
    let (listener, port) = try makeListener()
    defer { close(listener) }
    DispatchQueue.global(qos: .utility).async {
        while true {
            let client = accept(listener, nil, nil)
            if client < 0 { return }
            DispatchQueue.global(qos: .utility).async { serve(client) }
        }
    }
    if arguments == ["--device-service"] {
        print("127.0.0.1:\(port)")
        fflush(stdout)
        dispatchMain()
    }
    let contents = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
    let resources = contents.appendingPathComponent("Resources")
    let runtime = Process()
    runtime.executableURL = contents.appendingPathComponent("MacOS/pocket-shell-runtime")
    runtime.arguments = ["--system-plan", resources.appendingPathComponent("pocket-desktop.system.plan.json").path,
                         "--svc-connect", "127.0.0.1:\(port)"] + arguments
    runtime.currentDirectoryURL = resources
    runtime.environment = ProcessInfo.processInfo.environment.merging([
        "POCKETJS_DIST": resources.appendingPathComponent("dist").path
    ]) { _, bundled in bundled }
    try runtime.run()
    // Quitting a CLI launch must also retire its window and device service.
    let signals = [SIGTERM, SIGINT].map { number -> DispatchSourceSignal in
        signal(number, SIG_IGN)
        let source = DispatchSource.makeSignalSource(signal: number, queue: .global())
        source.setEventHandler { if runtime.isRunning { runtime.terminate() } }
        source.resume()
        return source
    }
    runtime.waitUntilExit()
    withExtendedLifetime(signals) {}
    exit(runtime.terminationStatus)
}

@main
struct PocketShellMain {
    static func main() {
        do { try run() }
        catch {
            FileHandle.standardError.write(Data("Pocket Shell: \(error.localizedDescription)\n".utf8))
            exit(1)
        }
    }
}
