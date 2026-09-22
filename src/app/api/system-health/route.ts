import { supabaseAdmin } from "@/lib/supabaseAdmin";

function isAuthorized(request: Request) {
  const authorization =
    request.headers.get("authorization");

  const allowedSecrets = [
    process.env.INTERNAL_PROCESSOR_SECRET,
    process.env.CRON_SECRET,
  ].filter(Boolean);

  return allowedSecrets.some(
    (secret) =>
      authorization === `Bearer ${secret}`
  );
}

export async function GET(request: Request) {
  if (!isAuthorized(request)) {
    return Response.json(
      {
        success: false,
        message: "Unauthorized",
      },
      { status: 401 }
    );
  }

  try {
    /*
     * 1. Count webhook events still waiting.
     */

    const {
      count: pendingWebhookCount,
      error: pendingError,
    } =
      await supabaseAdmin
        .from("tiktok_webhook_events")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("processed", false);

    if (pendingError) {
      throw new Error(
        `Could not count pending webhooks: ${pendingError.message}`
      );
    }

    /*
     * 2. Count webhook events that currently
     *    have a processing error.
     */

    const {
      count: webhookErrorCount,
      error: webhookErrorQuery,
    } =
      await supabaseAdmin
        .from("tiktok_webhook_events")
        .select("*", {
          count: "exact",
          head: true,
        })
        .eq("processed", false)
        .not(
          "processing_error",
          "is",
          null
        );

    if (webhookErrorQuery) {
      throw new Error(
        `Could not count webhook errors: ${webhookErrorQuery.message}`
      );
    }

    /*
     * 3. Find the oldest pending webhook.
     */

    const {
      data: oldestPending,
      error: oldestPendingError,
    } =
      await supabaseAdmin
        .from("tiktok_webhook_events")
        .select(
          "received_at, processing_error"
        )
        .eq("processed", false)
        .order("received_at", {
          ascending: true,
        })
        .limit(1)
        .maybeSingle();

    if (oldestPendingError) {
      throw new Error(
        `Could not read oldest pending webhook: ${oldestPendingError.message}`
      );
    }

    /*
     * 4. Find the most recently synchronized
     *    TikTok order.
     */

    const {
      data: latestOrder,
      error: latestOrderError,
    } =
      await supabaseAdmin
        .from("tiktok_orders")
        .select(
          "last_synced_at"
        )
        .not(
          "last_synced_at",
          "is",
          null
        )
        .order(
          "last_synced_at",
          {
            ascending: false,
          }
        )
        .limit(1)
        .maybeSingle();

    if (latestOrderError) {
      throw new Error(
        `Could not read latest order sync: ${latestOrderError.message}`
      );
    }

    /*
     * 5. Count customers.
     */

    const {
      count: customerCount,
      error: customerCountError,
    } =
      await supabaseAdmin
        .from("tiktok_customers")
        .select("*", {
          count: "exact",
          head: true,
        });

    if (customerCountError) {
      throw new Error(
        `Could not count TikTok customers: ${customerCountError.message}`
      );
    }

    /*
     * 6. Determine a simple health status.
     *
     * Pending events are not automatically
     * a problem because an event may have
     * arrived only moments ago.
     *
     * A processing error is more important.
     */

    const hasErrors =
      (webhookErrorCount ?? 0) > 0;

    const status =
      hasErrors
        ? "attention"
        : "healthy";

    return Response.json({
      success: true,

      status,

      pending_webhooks:
        pendingWebhookCount ?? 0,

      webhook_errors:
        webhookErrorCount ?? 0,

      oldest_pending_webhook_at:
        oldestPending?.received_at ??
        null,

      oldest_pending_error:
        oldestPending?.processing_error ??
        null,

      latest_order_sync_at:
        latestOrder?.last_synced_at ??
        null,

      tiktok_customers:
        customerCount ?? 0,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        status: "error",

        message:
          error instanceof Error
            ? error.message
            : "System health check failed",
      },
      { status: 500 }
    );
  }
}