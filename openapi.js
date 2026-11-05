function inlineSchemaRefs(openApi) {
  if (!openApi || typeof openApi !== "object") {
    throw new TypeError("Expected an OpenAPI document object");
  }

  const schemaRefPrefix = "#/components/schemas/";

  function decodePointerSegment(segment) {
    // JSON Pointer escaping: ~1 means "/", and ~0 means "~".
    return segment.replace(/~1/g, "/").replace(/~0/g, "~");
  }

  function resolveSchemaRef(ref) {
    if (!ref.startsWith(schemaRefPrefix)) return null;

    const pointer = ref.slice(2).split("/"); // Drop "#/"
    let value = openApi;

    for (const rawSegment of pointer) {
      const segment = decodePointerSegment(rawSegment);

      if (
        value == null ||
        !Object.prototype.hasOwnProperty.call(value, segment)
      ) {
        throw new Error(`Unresolved schema reference: ${ref}`);
      }

      value = value[segment];
    }

    return value;
  }

  function walk(value, activeRefs = new Set()) {
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, activeRefs));
    }

    if (!value || typeof value !== "object") {
      return value;
    }

    if (
      typeof value.$ref === "string" &&
      value.$ref.startsWith(schemaRefPrefix)
    ) {
      const ref = value.$ref;

      // Avoid infinite expansion for recursive schemas.
      if (activeRefs.has(ref)) {
        return { ...value };
      }

      const target = resolveSchemaRef(ref);
      if (!target || typeof target !== "object") {
        throw new Error(`Schema reference does not point to an object: ${ref}`);
      }

      const nextActiveRefs = new Set(activeRefs);
      nextActiveRefs.add(ref);

      // Expand the target, then retain any sibling fields from the $ref object.
      const expandedTarget = walk(target, nextActiveRefs);
      const siblings = { ...value };
      delete siblings.$ref;

      return {
        ...expandedTarget,
        ...walk(siblings, activeRefs),
      };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        walk(child, activeRefs),
      ]),
    );
  }

  // Walk every path item and its operations.
  return walk(openApi.paths ?? {});
}
