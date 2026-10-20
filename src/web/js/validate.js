/** Subset JSON Schema validator plus a secret-shaped value rejection. No dependencies. */

const SECRET_KEY = /^(password|passwd|secret|token|privatekey|apikey|authorization|bearer)$/i;
const ENV_KEY = /(^|_)(tokenEnv|keyEnv|knownHostsEnv|headerEnv)$/;
const TOKEN_VALUE = new RegExp("\\b(?:" + [
  ["gh", "p_"].join("") + "[A-Za-z0-9]",
  ["github_", "pat_"].join(""),
  ["gh", "o_"].join("") + "[A-Za-z0-9]",
  "xox" + "[baprs]-",
  ["s", "k-"].join("") + "[A-Za-z0-9]",
].join("|") + ")");
const ENV_NAME = /^[A-Z][A-Z0-9_]{0,80}$/;

export function validate(data, schema) {
  const errors = [];
  checkNode(data, schema, "$", errors, schema);
  rejectSecrets(data, "$", errors);
  return errors;
}

function typeName(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function checkNode(data, schema, path, errors, root) {
  if (!schema || typeof schema !== "object") return;
  if (schema.$ref) {
    const target = resolveRef(root, schema.$ref);
    if (!target) errors.push(`${path} has an unknown schema reference`);
    else checkNode(data, target, path, errors, root);
    return;
  }
  if (schema.const !== undefined && data !== schema.const) {
    errors.push(`${path} must be ${JSON.stringify(schema.const)}`);
    return;
  }
  const types = schema.type == null ? null : Array.isArray(schema.type) ? schema.type : [schema.type];
  if (types && !types.includes(typeName(data))) {
    errors.push(`${path} must be ${types.join(" or ")}`);
    return;
  }
  if (schema.enum && !schema.enum.includes(data)) {
    errors.push(`${path} must be one of ${schema.enum.join(", ")}`);
  }
  if (typeof data === "string") {
    if (schema.minLength != null && data.length < schema.minLength) errors.push(`${path} is too short`);
    if (schema.maxLength != null && data.length > schema.maxLength) errors.push(`${path} is too long`);
    if (schema.pattern && !new RegExp(schema.pattern).test(data)) errors.push(`${path} has the wrong format`);
  }
  if (typeof data === "number") {
    if (schema.minimum != null && data < schema.minimum) errors.push(`${path} is below the minimum`);
    if (schema.maximum != null && data > schema.maximum) errors.push(`${path} is above the maximum`);
  }
  if (typeName(data) === "array") {
    if (schema.minItems != null && data.length < schema.minItems) errors.push(`${path} needs at least ${schema.minItems} item`);
    if (schema.maxItems != null && data.length > schema.maxItems) errors.push(`${path} has too many items`);
    if (schema.items) data.forEach((item, index) => checkNode(item, schema.items, `${path}[${index}]`, errors, root));
  }
  if (typeName(data) === "object") {
    const required = schema.required || [];
    for (const key of required) {
      if (data[key] === undefined) errors.push(`${path}.${key} is required`);
    }
    const properties = schema.properties || {};
    for (const [key, value] of Object.entries(data)) {
      if (properties[key]) checkNode(value, properties[key], `${path}.${key}`, errors, root);
      else if (schema.additionalProperties === false) errors.push(`${path}.${key} is not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
        checkNode(value, schema.additionalProperties, `${path}.${key}`, errors, root);
      }
    }
  }
}

function resolveRef(root, ref) {
  if (!ref.startsWith("#/")) return null;
  return ref.slice(2).split("/").reduce((node, part) => (node == null ? null : node[part]), root);
}

function rejectSecrets(value, path, errors) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => rejectSecrets(item, `${path}[${index}]`, errors));
    return;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" && TOKEN_VALUE.test(value)) errors.push(`${path} looks like a token. Store the env var name, not the secret.`);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const here = `${path}.${key}`;
    if (SECRET_KEY.test(key)) errors.push(`${here} is not allowed. Name an environment variable instead.`);
    else if (ENV_KEY.test(key)) {
      if (typeof child !== "string" || !ENV_NAME.test(child)) errors.push(`${here} must be an environment variable name like GITHUB_TOKEN`);
    } else {
      rejectSecrets(child, here, errors);
    }
  }
}

export function maskConfig(config) {
  return maskNode(JSON.parse(JSON.stringify(config)));
}

function maskNode(value) {
  if (Array.isArray(value)) return value.map(maskNode);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY.test(key) && typeof child === "string") out[key] = "••••••••";
    else out[key] = maskNode(child);
  }
  return out;
}
