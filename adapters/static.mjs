export default {
  id: "static",
  kinds: ["app", "deploy", "machine", "agent"],
  env: [],
  schema: {
    type: "object",
    properties: {
      state: { type: "string" },
      label: { type: "string" },
      detail: { type: "string" },
    },
  },
  async check(_target, options = {}) {
    return {
      state: options.state || "unknown",
      label: options.label || "No live check connected",
      detail: typeof options.detail === "string" ? options.detail : "No live check connected",
      expiresAfter: options.maxAge || "720h",
    };
  },
  demo(_target, options = {}) {
    return {
      state: options.state || "unknown",
      label: options.label || "No live check connected",
      detail: "Sample static note",
      expiresAfter: "720h",
    };
  },
};
