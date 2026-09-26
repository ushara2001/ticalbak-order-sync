import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "TikTok Business webhook receiver is online.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    let payload: any = null;

    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.warn("TikTok Business webhook received invalid JSON:", rawBody);

      // Acknowledge receipt so TikTok does not repeatedly retry.
      return NextResponse.json({ success: true });
    }

    let content = payload?.content ?? null;

    if (typeof content === "string") {
      try {
        content = JSON.parse(content);
      } catch {
        // Leave content as the original string if it is not JSON.
      }
    }

    console.log("TikTok Business webhook received:", {
      event: payload?.event ?? null,
      client_key: payload?.client_key ?? null,
      user_openid: payload?.user_openid ?? null,
      create_time: payload?.create_time ?? null,
      content,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("TikTok Business webhook error:", error);

    // Still acknowledge the webhook to prevent repeated delivery attempts.
    return NextResponse.json({ success: true });
  }
}
