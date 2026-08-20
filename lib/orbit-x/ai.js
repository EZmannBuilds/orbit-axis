// Orbit X :: the AI provider adapter (Dev Update 5.0).
//
// One provider behind one function, reached only from the server. The key
// lives in the environment, is attached to exactly one request, and never
// appears in an error, a log, or anything a client receives. Swapping
// providers later means rewriting THIS FILE and nothing else — candidates,
// scoring, schemas, and the desk never learn who wrote the words.
//
// No SDK, no agent framework, no orchestration dependency: Orbit X V1 needs
// one structured completion per click, which is one fetch.

export class OrbitXAiError extends Error {
  constructor(message, { code = "ai_failed", status = 502 } = {}) {
    super(message);
    this.name = "OrbitXAiError";
    this.code = code;
    this.status = status;
  }
}

export const AI_ENV_VARS = Object.freeze([
  "ORBIT_X_AI_PROVIDER", "ORBIT_X_AI_API_KEY", "ORBIT_X_AI_MODEL",
]);

export function aiConfig(env = process.env) {
  const provider = String(env.ORBIT_X_AI_PROVIDER || "anthropic").toLowerCase();
  return Object.freeze({
    provider,
    apiKey: env.ORBIT_X_AI_API_KEY || null,
    model: env.ORBIT_X_AI_MODEL || "claude-sonnet-5",
    configured: Boolean(env.ORBIT_X_AI_API_KEY) && provider === "anthropic",
  });
}

/**
 * One generation: system prompt + JSON packet in, raw text out.
 * Usage metadata is returned when the provider supplies it, so generation
 * cost stays observable without any client-side billing exposure.
 */
export async function generateCopy({ system, packet, env = process.env, fetchImpl = fetch }) {
  const cfg = aiConfig(env);
  if (!cfg.configured) {
    throw new OrbitXAiError("AI generation is not configured on this instance.",
      { code: "ai_unconfigured", status: 503 });
  }
  let res;
  try {
    res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": cfg.apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: 2000,
        system,
        messages: [{ role: "user", content: JSON.stringify(packet) }],
      }),
    });
  } catch {
    throw new OrbitXAiError("The AI provider could not be reached.", { code: "ai_unreachable" });
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    // Provider error TYPES are safe to surface; provider error BODIES can
    // quote the request, so they stay out of everything.
    throw new OrbitXAiError("AI generation failed.",
      { code: `ai_${body?.error?.type || "error"}`, status: res.status === 429 ? 429 : 502 });
  }
  const text = (body?.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
  if (!text) throw new OrbitXAiError("The AI returned no usable text.", { code: "ai_empty" });
  return {
    text,
    usage: body?.usage ? { input: body.usage.input_tokens, output: body.usage.output_tokens } : null,
    model: cfg.model,
  };
}
