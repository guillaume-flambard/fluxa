#!/usr/bin/env swift
import Foundation

let scriptPath = "/Users/memo/projects/fluxa/Fluxa.app/Contents/MacOS/Fluxa"
let process = Process()
process.executableURL = URL(fileURLWithPath: scriptPath)
do {
    try process.run()
    process.waitUntilExit()
} catch {
    print("Failed to launch Fluxa: \(error)")
    exit(1)
}
