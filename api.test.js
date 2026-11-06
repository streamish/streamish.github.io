const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const context = vm.createContext({ window: {} });
vm.runInContext(fs.readFileSync(path.join(__dirname, "api.js"), "utf8"), context);
const { formatComment, formatSchema, inlineSchemaRefs, operationCategories } = context;
const text = (html) => html.replace(/<[^>]*>/g, "").replace(/&quot;/g, '"');

test("formats enums and schema unions on separate indented lines", () => {
  const schema = {
    type: "object",
    properties: {
      field: { enum: ["album", "artist"] },
      value: { oneOf: [{ type: "string" }, { type: "number" }] },
      nullable: { type: "string", nullable: true },
    },
  };
  assert.equal(
    text(formatSchema(schema)),
    '{\n  field?: \n    | "album"\n    | "artist"\n  value?: \n    | string\n    | number\n  nullable?: \n    | string\n    | null\n}',
  );
});

test("formats actual smart playlist field values vertically", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "swagger.json")));
  const paths = inlineSchemaRefs(spec);
  const schema = paths["/api/create-smart-playlist"].post.requestBody.content["application/json"].schema;
  const formatted = text(formatSchema(schema));
  assert.match(formatted, /field\??: \n\s+\| "album"\n\s+\| "album_artist"\n\s+\| "artist"/);
  assert.match(formatted, /\| "year"/);
});

test("wraps comments at the available width with indentation and prefixes", () => {
  const comment = text(formatComment("The success being true indicates that the request completed.", 1, 25));
  for (const line of comment.split("\n")) {
    assert.match(line, /^  \/\/ /);
    assert.ok(line.length <= 25, line);
  }
  assert.equal(comment.split("\n").map((line) => line.slice(5)).join(" "), "The success being true indicates that the request completed.");
  assert.match(text(formatComment("averylongword", 0, 7)), /^\/\/ aver\n\/\/ ylon\n\/\/ gwor\n\/\/ d$/);
});

test("escapes OpenAPI text before inserting it as HTML", () => {
  const formatted = formatSchema({
    properties: {
      "<field>": { enum: ['<img src=x onerror="alert(1)">'], description: "<script>alert(1)</script>" },
    },
  });
  assert.doesNotMatch(formatted, /<script>|<img/);
  assert.match(formatted, /&lt;field&gt;/);
  assert.match(formatted, /&lt;script&gt;/);
});

test("derives administrative and feature categories from the OpenAPI operation", () => {
  const spec = JSON.parse(fs.readFileSync(path.join(__dirname, "swagger.json")));
  const categories = (path, method) =>
    Array.from(operationCategories(spec.paths[path][method]));
  assert.deepEqual(categories("/api/create-account", "post"), ["Administrative", "Accounts"]);
  assert.deepEqual(categories("/api/list-albums", "get"), ["Albums"]);
  assert.deepEqual(categories("/api/list-album-associations", "get"), ["Associations"]);
  assert.deepEqual(categories("/api/list-shoutcast-stations", "get"), ["SHOUTcast"]);
  assert.deepEqual(Array.from(operationCategories({})), ["Other"]);
});
