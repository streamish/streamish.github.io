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

  function walkPaths(value, activeRefs = new Set()) {
    if (Array.isArray(value)) {
      return value.map((item) => walkPaths(item, activeRefs));
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
      const expandedTarget = walkPaths(target, nextActiveRefs);
      const siblings = { ...value };
      delete siblings.$ref;

      return {
        ...expandedTarget,
        ...walkPaths(siblings, activeRefs),
      };
    }

    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        walkPaths(child, activeRefs),
      ]),
    );
  }

  // Walk every path item and its operations.
  return walkPaths(openApi.paths ?? {});
}

async function fetchOpenApiSpec() {
  const response = await fetch("./swagger.json");
  const spec = await response.json();
  console.log(spec);
  const expandedPaths = inlineSchemaRefs(spec);
  console.log(expandedPaths);
  return Object.keys(expandedPaths)
    .filter((path) => path.startsWith("/api/"))
    .sort((a, b) => {
      return a.localeCompare(b);
    })
    .map((path) => {
      return {
        ...expandedPaths[path],
        path,
      };
    });
}

function rotateCompatibleAppTypes() {
  const compatibleTypes = ["Synology", "QNAP", "Subsonic"];
  const compatibleType = document.getElementById("compatible-type");
  let compatibleIndex = 0;
  setInterval(() => {
    compatibleType.classList.add("is-changing");
    setTimeout(() => {
      compatibleIndex = (compatibleIndex + 1) % compatibleTypes.length;
      compatibleType.textContent = compatibleTypes[compatibleIndex];
      compatibleType.classList.remove("is-changing");
    }, 250);
  }, 2500);
}

function rotateCodeTab() {
  const tabButtons = document.querySelectorAll(".code-tab");
  const appType = document.getElementById("app-type");
  const appTabs = ["TypeScript", "iOS", "Android"];
  let appIndex = 0;
  const showTab = (name) => {
    appType.textContent = name;
    tabButtons.forEach((b) =>
      b.classList.toggle("active", b.dataset.tab === name.toLowerCase()),
    );
    appTabs.forEach((t) => {
      document.getElementById("code-" + t.toLowerCase()).hidden = t !== name;
    });
  };
  setInterval(() => {
    appType.classList.add("is-changing");
    setTimeout(() => {
      appIndex = (appIndex + 1) % appTabs.length;
      showTab(appTabs[appIndex]);
      appType.classList.remove("is-changing");
    }, 250);
  }, 2500);
}

function formatSchema(schema, depth = 0) {
  if (!schema) {
    return "unknown";
  }
  const indent = "  ".repeat(depth);
  if (schema.$ref) {
    return schema.$ref.split("/").pop();
  }
  if (schema.enum) {
    return schema.enum.map(formatValue).join(" | ");
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    if (schema[keyword]) {
      const parts = schema[keyword].map((part) => formatSchema(part, depth));
      return parts.join(keyword === "allOf" ? " & " : " | ");
    }
  }
  if (schema.type === "array" || schema.items) {
    return `Array<${formatSchema(schema.items, depth)}>`;
  }
  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(properties);
    if (!entries.length) {
      return schema.additionalProperties
        ? `Record<string, ${formatSchema(schema.additionalProperties, depth)}>`
        : "Record<string, unknown>";
    }
    const fields = entries.map(([name, property]) => {
      const propertyIndent = "  ".repeat(depth + 1);
      const optionalMark = required.has(name) ? "" : "?";
      const description = property.description
        ? `${propertyIndent}// ${property.description.replace(/\s+/g, " ")}\n`
        : "";
      return `${description}${propertyIndent}${name}${optionalMark}: ${formatSchema(
        property,
        depth + 1,
      )}`;
    });
    return `{\n${fields.join("\n")}\n${"  ".repeat(depth)}}`;
  }
  if (schema.type) {
    return schema.nullable ? `${schema.type} | null` : schema.type;
  }
  return "unknown";
}

function formatValue(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function getJsonSchema(content) {
  return content?.["application/json"]?.schema;
}

function formatEndpointRequestParameters(method, endpoint) {
  const parameters = endpoint[method].parameters ?? [];

  return parameters
    .map((parameter) => {
      const schema =
        parameter.schema ?? parameter.content?.["application/json"]?.schema;
      const required = parameter.required ? "required" : "optional";
      const type = formatSchema(schema);
      const description = parameter.description
        ? `// ${parameter.description.replace(/\s+/g, " ")}\n`
        : "";
      return `${description}${parameter.name}: ${type} (${required})`;
    })
    .join("\n");
}

function formatEndpointRequestBody(method, endpoint) {
  const schema = getJsonSchema(endpoint[method].requestBody?.content);
  return schema ? formatSchema(schema) : "";
}

function formatEndpointErrorCodes(method, endpoint) {
  const codes = new Set();
  function collectEnums(schema) {
    if (!schema) return;

    if (Array.isArray(schema.enum)) {
      schema.enum.forEach((value) => codes.add(String(value)));
    }
    for (const keyword of ["oneOf", "anyOf", "allOf"]) {
      schema[keyword]?.forEach(collectEnums);
    }
    if (schema.items) {
      collectEnums(schema.items);
    }
  }
  const responses = endpoint[method].responses ?? {};
  for (const [status, response] of Object.entries(responses)) {
    if (status !== "default" && !/^[45]\d\d$/.test(status)) continue;
    for (const media of Object.values(response.content ?? {})) {
      const messageSchema = media.schema?.properties?.message;
      collectEnums(messageSchema);
    }
  }
  return [...codes].sort((a, b) => a.localeCompare(b)).join("\n");
}

function formatEndpointResponse(method, endpoint) {
  const responses = endpoint[method].responses ?? {};
  const response =
    responses["200"] ??
    responses["201"] ??
    responses["202"] ??
    responses.default;
  const schema = getJsonSchema(response?.content);
  return schema ? formatSchema(schema) : "";
}

function formatEndpointPath(method, endpoint) {
  return `<pre>${method ? method.toUpperCase() : ""} ${endpoint.path}</pre>`;
}

function formatEndpoint(endpoint) {
  const method = Object.keys(endpoint).find((key) => key !== "path");
  return `
    <tr>
        <td>${formatEndpointPath(method, endpoint)}</td>
        <td><pre>${formatEndpointRequestParameters(method, endpoint)}</pre></td>
        <td><pre>${formatEndpointRequestBody(method, endpoint)}</pre></td>
        <td><pre>${formatEndpointResponse(method, endpoint)}</pre></td>
        <td><pre>${formatEndpointErrorCodes(method, endpoint)}</pre></td>
    </tr>`;
}

function renderApiEndpoints(paths) {
  console.log("rendering api endpoints", paths);
  const table = document.getElementById("api-endpoints");
  const tbody = document.createElement("tbody");
  tbody.innerHTML = paths.map((path) => formatEndpoint(path)).join("");
  table.appendChild(tbody);
}

window.onload = async () => {
  // load the swagger spec
  fetchOpenApiSpec().then(renderApiEndpoints);
  // set up rotating content for the compatible app types and code sample
  rotateCompatibleAppTypes();
  rotateCodeTab();
};
