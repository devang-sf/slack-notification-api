import { ZuploContext, ZuploRequest, environment } from "@zuplo/runtime";

const JSON_HEADERS = { "Content-Type": "application/json" };

function errorResponse(
  status: number,
  category: string,
  code: string,
  message: string,
): Response {
  const body: Record<string, string> = { category, code, message };
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/**
 * Converts common standard Markdown to Slack mrkdwn so formatting displays correctly.
 * Slack already parses *bold*, _italic_, ~~strikethrough~~, `code`, ```blocks```.
 * Links need conversion: [text](url) → <url|text>.
 */
function markdownToSlackMrkdwn(text: string): string {
  return text.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_, label, url) => `<${url}|${label}>`
  );
}

function mapSlackError(slackError: string): { status: number; category: string; code: string; message: string } {
  const clientErrors: Record<string, string> = {
    channel_not_found: "Channel not found",
    not_in_channel: "Bot is not in that channel"
  };
  const forbiddenErrors: Record<string, string> = {
    invalid_auth: "Invalid Slack token",
    not_authed: "Not authenticated",
    token_revoked: "Slack token revoked",
    account_inactive: "Slack app inactive",
    missing_scope: "Bot missing required scope"
  };
  if (clientErrors[slackError])
    return { status: 400, category: "client_error", code: slackError, message: clientErrors[slackError] };
  if (forbiddenErrors[slackError])
    return { status: 403, category: "forbidden", code: slackError, message: forbiddenErrors[slackError] };
  if (slackError === "rate_limited")
    return { status: 429, category: "rate_limited", code: "rate_limited", message: "Slack rate limit exceeded" };
  return { status: 500, category: "internal_error", code: "slack_error", message: "Slack API error" };
}

export default async function (
  request: ZuploRequest,
  context: ZuploContext
) {
  // 1️⃣ Path param
  const channelName = request.params?.channel_name;

  if (!channelName) {
    return errorResponse(400, "client_error", "missing_channel", "Missing channel_name");
  }

  // 2️⃣ Parse JSON body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "client_error", "invalid_body", "Invalid JSON body");
  }

  const message = body?.message;
  if (!message) {
    return errorResponse(400, "client_error", "missing_message", "Missing 'message' field");
  }

  // 3️⃣ Read secret from env
  const token = environment.SLACK_BOT_TOKEN;

  if (!token) {
    return errorResponse(500, "internal_error", "config_error", "SLACK_BOT_TOKEN not configured");
  }

  // 4️⃣ Call Slack Web API via fetch (message supports markdown → mrkdwn)
  let slackResponse;
  try {
    slackResponse = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json; charset=utf-8"
      },
      body: JSON.stringify({
        channel: `#${channelName}`,
        text: markdownToSlackMrkdwn(message)
      })
    });
  } catch (err: any) {
    return errorResponse(
      503,
      "service_unavailable",
      "slack_unavailable",
      "Could not reach Slack",
    );
  }

  const slackResult = await slackResponse.json();

  if (slackResponse.status >= 500) {
    return errorResponse(
      503,
      "service_unavailable",
      "slack_unavailable",
      "Slack API is unavailable",
    );
  }

  if (!slackResult.ok) {
    const mapped = mapSlackError(slackResult.error ?? "unknown");
    return errorResponse(mapped.status, mapped.category, mapped.code, mapped.message);
  }

  // 6️⃣ Success
  return new Response(
    JSON.stringify({
      status: "ok",
      channel: channelName,
      ts: slackResult.ts
    }),
    { headers: { "Content-Type": "application/json" } }
  );
}