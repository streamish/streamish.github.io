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
  if (!response.ok) {
    throw new Error(
      `Failed to load API specification: HTTP ${response.status}`,
    );
  }
  const spec = await response.json();
  const expandedPaths = inlineSchemaRefs(spec);
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

function span(className, value) {
  return `<span class="${className}">${value}</span>`;
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

function codeSpan(className, value) {
  return `<span class="${className}">${value}</span>`;
}

function formatComment(description, depth, width) {
  const indent = "  ".repeat(depth);
  const available = Math.max(1, width - indent.length - 3);
  const words = description.trim().split(/\s+/);
  const lines = [];
  let line = "";

  for (const word of words) {
    let remaining = word;
    if (line && line.length + 1 + remaining.length > available) {
      lines.push(line);
      line = "";
    }
    while (remaining.length > available) {
      lines.push(remaining.slice(0, available));
      remaining = remaining.slice(available);
    }
    if (remaining) {
      line += (line ? " " : "") + remaining;
    }
  }
  if (line) lines.push(line);
  return lines
    .map((text) => `${indent}${codeSpan("code-comment", `// ${escapeHtml(text)}`)}`)
    .join("\n");
}

function formatUnion(parts, depth) {
  if (parts.length === 1) return parts[0];
  const indent = "  ".repeat(depth + 1);
  return `\n${parts.map((part) => `${indent}| ${part}`).join("\n")}`;
}

function formatSchema(schema, depth = 0, width = Infinity) {
  if (!schema) {
    return codeSpan("code-keyword", "unknown");
  }
  if (schema.$ref) {
    return codeSpan("code-keyword", escapeHtml(schema.$ref.split("/").pop()));
  }
  if (schema.enum) {
    const values = schema.enum
      .map((value) => {
        const formatted =
          typeof value === "string" ? JSON.stringify(value) : String(value);
        return codeSpan("code-string", escapeHtml(formatted));
      });
    return values.length ? formatUnion(values, depth) : codeSpan("code-keyword", "unknown");
  }
  for (const keyword of ["oneOf", "anyOf", "allOf"]) {
    if (schema[keyword]) {
      const parts = schema[keyword].map((part) =>
        formatSchema(part, keyword === "allOf" ? depth : depth + 1, width),
      );
      return keyword === "allOf" ? parts.join(" & ") : formatUnion(parts, depth);
    }
  }
  if (schema.type === "array" || schema.items) {
    return (
      codeSpan("code-keyword", "Array") +
      "&lt;" +
      formatSchema(schema.items, depth, width) +
      "&gt;"
    );
  }
  if (schema.type === "object" || schema.properties) {
    const properties = schema.properties ?? {};
    const required = new Set(schema.required ?? []);
    const entries = Object.entries(properties);
    if (!entries.length) {
      if (schema.additionalProperties) {
        return (
          codeSpan("code-keyword", "Record") +
          "&lt;" +
          codeSpan("code-keyword", "string") +
          ", " +
          formatSchema(schema.additionalProperties, depth, width) +
          "&gt;"
        );
      }
      return (
        codeSpan("code-keyword", "Record") +
        "&lt;" +
        codeSpan("code-keyword", "string") +
        ", " +
        codeSpan("code-keyword", "unknown") +
        "&gt;"
      );
    }
    const fields = entries.map(([name, property]) => {
      const propertyIndent = "  ".repeat(depth + 1);
      const optionalMark = required.has(name) ? "" : "?";
      const description = property.description
        ? `${formatComment(property.description, depth + 1, width)}\n`
        : "";
      return (
        description +
        `${propertyIndent}${codeSpan("code-variable", escapeHtml(name))}${optionalMark}: ` +
        formatSchema(property, depth + 1, width)
      );
    });
    return `{\n${fields.join("\n")}\n${"  ".repeat(depth)}}`;
  }
  if (schema.type) {
    const type = codeSpan("code-keyword", escapeHtml(schema.type));
    return schema.nullable
      ? formatUnion([type, codeSpan("code-keyword", "null")], depth)
      : type;
  }
  return codeSpan("code-keyword", "unknown");
}

function formatValue(value) {
  return typeof value === "string" ? JSON.stringify(value) : String(value);
}

function getJsonSchema(content) {
  return content?.["application/json"]?.schema;
}

function formatEndpointRequestParameters(method, endpoint, width = Infinity) {
  const parameters = endpoint[method].parameters ?? [];
  return parameters
    .map((parameter) => {
      const schema =
        parameter.schema ?? parameter.content?.["application/json"]?.schema;
      const type = formatSchema(schema, 0, width);
      const required = parameter.required ? "required" : "optional";
      const description = parameter.description
        ? `${formatComment(parameter.description, 0, width)}\n`
        : "";

      return (
        description +
        `${span("code-variable", escapeHtml(parameter.name))}: ` +
        `${span("code-keyword", type)} ` +
        span("code-comment", `(${required})`)
      );
    })
    .join("\n");
}

function formatEndpointRequestBody(method, endpoint, width = Infinity) {
  const schema = getJsonSchema(endpoint[method].requestBody?.content);
  const formatted = schema ? formatSchema(schema, 0, width) : "";
  return formatted ? formatted : "";
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
    if (status !== "default" && !/^[45]\d\d$/.test(status)) {
      continue;
    }
    for (const media of Object.values(response.content ?? {})) {
      collectEnums(media.schema?.properties?.message);
    }
  }
  return [...codes]
    .sort((a, b) => a.localeCompare(b))
    .map((code) => span("code-string", escapeHtml(code)))
    .join("\n");
}

function formatEndpointResponse(method, endpoint, width = Infinity) {
  const responses = endpoint[method].responses ?? {};
  const response =
    responses["200"] ??
    responses["201"] ??
    responses["202"] ??
    responses.default;
  const schema = getJsonSchema(response?.content);
  const formatted = schema ? formatSchema(schema, 0, width) : "";
  return formatted ? span("code-keyword", formatted) : "";
}

function operationCategories(operation) {
  const categories = [];
  if (operation.tags?.includes("Admin APIs")) categories.push("Administrative");
  const controller = /^Api(.+)Controller_/.exec(operation.operationId ?? "")?.[1];
  if (controller) {
    categories.push(controller === "Shoutcast"
      ? "SHOUTcast"
      : controller.replace(/([a-z])([A-Z])/g, "$1 $2"));
  } else {
    categories.push("Other");
  }
  return categories;
}

function renderApiEndpoints(paths) {
  const list = document.getElementById("api-endpoint-list");
  const filters = document.getElementById("api-filters");
  const panels = {
    route: document.getElementById("api-route"),
    description: document.getElementById("api-description"),
    parameters: document.getElementById("api-parameters"),
    body: document.getElementById("api-request-body"),
    response: document.getElementById("api-response"),
    errors: document.getElementById("api-errors"),
  };
  const methods = [
    "get",
    "put",
    "post",
    "delete",
    "options",
    "head",
    "patch",
    "trace",
  ];
  const operations = paths.flatMap((endpoint) =>
    methods
      .filter((method) => endpoint[method])
      .map((method) => ({ endpoint, method })),
  );
  if (!operations.length) {
    if (list) list.textContent = "No API endpoints found.";
    return;
  }
  const context = document.createElement("canvas").getContext("2d");
  function panelWidth(panel) {
    const style = getComputedStyle(panel);
    context.font = `${style.fontSize} ${style.fontFamily}`;
    return Math.max(1, Math.floor((panel.clientWidth - 1) / context.measureText("M").width));
  }
  let selectedOperation;
  function methodLabel(method) {
    const label = document.createElement("span");
    label.className = `api-method api-method--${method}`;
    label.textContent = method.toUpperCase();
    return label;
  }
  function renderDetails() {
    if (!selectedOperation) return;
    const { method, endpoint } = selectedOperation;
    panels.parameters.innerHTML =
      formatEndpointRequestParameters(method, endpoint, panelWidth(panels.parameters)) || "None.";
    panels.body.innerHTML =
      formatEndpointRequestBody(method, endpoint, panelWidth(panels.body)) || "None.";
    panels.response.innerHTML =
      formatEndpointResponse(method, endpoint, panelWidth(panels.response)) ||
      "No response format documented.";
    panels.errors.innerHTML =
      formatEndpointErrorCodes(method, endpoint) ||
      "No error codes documented.";
  }

  function selectOperation(index) {
    const { endpoint, method } = operations[index];
    if (list) {
      list.querySelectorAll("button").forEach((button) =>
        button.setAttribute("aria-pressed", String(button.dataset.index === String(index))),
      );
    }
    selectedOperation = { endpoint, method };
    panels.route.replaceChildren(
      document.createTextNode(`${endpoint.path} `),
      methodLabel(method),
    );
    panels.route.hidden = false;
    const description = endpoint[method].description ?? "";
    panels.description.textContent = description;
    panels.description.hidden = !description.trim();
    renderDetails();
  }

  if (list && filters) {
    const categoryNames = new Set(
      operations.flatMap(({ endpoint, method }) => operationCategories(endpoint[method])),
    );
    const categories = [
      "All",
      ...[...categoryNames].sort((a, b) =>
        a === "Administrative" ? -1 : b === "Administrative" ? 1 : a.localeCompare(b),
      ),
    ];
    let activeCategory = "All";
    let selectedIndex = 0;
    function renderList() {
      list.replaceChildren();
      const indexes = operations.map((_, index) => index).filter((index) => {
        const { endpoint, method } = operations[index];
        return activeCategory === "All" ||
          operationCategories(endpoint[method]).includes(activeCategory);
      });
      if (!indexes.includes(selectedIndex)) selectedIndex = indexes[0];
      indexes.forEach((index) => {
        const { endpoint, method } = operations[index];
        const button = document.createElement("button");
        button.type = "button";
        button.className = "api-list-item";
        button.dataset.index = String(index);
        button.append(methodLabel(method), document.createTextNode(` ${endpoint.path}`));
        button.addEventListener("click", () => {
          selectedIndex = index;
          selectOperation(index);
        });
        list.appendChild(button);
      });
      selectOperation(selectedIndex);
    }
    filters.replaceChildren();
    categories.forEach((category) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "api-filter";
      button.textContent = category;
      button.setAttribute("aria-pressed", String(category === activeCategory));
      button.addEventListener("click", () => {
        activeCategory = category;
        filters.querySelectorAll("button").forEach((item) =>
          item.setAttribute("aria-pressed", String(item === button)),
        );
        renderList();
      });
      filters.appendChild(button);
    });
    renderList();
  }
  const observedWidths = new WeakMap();
  const observer = new ResizeObserver((entries) => {
    let changed = false;
    for (const entry of entries) {
      if (observedWidths.get(entry.target) !== entry.contentRect.width) {
        observedWidths.set(entry.target, entry.contentRect.width);
        changed = true;
      }
    }
    if (changed) renderDetails();
  });
  [panels.parameters, panels.body, panels.response].forEach((panel) =>
    observer.observe(panel),
  );
}

window.onload = async () => {
  // load the swagger spec
  fetchOpenApiSpec()
    .then(renderApiEndpoints)
    .catch((error) => {
      console.error("Unable to render API endpoints:", error);
      const list = document.getElementById("api-endpoint-list");
      if (list) list.textContent = "Unable to load API endpoints.";
    });
  // set up rotating content for the compatible app types and code sample
  if (document.getElementById("compatible-type")) rotateCompatibleAppTypes();
};
