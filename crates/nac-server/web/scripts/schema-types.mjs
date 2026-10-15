export function quote(value) {
  return JSON.stringify(value);
}

export function propertyName(name) {
  return /^[$A-Z_a-z][$\w]*$/u.test(name) ? name : quote(name);
}

export function createSchemaConverter(
  schemas,
  referencePrefix = "#/components/schemas/",
  codecTypes = {},
) {
  function refType(ref) {
    const prefix = referencePrefix;
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
    if (schema["x-afm-codec"] !== undefined) {
      const codec = schema["x-afm-codec"];
      if (typeof codec !== "string" || !Object.hasOwn(codecTypes, codec)) {
        throw new Error(`${location}: unsupported wire codec ${quote(codec)}`);
      }
      return codecTypes[codec];
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
    throw new Error(
      `${location}: unsupported schema keys ${Object.keys(schema).sort().join(", ")}`,
    );
  }

  return schemaType;
}
