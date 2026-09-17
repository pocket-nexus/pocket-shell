// SPDX-License-Identifier: GPL-3.0-only
// Local filesystem and Launch Services belong to the macOS companion. The
// guest owns navigation; request ids and bounded pages keep windows isolated.
import Foundation
import AppKit

struct FileEntry: Codable {
    let path: String
    let name: String
    let kind: String
    let size: Int64
}

/// Launch Services artwork at twice the logical 16 px row size. The service
/// sends straight RGBA; each visible guest row owns and releases its texture.
func applicationIcon(_ path: String) -> String? {
    let image = NSWorkspace.shared.icon(forFile: path)
    var rect = CGRect(x: 0, y: 0, width: 32, height: 32)
    guard let cgImage = image.cgImage(forProposedRect: &rect, context: nil, hints: nil) else { return nil }
    var rgba = [UInt8](repeating: 0, count: 32 * 32 * 4)
    let rendered = rgba.withUnsafeMutableBytes { storage -> Bool in
        guard let context = CGContext(data: storage.baseAddress, width: 32, height: 32, bitsPerComponent: 8,
            bytesPerRow: 128, space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue) else { return false }
        context.interpolationQuality = .high
        context.draw(cgImage, in: rect)
        return true
    }
    guard rendered else { return nil }
    for i in stride(from: 0, to: rgba.count, by: 4) {
        let alpha = Int(rgba[i + 3])
        if alpha > 0 { for c in 0..<3 { rgba[i + c] = UInt8(min(255, (Int(rgba[i + c]) * 255 + alpha / 2) / alpha)) } }
    }
    return Data(rgba).base64EncodedString()
}

func fileURL(_ path: String) throws -> URL {
    let home = FileManager.default.homeDirectoryForCurrentUser
    let aliases = ["computer": "/", "home": home.path, "desktop": home.appendingPathComponent("Desktop").path,
                   "documents": home.appendingPathComponent("Documents").path,
                   "downloads": home.appendingPathComponent("Downloads").path,
                   "recycle": home.appendingPathComponent(".Trash").path]
    let resolved = aliases[path] ?? path
    guard resolved.hasPrefix("/"), !resolved.contains("\0"), resolved.utf8.count <= 3000 else {
        throw NSError(domain: "Files", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid file path"])
    }
    return URL(fileURLWithPath: resolved).standardizedFileURL
}

func entry(_ url: URL) throws -> FileEntry {
    let values = try url.resourceValues(forKeys: [.isDirectoryKey, .isApplicationKey, .fileSizeKey, .localizedNameKey])
    let app = values.isApplication == true || url.pathExtension.lowercased() == "app"
    return FileEntry(path: url.path, name: app ? url.deletingPathExtension().lastPathComponent : url.lastPathComponent,
                     kind: app ? "application" : values.isDirectory == true ? "directory" : "file",
                     size: Int64(values.fileSize ?? 0))
}

func nativeApplications() -> [FileEntry] {
    let fm = FileManager.default
    let roots = [URL(fileURLWithPath: "/Applications"), URL(fileURLWithPath: "/System/Applications"),
                 URL(fileURLWithPath: "/System/Library/CoreServices/Applications"),
                 fm.homeDirectoryForCurrentUser.appendingPathComponent("Applications")]
    var found: [FileEntry] = []
    if let finder = try? entry(URL(fileURLWithPath: "/System/Library/CoreServices/Finder.app")) { found.append(finder) }
    var paths = Set<String>()
    for root in roots {
        guard let iterator = fm.enumerator(at: root, includingPropertiesForKeys: [.isApplicationKey, .isDirectoryKey],
                                          options: [.skipsHiddenFiles, .skipsPackageDescendants]) else { continue }
        for case let url as URL in iterator {
            if let item = try? entry(url), item.kind == "application", paths.insert(url.resolvingSymlinksInPath().path).inserted {
                found.append(item)
                iterator.skipDescendants()
            }
        }
    }
    return found
}

struct DirectoryPage {
    let path: String
    let label: String
    let parent: String
    let entries: [FileEntry]
    let created: Date
}

final class FileSession {
    private let openStrike = OpenStrikeLauncher()
    private var listings: [Int: DirectoryPage] = [:]

    func reply(_ message: [String: Any]) -> Data? {
        guard let id = message["request"] as? Int, id >= 0,
              let path = message["path"] as? String, let type = message["t"] as? String else { return nil }
        var reply: [String: Any] = ["t": "files", "request": id, "path": path, "entries": [], "done": true]
        do {
            if type == "files-open" && path == "pocket:openstrike" {
                try openStrike.open()
                reply["opened"] = true
            } else if type == "files-open" {
                let url = try fileURL(path)
                guard FileManager.default.fileExists(atPath: url.path) else {
                    throw NSError(domain: "Files", code: 2, userInfo: [NSLocalizedDescriptionKey: "This item no longer exists"])
                }
                let process = Process()
                process.executableURL = URL(fileURLWithPath: "/usr/bin/open")
                process.arguments = url.pathExtension.lowercased() == "app" ? ["-a", url.path] : [url.path]
                let error = Pipe(); process.standardError = error
                try process.run(); process.waitUntilExit()
                guard process.terminationStatus == 0 else {
                    throw NSError(domain: "Files", code: 3, userInfo: [NSLocalizedDescriptionKey: "macOS could not open this item"])
                }
                reply["opened"] = true
            } else if type == "files-list" {
                let offset = max(0, message["offset"] as? Int ?? 0)
                let hidden = message["hidden"] as? Bool ?? false
                listings = listings.filter { Date().timeIntervalSince($0.value.created) < 30 }
                if offset == 0 {
                    let url = path == "native-apps" ? nil : try fileURL(path)
                    let all: [FileEntry]
                    if let url {
                        let children = try FileManager.default.contentsOfDirectory(at: url,
                            includingPropertiesForKeys: [.isDirectoryKey, .isApplicationKey, .fileSizeKey],
                            options: hidden ? [] : [.skipsHiddenFiles])
                        all = children.compactMap { try? entry($0) }
                        reply["path"] = url.path
                        reply["label"] = url.path == "/" ? "Macintosh HD" : url.lastPathComponent
                        reply["parent"] = url.deletingLastPathComponent().path
                    } else {
                        all = nativeApplications()
                        reply["label"] = "Native Apps"
                        reply["parent"] = "computer"
                    }
                    let sorted = all.sorted {
                        if ($0.kind == "directory") != ($1.kind == "directory") { return $0.kind == "directory" }
                        let comparison = $0.name.localizedStandardCompare($1.name)
                        return comparison == .orderedSame ? $0.path < $1.path : comparison == .orderedAscending
                    }
                    if listings.count >= 16, let oldest = listings.min(by: { $0.value.created < $1.value.created })?.key {
                        listings.removeValue(forKey: oldest)
                    }
                    listings[id] = DirectoryPage(path: reply["path"] as! String, label: reply["label"] as! String,
                                                 parent: reply["parent"] as! String, entries: sorted, created: Date())
                }
                guard let listing = listings[id], offset <= listing.entries.count else {
                    throw NSError(domain: "Files", code: 4, userInfo: [NSLocalizedDescriptionKey: "Directory listing expired. Refresh to retry."])
                }
                let sorted = listing.entries
                reply["path"] = listing.path; reply["label"] = listing.label; reply["parent"] = listing.parent
                // Limit both entries and serialized bytes; long filenames cannot
                // exceed PocketJS's service record budget.
                var page: [[String: Any]] = []
                var next = min(offset, sorted.count)
                var bytes = 0
                while next < sorted.count && page.count < 32 {
                    let item = sorted[next]
                    var value = try JSONSerialization.jsonObject(with: JSONEncoder().encode(item)) as! [String: Any]
                    if item.kind == "application" { value["icon"] = applicationIcon(item.path) }
                    let encoded = try JSONSerialization.data(withJSONObject: value)
                    if bytes + encoded.count > 24000 && !page.isEmpty { break }
                    page.append(value)
                    bytes += encoded.count; next += 1
                }
                reply["entries"] = page
                reply["offset"] = offset
                reply["next"] = next
                reply["total"] = sorted.count
                reply["done"] = next >= sorted.count
                if next >= sorted.count { listings.removeValue(forKey: id) }
            } else { return nil }
        } catch {
            reply["error"] = error.localizedDescription
        }
        return try? JSONSerialization.data(withJSONObject: reply, options: [.sortedKeys])
    }
}
