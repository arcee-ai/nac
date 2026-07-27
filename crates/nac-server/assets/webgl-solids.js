(() => {
  "use strict";

  const canvas = document.getElementById("solid-canvas");
  const solidSelect = document.getElementById("solid-select");
  const detailInput = document.getElementById("detail-input");
  const detailOutput = document.getElementById("detail-output");
  const colorInput = document.getElementById("color-input");
  const colorValue = document.getElementById("color-value");
  const speedInput = document.getElementById("speed-input");
  const speedOutput = document.getElementById("speed-output");
  const rotateInput = document.getElementById("rotate-input");
  const wireframeInput = document.getElementById("wireframe-input");
  const regenerateButton = document.getElementById("regenerate-button");
  const resetButton = document.getElementById("reset-button");
  const vertexCount = document.getElementById("vertex-count");
  const triangleCount = document.getElementById("triangle-count");
  const statusPanel = document.getElementById("status-panel");

  if (!canvas) {
    return;
  }

  const state = {
    solid: solidSelect ? solidSelect.value : "sphere",
    detail: detailInput ? Number(detailInput.value) : 24,
    color: colorInput ? colorInput.value : "#4fd1ff",
    autoRotate: rotateInput ? rotateInput.checked : true,
    wireframe: wireframeInput ? wireframeInput.checked : false,
    speed: speedInput ? Number(speedInput.value) / 100 : 0.55,
    yaw: -0.62,
    pitch: 0.38,
    zoom: 4.25,
  };

  let gl = null;
  let program = null;
  let locations = null;
  let buffers = null;
  let meshInfo = null;
  let resizeObserver = null;
  let lastFrameTime = performance.now();
  let isDragging = false;
  let lastPointer = { x: 0, y: 0 };

  const vertexShaderSource = `
    attribute vec3 aPosition;
    attribute vec3 aNormal;

    uniform mat4 uProjection;
    uniform mat4 uView;
    uniform mat4 uModel;
    uniform mat3 uNormalMatrix;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;

    void main() {
      vec4 worldPosition = uModel * vec4(aPosition, 1.0);
      vWorldPosition = worldPosition.xyz;
      vNormal = normalize(uNormalMatrix * aNormal);
      gl_Position = uProjection * uView * worldPosition;
    }
  `;

  const fragmentShaderSource = `
    precision mediump float;

    uniform vec3 uColor;
    uniform int uWireframe;

    varying vec3 vNormal;
    varying vec3 vWorldPosition;

    void main() {
      vec3 normal = normalize(vNormal);
      vec3 lightDirection = normalize(vec3(0.35, 0.9, 0.55));
      vec3 fillLight = normalize(vec3(-0.7, 0.25, -0.35));
      float diffuse = max(dot(normal, lightDirection), 0.0);
      float softFill = max(dot(normal, fillLight), 0.0) * 0.22;
      vec3 viewDirection = normalize(vec3(0.0, 0.0, 4.0) - vWorldPosition);
      float rim = pow(1.0 - max(dot(normal, viewDirection), 0.0), 2.0);
      vec3 color = uColor * (0.28 + diffuse * 0.72 + softFill) + vec3(0.18, 0.36, 0.52) * rim;

      if (uWireframe == 1) {
        color = mix(vec3(0.92, 0.98, 1.0), uColor, 0.36);
      }

      gl_FragColor = vec4(color, 1.0);
    }
  `;

  try {
    gl = canvas.getContext("webgl", { antialias: true, depth: true, alpha: true }) ||
      canvas.getContext("experimental-webgl", { antialias: true, depth: true, alpha: true });

    if (!gl) {
      showError("WebGL is unavailable in this browser or device. Try a browser with hardware acceleration enabled.");
      disableControls();
      return;
    }

    program = createProgram(gl, vertexShaderSource, fragmentShaderSource);
    locations = getLocations(gl, program);
    buffers = createBuffers(gl);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.clearColor(0, 0, 0, 0);

    bindControls();
    installResizeHandling();
    rebuildMesh();
    requestAnimationFrame(renderFrame);
  } catch (error) {
    console.error(error);
    showError(`Unable to start the WebGL renderer: ${error.message}`);
    disableControls();
  }

  function bindControls() {
    if (solidSelect) {
      solidSelect.addEventListener("change", () => {
        state.solid = solidSelect.value;
        rebuildMesh();
      });
    }

    if (detailInput) {
      detailInput.addEventListener("input", () => {
        state.detail = Number(detailInput.value);
        updateDetailOutput();
        rebuildMesh();
      });
      updateDetailOutput();
    }

    if (colorInput) {
      colorInput.addEventListener("input", () => {
        state.color = colorInput.value;
        updateColorOutput();
      });
      updateColorOutput();
    }

    if (speedInput) {
      speedInput.addEventListener("input", () => {
        state.speed = Number(speedInput.value) / 100;
        updateSpeedOutput();
      });
      updateSpeedOutput();
    }

    if (rotateInput) {
      rotateInput.addEventListener("change", () => {
        state.autoRotate = rotateInput.checked;
      });
    }

    if (wireframeInput) {
      wireframeInput.addEventListener("change", () => {
        state.wireframe = wireframeInput.checked;
        updateStatus();
      });
    }

    if (regenerateButton) {
      regenerateButton.addEventListener("click", rebuildMesh);
    }

    if (resetButton) {
      resetButton.addEventListener("click", () => {
        state.yaw = -0.62;
        state.pitch = 0.38;
        state.zoom = 4.25;
      });
    }

    canvas.addEventListener("pointerdown", (event) => {
      isDragging = true;
      lastPointer = { x: event.clientX, y: event.clientY };
      if (canvas.setPointerCapture) {
        canvas.setPointerCapture(event.pointerId);
      }
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!isDragging) {
        return;
      }

      const dx = event.clientX - lastPointer.x;
      const dy = event.clientY - lastPointer.y;
      lastPointer = { x: event.clientX, y: event.clientY };
      state.yaw += dx * 0.01;
      state.pitch = clamp(state.pitch + dy * 0.01, -1.35, 1.35);
    });

    canvas.addEventListener("pointerup", (event) => {
      isDragging = false;
      if (canvas.releasePointerCapture) {
        canvas.releasePointerCapture(event.pointerId);
      }
    });

    canvas.addEventListener("pointercancel", () => {
      isDragging = false;
    });

    canvas.addEventListener("wheel", (event) => {
      event.preventDefault();
      state.zoom = clamp(state.zoom + event.deltaY * 0.003, 2.35, 7.5);
    }, { passive: false });
  }

  function installResizeHandling() {
    if ("ResizeObserver" in window) {
      resizeObserver = new ResizeObserver(resizeCanvasToDisplaySize);
      resizeObserver.observe(canvas);
    } else {
      window.addEventListener("resize", resizeCanvasToDisplaySize);
    }
    window.addEventListener("orientationchange", resizeCanvasToDisplaySize);
    resizeCanvasToDisplaySize();
  }

  function renderFrame(now) {
    const deltaSeconds = Math.min(0.05, Math.max(0, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    if (state.autoRotate && !isDragging) {
      state.yaw += deltaSeconds * (0.18 + state.speed * 1.4);
    }

    drawScene();
    requestAnimationFrame(renderFrame);
  }

  function drawScene() {
    if (!meshInfo) {
      return;
    }

    resizeCanvasToDisplaySize();

    const aspect = canvas.width / Math.max(1, canvas.height);
    const projection = mat4Perspective(Math.PI / 4, aspect, 0.1, 100);
    const view = mat4LookAt([0, 0, state.zoom], [0, 0, 0], [0, 1, 0]);
    const model = mat4Multiply(mat4RotationY(state.yaw), mat4RotationX(state.pitch));
    const normalMatrix = mat3FromMat4(model);
    const color = hexToRgb(state.color);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.useProgram(program);

    gl.uniformMatrix4fv(locations.projection, false, projection);
    gl.uniformMatrix4fv(locations.view, false, view);
    gl.uniformMatrix4fv(locations.model, false, model);
    gl.uniformMatrix3fv(locations.normalMatrix, false, normalMatrix);
    gl.uniform3fv(locations.color, color);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.enableVertexAttribArray(locations.position);
    gl.vertexAttribPointer(locations.position, 3, gl.FLOAT, false, 0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
    gl.enableVertexAttribArray(locations.normal);
    gl.vertexAttribPointer(locations.normal, 3, gl.FLOAT, false, 0, 0);

    if (state.wireframe) {
      gl.uniform1i(locations.wireframe, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.wire);
      gl.drawElements(gl.LINES, meshInfo.wireIndexCount, gl.UNSIGNED_SHORT, 0);
    } else {
      gl.uniform1i(locations.wireframe, 0);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.triangle);
      gl.drawElements(gl.TRIANGLES, meshInfo.triangleIndexCount, gl.UNSIGNED_SHORT, 0);
    }
  }

  function rebuildMesh() {
    if (!gl || !buffers) {
      return;
    }

    const mesh = createMesh(state.solid, state.detail);
    const wireIndices = createWireframeIndices(mesh.indices);
    const vertexTotal = mesh.positions.length / 3;

    if (vertexTotal > 65535) {
      showError("Generated mesh is too large for this WebGL 1 demo. Lower the detail setting.");
      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.position);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.positions), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normal);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh.normals), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.triangle);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(mesh.indices), gl.STATIC_DRAW);

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffers.wire);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(wireIndices), gl.STATIC_DRAW);

    meshInfo = {
      vertexCount: vertexTotal,
      triangleCount: mesh.indices.length / 3,
      triangleIndexCount: mesh.indices.length,
      wireIndexCount: wireIndices.length,
    };

    if (vertexCount) {
      vertexCount.textContent = formatNumber(meshInfo.vertexCount);
    }
    if (triangleCount) {
      triangleCount.textContent = formatNumber(meshInfo.triangleCount);
    }

    updateStatus();
  }

  function updateDetailOutput() {
    if (detailOutput) {
      detailOutput.textContent = String(state.detail);
    }
  }

  function updateColorOutput() {
    if (colorValue) {
      colorValue.textContent = state.color.toLowerCase();
    }
  }

  function updateSpeedOutput() {
    if (speedOutput) {
      speedOutput.textContent = `${Math.round(state.speed * 100)}%`;
    }
  }

  function updateStatus() {
    if (!meshInfo) {
      return;
    }

    const solidName = state.solid.charAt(0).toUpperCase() + state.solid.slice(1);
    const renderMode = state.wireframe ? "wireframe" : "solid shaded";
    showStatus(`${solidName} generated at detail ${state.detail}: ${formatNumber(meshInfo.vertexCount)} vertices, ${formatNumber(meshInfo.triangleCount)} triangles, ${renderMode}.`, false);
  }

  function resizeCanvasToDisplaySize() {
    if (!gl) {
      return false;
    }

    const rect = canvas.getBoundingClientRect();
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2.5);
    const width = Math.max(1, Math.round(rect.width * pixelRatio));
    const height = Math.max(1, Math.round(rect.height * pixelRatio));

    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      gl.viewport(0, 0, width, height);
      return true;
    }

    return false;
  }

  function createProgram(context, vertexSource, fragmentSource) {
    const vertexShader = createShader(context, context.VERTEX_SHADER, vertexSource);
    const fragmentShader = createShader(context, context.FRAGMENT_SHADER, fragmentSource);
    const nextProgram = context.createProgram();

    context.attachShader(nextProgram, vertexShader);
    context.attachShader(nextProgram, fragmentShader);
    context.linkProgram(nextProgram);

    if (!context.getProgramParameter(nextProgram, context.LINK_STATUS)) {
      const message = context.getProgramInfoLog(nextProgram) || "unknown link error";
      context.deleteProgram(nextProgram);
      throw new Error(message);
    }

    context.deleteShader(vertexShader);
    context.deleteShader(fragmentShader);
    return nextProgram;
  }

  function createShader(context, type, source) {
    const shader = context.createShader(type);
    context.shaderSource(shader, source);
    context.compileShader(shader);

    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) {
      const message = context.getShaderInfoLog(shader) || "unknown shader compile error";
      context.deleteShader(shader);
      throw new Error(message);
    }

    return shader;
  }

  function getLocations(context, nextProgram) {
    return {
      position: context.getAttribLocation(nextProgram, "aPosition"),
      normal: context.getAttribLocation(nextProgram, "aNormal"),
      projection: context.getUniformLocation(nextProgram, "uProjection"),
      view: context.getUniformLocation(nextProgram, "uView"),
      model: context.getUniformLocation(nextProgram, "uModel"),
      normalMatrix: context.getUniformLocation(nextProgram, "uNormalMatrix"),
      color: context.getUniformLocation(nextProgram, "uColor"),
      wireframe: context.getUniformLocation(nextProgram, "uWireframe"),
    };
  }

  function createBuffers(context) {
    return {
      position: context.createBuffer(),
      normal: context.createBuffer(),
      triangle: context.createBuffer(),
      wire: context.createBuffer(),
    };
  }

  function createMesh(type, detail) {
    switch (type) {
      case "cube":
        return createCube();
      case "sphere":
        return createSphere(detail);
      case "cylinder":
        return createCylinder(detail);
      case "cone":
        return createCone(detail);
      case "torus":
        return createTorus(detail);
      default:
        return createSphere(detail);
    }
  }

  function createCube() {
    const positions = [];
    const normals = [];
    const indices = [];
    const faces = [
      { normal: [0, 0, 1], corners: [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]] },
      { normal: [0, 0, -1], corners: [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]] },
      { normal: [1, 0, 0], corners: [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]] },
      { normal: [-1, 0, 0], corners: [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]] },
      { normal: [0, 1, 0], corners: [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]] },
      { normal: [0, -1, 0], corners: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]] },
    ];

    faces.forEach((face) => {
      const base = positions.length / 3;
      face.corners.forEach((corner) => {
        positions.push(corner[0], corner[1], corner[2]);
        normals.push(face.normal[0], face.normal[1], face.normal[2]);
      });
      indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
    });

    return { positions, normals, indices };
  }

  function createSphere(detail) {
    const rings = clamp(Math.round(detail), 4, 64);
    const segments = rings * 2;
    const positions = [];
    const normals = [];
    const indices = [];

    for (let ring = 0; ring <= rings; ring += 1) {
      const theta = (ring * Math.PI) / rings;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);

      for (let segment = 0; segment <= segments; segment += 1) {
        const phi = (segment * Math.PI * 2) / segments;
        const x = Math.cos(phi) * sinTheta;
        const y = cosTheta;
        const z = Math.sin(phi) * sinTheta;
        positions.push(x, y, z);
        normals.push(x, y, z);
      }
    }

    for (let ring = 0; ring < rings; ring += 1) {
      for (let segment = 0; segment < segments; segment += 1) {
        const first = ring * (segments + 1) + segment;
        const second = first + segments + 1;
        indices.push(first, second, first + 1, first + 1, second, second + 1);
      }
    }

    return { positions, normals, indices };
  }

  function createCylinder(detail) {
    const segments = clamp(Math.round(detail), 4, 96);
    const radius = 0.95;
    const halfHeight = 1;
    const positions = [];
    const normals = [];
    const indices = [];

    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment * Math.PI * 2) / segments;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      positions.push(x * radius, -halfHeight, z * radius, x * radius, halfHeight, z * radius);
      normals.push(x, 0, z, x, 0, z);
    }

    for (let segment = 0; segment < segments; segment += 1) {
      const bottomA = segment * 2;
      const topA = bottomA + 1;
      const bottomB = (segment + 1) * 2;
      const topB = bottomB + 1;
      indices.push(bottomA, topA, bottomB, topA, topB, bottomB);
    }

    const topCenter = positions.length / 3;
    positions.push(0, halfHeight, 0);
    normals.push(0, 1, 0);
    const topStart = positions.length / 3;
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment * Math.PI * 2) / segments;
      positions.push(Math.cos(angle) * radius, halfHeight, Math.sin(angle) * radius);
      normals.push(0, 1, 0);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(topCenter, topStart + segment + 1, topStart + segment);
    }

    const bottomCenter = positions.length / 3;
    positions.push(0, -halfHeight, 0);
    normals.push(0, -1, 0);
    const bottomStart = positions.length / 3;
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment * Math.PI * 2) / segments;
      positions.push(Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius);
      normals.push(0, -1, 0);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(bottomCenter, bottomStart + segment, bottomStart + segment + 1);
    }

    return { positions, normals, indices };
  }

  function createCone(detail) {
    const segments = clamp(Math.round(detail), 4, 96);
    const radius = 1;
    const halfHeight = 1;
    const height = halfHeight * 2;
    const positions = [];
    const normals = [];
    const indices = [];

    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment * Math.PI * 2) / segments;
      const x = Math.cos(angle);
      const z = Math.sin(angle);
      const normal = normalize([x * height, radius, z * height]);
      positions.push(x * radius, -halfHeight, z * radius, 0, halfHeight, 0);
      normals.push(normal[0], normal[1], normal[2], normal[0], normal[1], normal[2]);
    }

    for (let segment = 0; segment < segments; segment += 1) {
      const baseA = segment * 2;
      const apexA = baseA + 1;
      const baseB = (segment + 1) * 2;
      indices.push(baseA, apexA, baseB);
    }

    const bottomCenter = positions.length / 3;
    positions.push(0, -halfHeight, 0);
    normals.push(0, -1, 0);
    const bottomStart = positions.length / 3;
    for (let segment = 0; segment <= segments; segment += 1) {
      const angle = (segment * Math.PI * 2) / segments;
      positions.push(Math.cos(angle) * radius, -halfHeight, Math.sin(angle) * radius);
      normals.push(0, -1, 0);
    }
    for (let segment = 0; segment < segments; segment += 1) {
      indices.push(bottomCenter, bottomStart + segment, bottomStart + segment + 1);
    }

    return { positions, normals, indices };
  }

  function createTorus(detail) {
    const tubeSegments = clamp(Math.round(detail), 4, 64);
    const ringSegments = tubeSegments * 2;
    const majorRadius = 0.66;
    const tubeRadius = 0.3;
    const positions = [];
    const normals = [];
    const indices = [];

    for (let ring = 0; ring <= ringSegments; ring += 1) {
      const u = (ring * Math.PI * 2) / ringSegments;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);

      for (let tube = 0; tube <= tubeSegments; tube += 1) {
        const v = (tube * Math.PI * 2) / tubeSegments;
        const cosV = Math.cos(v);
        const sinV = Math.sin(v);
        const radius = majorRadius + tubeRadius * cosV;
        const x = radius * cosU;
        const y = tubeRadius * sinV;
        const z = radius * sinU;
        positions.push(x, y, z);
        normals.push(cosV * cosU, sinV, cosV * sinU);
      }
    }

    for (let ring = 0; ring < ringSegments; ring += 1) {
      for (let tube = 0; tube < tubeSegments; tube += 1) {
        const first = ring * (tubeSegments + 1) + tube;
        const second = first + tubeSegments + 1;
        indices.push(first, second, first + 1, first + 1, second, second + 1);
      }
    }

    return { positions, normals, indices };
  }

  function createWireframeIndices(triangleIndices) {
    const seenEdges = new Set();
    const wireIndices = [];

    for (let index = 0; index < triangleIndices.length; index += 3) {
      addEdge(triangleIndices[index], triangleIndices[index + 1]);
      addEdge(triangleIndices[index + 1], triangleIndices[index + 2]);
      addEdge(triangleIndices[index + 2], triangleIndices[index]);
    }

    return wireIndices;

    function addEdge(a, b) {
      const low = Math.min(a, b);
      const high = Math.max(a, b);
      const key = `${low}:${high}`;

      if (seenEdges.has(key)) {
        return;
      }

      seenEdges.add(key);
      wireIndices.push(low, high);
    }
  }

  function mat4Perspective(fieldOfView, aspect, near, far) {
    const f = 1 / Math.tan(fieldOfView / 2);
    const rangeInv = 1 / (near - far);

    return new Float32Array([
      f / aspect, 0, 0, 0,
      0, f, 0, 0,
      0, 0, (near + far) * rangeInv, -1,
      0, 0, near * far * 2 * rangeInv, 0,
    ]);
  }

  function mat4LookAt(eye, center, up) {
    const zAxis = normalize([
      eye[0] - center[0],
      eye[1] - center[1],
      eye[2] - center[2],
    ]);
    const xAxis = normalize(cross(up, zAxis));
    const yAxis = cross(zAxis, xAxis);

    return new Float32Array([
      xAxis[0], yAxis[0], zAxis[0], 0,
      xAxis[1], yAxis[1], zAxis[1], 0,
      xAxis[2], yAxis[2], zAxis[2], 0,
      -dot(xAxis, eye), -dot(yAxis, eye), -dot(zAxis, eye), 1,
    ]);
  }

  function mat4RotationX(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      1, 0, 0, 0,
      0, c, s, 0,
      0, -s, c, 0,
      0, 0, 0, 1,
    ]);
  }

  function mat4RotationY(angle) {
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return new Float32Array([
      c, 0, -s, 0,
      0, 1, 0, 0,
      s, 0, c, 0,
      0, 0, 0, 1,
    ]);
  }

  function mat4Multiply(a, b) {
    const out = new Float32Array(16);

    for (let column = 0; column < 4; column += 1) {
      for (let row = 0; row < 4; row += 1) {
        out[column * 4 + row] =
          a[0 * 4 + row] * b[column * 4 + 0] +
          a[1 * 4 + row] * b[column * 4 + 1] +
          a[2 * 4 + row] * b[column * 4 + 2] +
          a[3 * 4 + row] * b[column * 4 + 3];
      }
    }

    return out;
  }

  function mat3FromMat4(matrix) {
    return new Float32Array([
      matrix[0], matrix[1], matrix[2],
      matrix[4], matrix[5], matrix[6],
      matrix[8], matrix[9], matrix[10],
    ]);
  }

  function normalize(vector) {
    const length = Math.hypot(vector[0], vector[1], vector[2]) || 1;
    return [vector[0] / length, vector[1] / length, vector[2] / length];
  }

  function cross(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
  }

  function dot(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  }

  function hexToRgb(hex) {
    const normalized = hex.replace("#", "").trim();
    const value = normalized.length === 3 ?
      normalized.split("").map((character) => character + character).join("") :
      normalized.padEnd(6, "0").slice(0, 6);
    const parsed = Number.parseInt(value, 16);

    return new Float32Array([
      ((parsed >> 16) & 255) / 255,
      ((parsed >> 8) & 255) / 255,
      (parsed & 255) / 255,
    ]);
  }

  function showStatus(message, isError) {
    if (!statusPanel) {
      return;
    }

    statusPanel.textContent = message;
    statusPanel.classList.toggle("is-visible", Boolean(message));
    statusPanel.classList.toggle("status-panel--error", Boolean(isError));
  }

  function showError(message) {
    showStatus(message, true);
  }

  function disableControls() {
    document.querySelectorAll(".controls input, .controls select, .controls button").forEach((control) => {
      control.disabled = true;
    });
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function formatNumber(value) {
    return new Intl.NumberFormat("en").format(value);
  }

  window.addEventListener("pagehide", () => {
    if (resizeObserver) {
      resizeObserver.disconnect();
    }
  });
})();
