// Vercel serverless email sender. Forwards to Resend using RESEND_API_KEY
// (server-side only). Supports an optional Finbot PDF attachment fetched
// server-side, so the browser never has to touch Finbot's origin (CORS-proof).

const ALLOWED_ATTACHMENT_HOST = "ntlz.finbot.co.il";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();
  const { to, subject, html, attachmentUrl, attachmentFilename } = req.body;

  let attachments;
  if (attachmentUrl) {
    // SSRF guard: only accept the Finbot PDF host. Anything else is refused
    // before the server ever hits the network.
    let parsed;
    try {
      parsed = new URL(attachmentUrl);
    } catch {
      return res.status(400).json({ message: "attachmentUrl is not a valid URL" });
    }
    if (parsed.hostname !== ALLOWED_ATTACHMENT_HOST) {
      return res.status(400).json({ message: "attachment host not allowed" });
    }

    let pdfRes;
    try {
      pdfRes = await fetch(attachmentUrl);
    } catch (err) {
      return res.status(502).json({ message: `attachment fetch failed: ${err.message}` });
    }
    if (!pdfRes.ok) {
      return res.status(502).json({ message: `attachment fetch failed: HTTP ${pdfRes.status}` });
    }
    const buf = Buffer.from(await pdfRes.arrayBuffer());
    attachments = [
      {
        filename: attachmentFilename || "attachment.pdf",
        content: buf.toString("base64"),
      },
    ];
  }

  const body = { from: "QuickStock ERP <noreply@adstock.co.il>", reply_to: "a.d.shivuk555@gmail.com", to, subject, html };
  if (attachments) body.attachments = attachments;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) {
    console.error("[send-email] Resend error:", JSON.stringify(data));
  }
  return res.status(response.ok ? 200 : 400).json(data);
}
