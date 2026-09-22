import { after } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  return Response.json({
    success: true,
    message: "TikTok webhook endpoint is ready",
  });
}

export async function POST(request: Request) {
  try {
    const secret =
      process.env.INTERNAL_PROCESSOR_SECRET;

    if (!secret) {
      console.error(
        "INTERNAL_PROCESSOR_SECRET is missing"
      );

      return Response.json(
        {
          success: false,
          message:
            "Webhook processor configuration is missing",
        },
        { status: 500 }
      );
    }

    const payload = await request.json();

    const notificationId = String(
      payload.tts_notification_id ?? ""
    ).trim();

    if (!notificationId) {
      return Response.json(
        {
          success: false,
          message:
            "Missing TikTok notification ID",
        },
        { status: 400 }
      );
    }

    const { error } =
      await supabaseAdmin
        .from("tiktok_webhook_events")
        .upsert(
          {
            tts_notification_id:
              notificationId,

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
                ? String(
                    payload.seller_open_id
                  )
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
            onConflict:
              "tts_notification_id",

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
          message:
            "Webhook could not be stored",
        },
        { status: 500 }
      );
    }

    const processorUrl =
      new URL(
        "/api/tiktok/webhooks/process",
        request.url
      ).toString();

    after(async () => {
      try {
        const response =
          await fetch(
            processorUrl,
            {
              method: "GET",

              headers: {
                Authorization:
                  `Bearer ${secret}`,
              },

              cache: "no-store",
            }
          );

        if (!response.ok) {
          const text =
            await response.text();

          console.error(
            "TikTok webhook processor failed:",
            response.status,
            text
          );

          return;
        }

        const result =
          await response.json();

        console.log(
          "TikTok webhook processed:",
          result
        );
      } catch (error) {
        console.error(
          "TikTok webhook background processing failed:",
          error
        );
      }
    });

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
        message:
          "Invalid webhook payload",
      },
      { status: 400 }
    );
  }
}