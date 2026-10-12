// The caller explicitly imports the emitted scoped stylesheet and serves the
// manifest's assets. Importing this JS never mounts a DOM root or installs CSS.
import "../../src/index.css";
export * from "../../src/app/runtime/index";
