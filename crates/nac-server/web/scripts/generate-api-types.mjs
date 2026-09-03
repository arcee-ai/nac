// Generates runtime-free TypeScript schema types from nac-server's OpenAPI 3.1
// document. The converter intentionally supports only the JSON Schema features
// emitted by this repository's utoipa contract; encountering a new construct
// fails generation instead of silently widening the public API to `any`.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(scriptDir, "..");
const inputPath = path.join(webDir, "openapi.json");
const outputPath = path.join(webDir, "src/app/types/openapi.generated.ts");
const check = process.argv.slice(2).includes("--check");

const document = JSON.parse(await readFile(inputPath, "utf8"));
if (document.openapi !== "3.1.0") {
  throw new Error(`expected OpenAPI 3.1.0, received ${JSON.stringify(document.openapi)}`);
}

const schemas = document.components?.schemas;
if (!schemas || typeof schemas !== "object" || Array.isArray(schemas)) {
  throw new Error("OpenAPI document has no components.schemas object");
}

function quote(value) {
  return JSON.stringify(value);
}

function propertyName(name) {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : quote(name);
}

function refType(ref) {
  const prefix = "#/components/schemas/";
  if (!ref.startsWith(prefix)) {
    throw new Error(`unsupported OpenAPI reference ${quote(ref)}`);
  }
  const name = decodeURIComponent(ref.slice(prefix.length));
  if (!(name in schemas)) {
    throw new Error(`unknown OpenAPI schema reference ${quote(name)}`);
  }
  return `components["schemas"][${quote(name)}]`;
}

function union(types) {
  const unique = [...new Set(types)];
  return unique.length === 1 ? unique[0] : unique.map((type) => `(${type})`).join(" | ");
}

function intersection(types) {
  const unique = [...new Set(types)];
  return unique.length === 1 ? unique[0] : unique.map((type) => `(${type})`).join(" & ");
}

function primitive(type, schema, location) {
  switch (type) {
    case "null":
      return "null";
    case "boolean":
      return "boolean";
    case "integer":
    case "number":
      return "number";
    case "string":
      return "string";
    case "array":
      return `(${schemaType(schema.items ?? {}, `${location}.items`)})[]`;
    case "object":
      return objectType(schema, location);
    default:
      throw new Error(`${location}: unsupported schema type ${quote(type)}`);
  }
}

function objectType(schema, location) {
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);
  const fields = Object.entries(properties).map(([name, property]) => {
    const optional = required.has(name) ? "" : "?";
    return `${propertyName(name)}${optional}: ${schemaType(property, `${location}.${name}`)};`;
  });

  let object = fields.length === 0 ? "Record<string, never>" : `{ ${fields.join(" ")} }`;
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    const value =
      schema.additionalProperties === true
        ? "unknown"
        : schemaType(schema.additionalProperties, `${location}.additionalProperties`);
    const record = `Record<string, ${value}>`;
    object = fields.length === 0 ? record : intersection([object, record]);
  }
  return object;
}

function schemaType(schema, location) {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`${location}: expected a schema object`);
  }
  if (schema.$ref) {
    return refType(schema.$ref);
  }
  if (schema.enum) {
    return union(schema.enum.map((value) => quote(value)));
  }
  if (schema.oneOf) {
    return union(
      schema.oneOf.map((entry, index) => schemaType(entry, `${location}.oneOf[${index}]`)),
    );
  }
  if (schema.anyOf) {
    return union(
      schema.anyOf.map((entry, index) => schemaType(entry, `${location}.anyOf[${index}]`)),
    );
  }
  if (schema.allOf) {
    return intersection(
      schema.allOf.map((entry, index) => schemaType(entry, `${location}.allOf[${index}]`)),
    );
  }
  if (Array.isArray(schema.type)) {
    return union(schema.type.map((type) => primitive(type, schema, location)));
  }
  if (typeof schema.type === "string") {
    return primitive(schema.type, schema, location);
  }
  if (schema.properties || schema.additionalProperties !== undefined) {
    return objectType(schema, location);
  }
  if (
    Object.keys(schema).every((key) =>
      ["description", "example", "format", "writeOnly"].includes(key),
    )
  ) {
    return "unknown";
  }
  throw new Error(`${location}: unsupported schema keys ${Object.keys(schema).sort().join(", ")}`);
}

const entries = Object.keys(schemas)
  .sort((left, right) => left.localeCompare(right, "en"))
  .map(
    (name) =>
      `    ${propertyName(name)}: ${schemaType(schemas[name], `components.schemas.${name}`)};`,
  )
  .join("\n");

const unformatted = `// @generated by scripts/generate-api-types.mjs from ../../openapi.json.
// Do not edit by hand. Run \`make generate-api-contract\` from the repository root.

export interface components {
  schemas: {
${entries}
  };
}

export type ApiSchema<Name extends keyof components["schemas"]> = components["schemas"][Name];
`;

const temporaryDirectory = await mkdtemp(path.join(tmpdir(), "nac-openapi-types-"));
const temporaryOutput = path.join(temporaryDirectory, "openapi.generated.ts");
let generated;
try {
  await writeFile(temporaryOutput, unformatted);
  const formatter = path.join(webDir, "node_modules/.bin/oxfmt");
  const result = spawnSync(formatter, ["--write", temporaryOutput], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`oxfmt failed: ${result.stderr || result.stdout}`);
  }
  generated = await readFile(temporaryOutput, "utf8");
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}

if (check) {
  const existing = await readFile(outputPath, "utf8");
  if (existing !== generated) {
    throw new Error(
      `${path.relative(process.cwd(), outputPath)} is stale; run make generate-api-contract`,
    );
  }
  console.log(`${path.relative(process.cwd(), outputPath)} is current`);
} else {
  await writeFile(outputPath, generated);
  console.log(`wrote ${path.relative(process.cwd(), outputPath)}`);
}
