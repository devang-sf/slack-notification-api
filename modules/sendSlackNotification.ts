import { ZuploContext, ZuploRequest, environment } from "@zuplo/runtime";

/**
 * Converts common standard Markdown to Slack mrkdwn so formatting displays correctly.
 * Slack already parses *bold*, _italic_, ~~strikethrough~~, `code`,locks```.
 * Links need conversion: [text](url) → <url|text>.
 */
function markdownToSlackMrkdwn(text: string): string {
  return text.replace(
    /\[([^\]]*)\]\((https?:\/\/[^)]+)\)/g,
    (_, label, url) => `<${url}|${label}>`
  );
}

export default async function (
  request: ZuploRequest,
  context: ZuploContext
) {
  // 1️⃣ Path param
  const channelName = request.params?.channel_name;

  if (!channelName) {
    return new Response(
      JSON.stringify({ error: "Missing channel_name" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 2️⃣ Parse JSON body
  let body: any;
  try {
    body = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: "Invalid JSON body" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  const message = body?.message;
  if (!message) {
    return new Response(
      JSON.stringify({ error: "Missing 'message' field" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // 3️⃣ Read secret from env
  const token = environment.SLACK_BOT_TOKEN;

  if (!token) {
    return new Response(
      JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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
    return new Response(
      JSON.stringify({
        error: "Failed to reach Slack API",
        details: err?.message
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  const slackResult = await slackResponse.json();

  // 5️⃣ Handle Slack API errors explicitly
  if (!slackResult.ok) {
    return new Response(
      JSON.stringify({
        error: "Slack API error",
        slack_error: slackResult.error
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
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