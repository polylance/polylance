// lib/notifications.ts

export interface NotifyAdminParams {
  title: string;
  body: string;
  contractAddress: string;
}

export async function notifyAdmins(params: NotifyAdminParams): Promise<boolean> {
  const discordWebhookUrl = process.env.DISCORD_ADMIN_WEBHOOK_URL;
  if (!discordWebhookUrl || discordWebhookUrl === "your_discord_webhook_here") {
    console.log(`[ADMIN NOTIFICATION LOG] (Discord URL unconfigured): ${params.title} - ${params.body}`);
    return false;
  }

  try {
    const res = await fetch(discordWebhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        content: `🚨 **${params.title}**\n**Contract**: \`${params.contractAddress}\`\n**Details**: ${params.body}`,
      }),
    });
    return res.ok;
  } catch (err) {
    console.error("Failed to post Discord admin notification:", err);
    return false;
  }
}
