import fs from 'node:fs';

export function getWhatsAppMessage(name: string, amount: number, billNo: string | number, shareUrl: string): string {
  return `नमस्ते ${name} जी, छठ पूजा समिति को आपके ₹${amount} के दान के लिए धन्यवाद। रसीद संख्या #${billNo}. Thank you for your donation of ₹${amount} to Chhath Puja Samiti. Receipt: ${shareUrl}. जय छठी मैया!`;
}

export async function sendWhatsAppReceiptCloud(options: {
  phone: string;
  name: string;
  amount: number;
  billNo: string | number;
  shareUrl: string;
  pdfPath: string;
}): Promise<boolean> {
  const isEnabled = process.env.WHATSAPP_CLOUD_ENABLED === 'true';
  const token = process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.WHATSAPP_PHONE_ID;

  if (!isEnabled || !token || !phoneId) {
    return false;
  }

  try {
    const formattedPhone = options.phone.startsWith('91') ? options.phone : `91${options.phone}`;
    const textBody = getWhatsAppMessage(options.name, options.amount, options.billNo, options.shareUrl);

    // Send WhatsApp Document / Message via Meta Graph API v19.0
    const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: {
          preview_url: true,
          body: textBody,
        },
      }),
    });

    if (!response.ok) {
      const errData = await response.text();
      console.warn('[WhatsApp Cloud API] Message send returned non-200:', errData);
      return false;
    }

    console.log(`[WhatsApp Cloud API] Successfully sent message to ${formattedPhone}`);
    return true;
  } catch (err) {
    console.warn('[WhatsApp Cloud API Error]:', err);
    return false;
  }
}
