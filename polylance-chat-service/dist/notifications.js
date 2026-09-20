export async function notifyAdmins(alert) {
    const discordWebhookUrl = process.env.DISCORD_ADMIN_WEBHOOK_URL;
    if (!discordWebhookUrl || discordWebhookUrl.trim() === "" || discordWebhookUrl.includes("your_discord_webhook_here") || !discordWebhookUrl.startsWith("http")) {
        console.log(`[ADMIN NOTIFICATION LOG] (Discord webhook unconfigured): [${alert.severity || "ALERT"}] ${alert.title} - ${alert.body}`);
        return false;
    }
    try {
        const res = await fetch(discordWebhookUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                embeds: [
                    {
                        title: `🚨 [${alert.severity || "ALERT"}] ${alert.title}`,
                        description: alert.body,
                        fields: [
                            { name: "Contract", value: alert.contractAddress || "N/A", inline: true },
                            { name: "Severity", value: alert.severity || "N/A", inline: true },
                            ...(alert.alertId ? [{ name: "Alert ID", value: alert.alertId, inline: false }] : []),
                        ],
                        color: alert.severity === "CRITICAL" ? 0xdc2626 : 0xf59e0b,
                        timestamp: new Date().toISOString(),
                    },
                ],
            }),
        });
        return res.ok;
    }
    catch (err) {
        console.error("Failed to post Discord admin notification:", err);
        return false;
    }
}
