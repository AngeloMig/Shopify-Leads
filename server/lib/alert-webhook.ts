/** Posts to a Slack or Discord incoming webhook; each reads its own text field. */
export async function postWebhook(url: string, text: string) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok)
    throw new Error(`Alert webhook returned HTTP ${response.status}`);
}
