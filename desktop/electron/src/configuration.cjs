"use strict";
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
const { validIdentity, LaunchError } = require("./protocol.cjs");
const configurationMessages = Object.freeze({
  invalid_configuration:
    "NAC could not read its selected config.toml. Check NAC_HOME, XDG_CONFIG_HOME or HOME, repair the configuration and pending MCP publication, then Retry. The selected store was not opened.",
  managed_configuration:
    "The local Mac app cannot launch a managed host. Remove NAC_MANAGED_CONFIG from this app launch environment and relaunch.",
  bootstrap_directory:
    "The bootstrap directory is unavailable. Relaunch with --directory and an existing readable directory.",
  store_directory:
    "NAC could not prepare the selected store directory. Check storage.store_path or --store-path and directory access, then Retry. No alternative store was selected.",
});
function options(args) {
  const result = { commandPaths: [] };
  if (args.length > 96) throw new Error("Too many app launch arguments.");
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("-psn_")) continue;
    const key = {
      "--directory": "directory",
      "--store-path": "store",
      "--command-path": "commandPaths",
    }[args[i]];
    const value = args[++i];
    if (
      !key ||
      typeof value !== "string" ||
      Buffer.byteLength(value) > 4096 ||
      value.includes("\0")
    )
      throw new Error(
        "Use --directory, --store-path and repeated --command-path directory arguments.",
      );
    if (key === "commandPaths") result.commandPaths.push(value);
    else if (result[key] !== undefined) throw new Error("Duplicate app launch argument.");
    else result[key] = value;
  }
  return result;
}
function environment(inherited, cwd, extraPaths) {
  const original = inherited.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin";
  if (
    Buffer.byteLength(original) > 32768 ||
    original.split(":").length > 256 ||
    extraPaths.length > 32
  )
    throw new Error("Command search paths are invalid or too large.");
  const parts = [
    ...extraPaths,
    ...original.split(":"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/local/sbin",
  ];
  if (parts.some((p) => p.includes("\0") || p.includes(":") || Buffer.byteLength(p) > 4096))
    throw new Error("Invalid command search path.");
  const env = {
    ...inherited,
    PATH: [...new Set(parts.map((p) => path.resolve(cwd, p)))].join(":"),
  };
  delete env.NAC_DESKTOP_CHANNEL_FD;
  return env;
}
function capture(executable, args, { cwd, env }) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, env, stdio: ["ignore", "pipe", "ignore"] });
    let data = Buffer.alloc(0),
      invalid = false;
    const timer = setTimeout(() => {
      invalid = true;
      child.kill("SIGKILL");
    }, 12000);
    child.stdout.on("data", (bytes) => {
      if (data.length + bytes.length > 16384) {
        invalid = true;
        child.kill("SIGKILL");
      } else data = Buffer.concat([data, bytes]);
    });
    child.on("error", () => {
      invalid = true;
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (invalid || code !== 0)
        return reject(
          new Error(
            "Bundled engine configuration discovery failed or exceeded its bound. Check configuration access, then Retry.",
          ),
        );
      try {
        resolve(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data)));
      } catch {
        reject(new Error("The bundled engine returned invalid configuration identity."));
      }
    });
  });
}
async function selectConfiguration(executable, identity, launchOptions, inherited = process.env) {
  if (!validIdentity(identity)) throw new Error("The bundled engine identity is invalid.");
  const home = inherited.HOME ?? os.homedir();
  if (!path.isAbsolute(home)) throw new Error("HOME must be absolute.");
  const cwd = fs.realpathSync(path.resolve(home, launchOptions.directory ?? home));
  if (!fs.statSync(cwd).isDirectory()) throw new Error(configurationMessages.bootstrap_directory);
  const env = environment({ ...inherited, HOME: home }, cwd, launchOptions.commandPaths);
  const git = env.PATH.split(":").some((dir) => {
    try {
      fs.accessSync(path.join(dir, "git"), fs.constants.X_OK);
      return fs.statSync(path.join(dir, "git")).isFile();
    } catch {
      return false;
    }
  });
  if (!git)
    throw new Error(
      "Git was not found. Install/configure Git or pass --command-path with its directory, then relaunch NAC.",
    );
  fs.accessSync(executable, fs.constants.X_OK);
  const args = ["__desktop-configuration", "--directory", cwd];
  if (launchOptions.store) args.push("--store-path", launchOptions.store);
  const result = await capture(executable, args, { cwd, env });
  if (result.version !== 1)
    throw new Error("The bundled engine returned invalid configuration identity.");
  if (result.status === "failed")
    throw new LaunchError(
      result.code,
      configurationMessages[result.code] ?? "Bundled configuration discovery failed.",
    );
  if (
    result.status !== "selected" ||
    result.track !== identity.track ||
    !path.isAbsolute(result.root_cwd ?? "") ||
    !path.isAbsolute(result.store ?? "")
  )
    throw new Error("The bundled engine returned invalid configuration identity.");
  return { cwd: result.root_cwd, store: result.store, env };
}
module.exports = { options, environment, selectConfiguration, capture };
