// SPDX-License-Identifier: GPL-3.0-only
import Foundation
import AppKit

final class OpenStrikeLauncher {
    private var game: Process?

    func open() throws {
        if let game, game.isRunning {
            NSRunningApplication(processIdentifier: game.processIdentifier)?.activate(options: [])
            return
        }
        let env = ProcessInfo.processInfo.environment
        let home = FileManager.default.homeDirectoryForCurrentUser
        let contents = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.deletingLastPathComponent().deletingLastPathComponent()
        let settingsURL = contents.appendingPathComponent("Resources/integrations.json")
        let settings = (try? Data(contentsOf: settingsURL)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: String] } ?? [:]
        let embedded = contents.appendingPathComponent("Resources/OpenStrike")
        let root = URL(fileURLWithPath: env["OPENSTRIKE_ROOT"] ?? (FileManager.default.fileExists(atPath: embedded.appendingPathComponent("target/release/openstrike").path)
            ? embedded.path : settings["openStrikeRoot"] ?? home.appendingPathComponent("code/open-strike").path))
        let binary = root.appendingPathComponent("target/release/openstrike")
        guard FileManager.default.isExecutableFile(atPath: binary.path) else {
            throw failure("Build OpenStrike in \(root.path): bun run build:desktop")
        }
        let roots = [env["OPENSTRIKE_MAPS"], settings["openStrikeMaps"], root.appendingPathComponent("dist/maps").path,
                     home.appendingPathComponent("Downloads/cs-maps-20260705-1836").path].compactMap { $0 }
        var selected: (URL, URL)?
        for path in roots {
            let directory = URL(fileURLWithPath: path)
            for relative in ["maps/de_dust2.bsp", "de_dust2.bsp", "maps/de_dust2.p3d", "de_dust2.p3d"] {
                let map = directory.appendingPathComponent(relative)
                if FileManager.default.fileExists(atPath: map.path) { selected = (directory, map); break }
            }
            if selected != nil { break }
        }
        guard let (maps, map) = selected else {
            throw failure("OpenStrike needs maps. Set OPENSTRIKE_MAPS and rebuild Pocket Shell.")
        }
        let logs = home.appendingPathComponent("Library/Logs/Pocket Shell")
        try FileManager.default.createDirectory(at: logs, withIntermediateDirectories: true)
        let log = logs.appendingPathComponent("OpenStrike.log")
        FileManager.default.createFile(atPath: log.path, contents: nil)
        let output = try FileHandle(forWritingTo: log)
        defer { try? output.close() }
        let process = Process()
        process.executableURL = binary
        process.arguments = ["--map", map.path, "--maps-dir", maps.path]
        process.currentDirectoryURL = root
        process.environment = env.merging([
            "OPENSTRIKE_UI_DIST": root.appendingPathComponent("dist/pocket/macos-app").path,
            "OPENSTRIKE_ASSETS": root.appendingPathComponent("assets").path,
        ]) { _, local in local }
        process.standardOutput = output; process.standardError = output
        try process.run()
        game = process
        // Report immediate configuration/load failures instead of pretending
        // the double-click succeeded. The game owns its native window.
        Thread.sleep(forTimeInterval: 0.35)
        if !process.isRunning {
            throw failure("OpenStrike could not start. See Library/Logs/Pocket Shell/OpenStrike.log.")
        }
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "OpenStrike", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }
}
