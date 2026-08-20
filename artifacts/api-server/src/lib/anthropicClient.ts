import Anthropic from "@anthropic-ai/sdk";

/**
 * Shared Anthropic client. Prefers the Replit AI-Integrations proxy
 * (AI_INTEGRATIONS_ANTHROPIC_*, auto-provisioned, no own key needed) and falls
 * back to a directly configured ANTHROPIC_API_KEY / ANTHROPIC_API_URL.
 */
export const anthropic = new Anthropic({
  apiKey:
    process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY ??
    process.env.ANTHROPIC_API_KEY,
  baseURL:
    process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL ??
    process.env.ANTHROPIC_API_URL,
});
