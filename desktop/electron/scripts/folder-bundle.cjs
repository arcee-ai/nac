"use strict";

// Single writer for the cancellable AppKit panel's native application identity.
// Node still spawns the exact executable directly and owns its stdin/reaping;
// LaunchServices never chooses, starts, or attaches a picker process.
const fs = require("node:fs");
const path = require("node:path");
const { folderBundle, folderExecutable } = require("../src/folder.cjs");

const xml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[char],
  );

function buildFolderBundle(resources, identity, run) {
  if (!["dev", "beta", "stable"].includes(identity.track)) throw new Error("Invalid picker track");
  const bundle = folderBundle(resources);
  const executable = folderExecutable(resources);
  const plist = path.join(bundle, "Contents", "Info.plist");
  const identifier = `ai.arcee.nac.electron.folder-picker.${identity.track}`;
  fs.mkdirSync(path.dirname(executable), { recursive: true });
  fs.writeFileSync(
    plist,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${xml(identifier)}</string>
<key>CFBundleName</key><string>NAC Folder Picker</string>
<key>CFBundleDisplayName</key><string>NAC Folder Picker</string>
<key>CFBundleExecutable</key><string>native-folder-picker</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>${xml(identity.product_version)}</string>
<key>CFBundleShortVersionString</key><string>${xml(identity.product_version)}</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSPrincipalClass</key><string>NSApplication</string>
</dict></plist>
`,
  );
  run("/usr/bin/xcrun", [
    "swiftc",
    "-O",
    "-target",
    "arm64-apple-macosx14.0",
    "-framework",
    "AppKit",
    path.resolve(__dirname, "../src/NativeFolderPicker.swift"),
    "-o",
    executable,
  ]);
  return { bundle, executable, plist, identifier };
}

module.exports = { buildFolderBundle };
