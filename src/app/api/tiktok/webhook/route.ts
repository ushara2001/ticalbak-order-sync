import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  return Response.json({
    success: true,
    message: "TikTok webhook endpoint is ready",
  });
}

export async function POST(request: Request) {
  try {
    const payload = await request.json();

    const notificationId = String(
      payload.tts_notification_id ?? ""
    ).trim();

    if (!notificationId) {
      return Response.json(
        {
          success: false,
          message: "Missing TikTok notification ID",
        },
        { status: 400 }
      );
    }

    const { error } = await supabaseAdmin
      .from("tiktok_webhook_events")
      .upsert(
        {
          tts_notification_id: notificationId,

          event_type:
            typeof payload.type === "number"
              ? payload.type
              : null,

          shop_id:
            payload.shop_id
              ? String(payload.shop_id)
              : null,

          seller_open_id:
            payload.seller_open_id
              ? String(payload.seller_open_id)
              : null,

          event_timestamp:
            typeof payload.timestamp === "number"
              ? payload.timestamp
              : null,

          event_data:
            payload.data ?? null,

          raw_payload:
            payload,

          processed: false,
        },
        {
          onConflict: "tts_notification_id",
          ignoreDuplicates: true,
        }
      );

    if (error) {
      console.error(
        "TikTok webhook save failed:",
        error.message
      );

      return Response.json(
        {
          success: false,
          message: "Webhook could not be stored",
        },
        { status: 500 }
      );
    }

    return Response.json({
      success: true,
      message: "Webhook received",
    });
  } catch (error) {
    console.error(
      "TikTok webhook error:",
      error
    );

    return Response.json(
      {
        success: false,
        message: "Invalid webhook payload",
      },
      { status: 400 }
    );
  }
}