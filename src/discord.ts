import { formatSlotLine } from "./autius.js";
import type { Slot } from "./types.js";

type EmbedField = { name: string; value: string; inline?: boolean };

const WEBHOOK_RE =
  /^https:\/\/(?:discord|discordapp)\.com\/api\/webhooks\/\d+\/[\w-]+\/?(?:\?.*)?$/i;

/** fail fast when .env still has the placeholder or a non-webhook url */
export function assertDiscordWebhookUrl(webhookUrl: string): void {
  const url = webhookUrl.trim();
  if (!url || url.includes("...") || !WEBHOOK_RE.test(url)) {
    throw new Error(
      "DISCORD_WEBHOOK_URL looks invalid. create a webhook in discord " +
        "(channel settings → integrations → webhooks), then paste the full url " +
        "https://discord.com/api/webhooks/<id>/<token> into .env",
    );
  }
}

async function postWebhook(
  webhookUrl: string,
  body: Record<string, unknown>,
): Promise<void> {
  assertDiscordWebhookUrl(webhookUrl);
  const res = await fetch(webhookUrl.trim(), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`discord webhook failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function notifyNewSlots(opts: {
  webhookUrl: string;
  slots: Slot[];
  calendarUrl: string;
}): Promise<void> {
  const { webhookUrl, slots, calendarUrl } = opts;
  if (slots.length === 0) return;

  // discord: description <= 4096, and sum of all embed text in one message <= 6000.
  // post one embed per message so large batches never hit the combined cap.
  const maxDesc = 3500;
  const lines = slots.map((s) => `• ${formatSlotLine(s)}`);
  const chunks: string[] = [];
  let buf = "";
  for (const line of lines) {
    const next = buf ? `${buf}\n${line}` : line;
    if (next.length > maxDesc) {
      if (buf) chunks.push(buf);
      buf = line.length > maxDesc ? `${line.slice(0, maxDesc - 1)}…` : line;
    } else {
      buf = next;
    }
  }
  if (buf) chunks.push(buf);

  for (let i = 0; i < chunks.length; i += 1) {
    const title =
      chunks.length === 1
        ? `Nuevas clases disponibles (${slots.length})`
        : `Nuevas clases disponibles (${slots.length}) · ${i + 1}/${chunks.length}`;

    await postWebhook(webhookUrl, {
      content:
        i === 0
          ? slots.length === 1
            ? "Hay una nueva clase libre."
            : "Hay nuevas clases libres."
          : undefined,
      embeds: [
        {
          title,
          description: chunks[i],
          url: calendarUrl,
          color: 0xe11d2a,
          timestamp: new Date().toISOString(),
          footer: { text: "Autius calendar watcher" },
        },
      ],
    });

    // stay under discord webhook rate limits on big dumps
    if (i < chunks.length - 1) {
      await new Promise((r) => setTimeout(r, 350));
    }
  }
}

export async function notifyFailure(opts: {
  webhookUrl: string;
  message: string;
  consecutiveFailures: number;
}): Promise<void> {
  const fields: EmbedField[] = [
    {
      name: "consecutive failures",
      value: String(opts.consecutiveFailures),
      inline: true,
    },
  ];

  await postWebhook(opts.webhookUrl, {
    embeds: [
      {
        title: "Autius watcher error",
        description: opts.message.slice(0, 2000),
        color: 0xf59e0b,
        fields,
        timestamp: new Date().toISOString(),
        footer: { text: "silent-death guard · at most once per day" },
      },
    ],
  });
}
