import { rebuildTikTokCustomers } from "@/lib/rebuildTikTokCustomers";
import { syncTikTokCustomersToGoogleSheet } from "@/lib/syncTikTokCustomersToGoogleSheet";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createTikTokSign } from "@/lib/tiktokSign";
import { getValidTikTokConnection } from "@/lib/tiktokAuth";

type WebhookEvent = {
  id: string;
  tts_notification_id: string;
  event_type: number | null;
  event_data: Record<string, unknown> | null;
};

type TikTokOrderDetail = {
  id?: string;
  status?: string;
  create_time?: number;
  [key: string]: unknown;
};

function normalizeOrderId(
  value: unknown
): string | null {
  if (typeof value === "string") {
    const id = value.trim();

    if (/^\d+$/.test(id)) {
      return id;
    }
  }

  if (
    typeof value === "number" &&
    Number.isFinite(value)
  ) {
    const id =
      String(Math.trunc(value));

    if (/^\d+$/.test(id)) {
      return id;
    }
  }

  return null;
}

function getOrderIds(
  data: Record<string, unknown> | null
): string[] {
  if (!data) {
    return [];
  }

  const ids =
    new Set<string>();

  const singleOrderId =
    normalizeOrderId(
      data.order_id
    );

  if (singleOrderId) {
    ids.add(singleOrderId);
  }

  if (
    Array.isArray(
      data.order_ids
    )
  ) {
    for (
      const value of
      data.order_ids
    ) {
      const id =
        normalizeOrderId(
          value
        );

      if (id) {
        ids.add(id);
      }
    }
  }

  return Array.from(ids);
}

async function saveProcessingError(
  eventIds: string[],
  message: string
) {
  if (
    eventIds.length === 0
  ) {
    return;
  }

  await supabaseAdmin
    .from(
      "tiktok_webhook_events"
    )
    .update({
      processing_error:
        message,
    })
    .in(
      "id",
      eventIds
    );
}

export async function GET(
  request: Request
) {
  /*
   * SECURITY
   *
   * Only our webhook receiver is allowed
   * to run this processor.
   */

  const secret =
    process.env
      .INTERNAL_PROCESSOR_SECRET;

  const authorization =
    request.headers.get(
      "authorization"
    );

  if (
    !secret ||
    authorization !==
      `Bearer ${secret}`
  ) {
    return Response.json(
      {
        success: false,
        message:
          "Unauthorized",
      },
      {
        status: 401,
      }
    );
  }

  /*
   * 1. Find webhook events TikTok has
   *    sent but we have not processed.
   */

  const {
    data: events,
    error: eventError,
  } =
    await supabaseAdmin
      .from(
        "tiktok_webhook_events"
      )
      .select(
        `
        id,
        tts_notification_id,
        event_type,
        event_data
        `
      )
      .eq(
        "processed",
        false
      )
      .order(
        "received_at",
        {
          ascending: true,
        }
      )
      .limit(50);

  if (eventError) {
    return Response.json(
      {
        success: false,

        message:
          "Could not read webhook events",

        error:
          eventError.message,
      },
      {
        status: 500,
      }
    );
  }

  const typedEvents =
    (events ?? []) as WebhookEvent[];

  /*
   * No events waiting means
   * everything is caught up.
   */

  if (
    typedEvents.length === 0
  ) {
    return Response.json({
      success: true,

      message:
        "No webhook events waiting",

      events_processed: 0,

      unique_order_ids: 0,

      orders_updated: 0,

      customers_updated: 0,

      google_sheet_synced: false,

      google_sheet_customers_synced: 0,
    });
  }

  const eventIds =
    typedEvents.map(
      (event) =>
        event.id
    );

  /*
   * 2. Collect unique TikTok order IDs
   *    from the waiting webhook events.
   */

  const orderIds =
    new Set<string>();

  for (
    const event of
    typedEvents
  ) {
    const ids =
      getOrderIds(
        event.event_data
      );

    for (
      const id of ids
    ) {
      orderIds.add(id);
    }
  }

  const ids =
    Array.from(
      orderIds
    );

  /*
   * Some webhook events may not contain
   * a real order ID.
   *
   * Our fake test webhook is an example.
   */

  if (
    ids.length === 0
  ) {
    const {
      error:
        processedError,
    } =
      await supabaseAdmin
        .from(
          "tiktok_webhook_events"
        )
        .update({
          processed: true,

          processed_at:
            new Date()
              .toISOString(),

          processing_error:
            null,
        })
        .in(
          "id",
          eventIds
        );

    if (
      processedError
    ) {
      return Response.json(
        {
          success: false,

          message:
            "Webhook contained no order IDs, but could not be marked processed",

          error:
            processedError.message,
        },
        {
          status: 500,
        }
      );
    }

    return Response.json({
      success: true,

      message:
        "Webhook events processed successfully",

      events_processed:
        typedEvents.length,

      unique_order_ids: 0,

      orders_updated: 0,

      customers_updated: 0,

      google_sheet_synced: false,

      google_sheet_customers_synced: 0,
    });
  }

  /*
   * 3. Get TikTok API credentials.
   */

  const appKey =
    process.env
      .TIKTOK_APP_KEY;

  const appSecret =
    process.env
      .TIKTOK_APP_SECRET;

  if (
    !appKey ||
    !appSecret
  ) {
    const message =
      "TikTok credentials are missing";

    await saveProcessingError(
      eventIds,
      message
    );

    return Response.json(
      {
        success: false,
        message,
      },
      {
        status: 500,
      }
    );
  }

  /*
   * 4. Get a valid TikTok connection.
   *
   * If the access token is near expiry,
   * our token manager refreshes it.
   */

  let connection;

  try {
    connection =
      await getValidTikTokConnection();
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not get valid TikTok connection";

    await saveProcessingError(
      eventIds,
      message
    );

    return Response.json(
      {
        success: false,
        message,
      },
      {
        status: 500,
      }
    );
  }

  if (
    !connection.shop_cipher
  ) {
    const message =
      "TikTok shop cipher is missing";

    await saveProcessingError(
      eventIds,
      message
    );

    return Response.json(
      {
        success: false,
        message,
      },
      {
        status: 400,
      }
    );
  }

  /*
   * 5. Fetch the latest authoritative
   *    order information from TikTok.
   */

  let ordersUpdated = 0;

  const returnedOrderIds =
    new Set<string>();

  for (
    let i = 0;
    i < ids.length;
    i += 50
  ) {
    const batch =
      ids.slice(
        i,
        i + 50
      );

    const path =
      "/order/202507/orders";

    const timestamp =
      Math.floor(
        Date.now() / 1000
      ).toString();

    const signingParams:
      Record<
        string,
        string
      > = {
      app_key: appKey,

      timestamp,

      shop_cipher:
        connection.shop_cipher,

      ids:
        batch.join(","),
    };

    const sign =
      createTikTokSign(
        path,
        signingParams,
        appSecret
      );

    const requestUrl =
      new URL(
        `https://open-api.tiktokglobalshop.com${path}`
      );

    for (
      const [
        key,
        value,
      ] of Object.entries(
        signingParams
      )
    ) {
      requestUrl.searchParams.set(
        key,
        value
      );
    }

    requestUrl.searchParams.set(
      "sign",
      sign
    );

    const response =
      await fetch(
        requestUrl.toString(),
        {
          method: "GET",

          headers: {
            "Content-Type":
              "application/json",

            "x-tts-access-token":
              connection.access_token,
          },

          cache:
            "no-store",
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      result.code !== 0
    ) {
      const message =
        `TikTok Order Detail request failed: ${
          result.message ??
          "Unknown TikTok error"
        }`;

      await saveProcessingError(
        eventIds,
        message
      );

      return Response.json(
        {
          success: false,

          message:
            "TikTok Order Detail request failed",

          error:
            result.message,

          tiktok_code:
            result.code,

          request_id:
            result.request_id,
        },
        {
          status: 500,
        }
      );
    }

    const orders:
      TikTokOrderDetail[] =
        result.data?.orders ??
        [];

    /*
     * Build rows for Supabase.
     */

    const rows =
      orders
        .filter(
          (
            order
          ): order is TikTokOrderDetail & {
            id: string;
          } =>
            typeof order.id ===
              "string" &&
            order.id.length > 0
        )
        .map(
          (order) => {
            returnedOrderIds.add(
              order.id
            );

            return {
              tiktok_order_id:
                order.id,

              status:
                order.status ??
                null,

              create_time_unix:
                order.create_time ??
                null,

              created_at_tiktok:
                order.create_time
                  ? new Date(
                      order.create_time *
                        1000
                    ).toISOString()
                  : null,

              raw_detail:
                order,

              detail_synced:
                true,

              detail_synced_at:
                new Date()
                  .toISOString(),

              last_synced_at:
                new Date()
                  .toISOString(),
            };
          }
        );

    /*
     * Upsert the order batch into Supabase.
     */

    if (
      rows.length > 0
    ) {
      const {
        error:
          saveError,
      } =
        await supabaseAdmin
          .from(
            "tiktok_orders"
          )
          .upsert(
            rows,
            {
              onConflict:
                "tiktok_order_id",
            }
          );

      if (
        saveError
      ) {
        const message =
          `TikTok orders could not be saved: ${saveError.message}`;

        await saveProcessingError(
          eventIds,
          message
        );

        return Response.json(
          {
            success: false,

            message:
              "Orders were retrieved but could not be saved",

            error:
              saveError.message,
          },
          {
            status: 500,
          }
        );
      }

      ordersUpdated +=
        rows.length;
    }
  }

  /*
   * If TikTok has not returned one of the
   * webhook order IDs yet, keep the webhook
   * unprocessed so it can be retried.
   */

  const missingOrderIds =
    ids.filter(
      (id) =>
        !returnedOrderIds.has(
          id
        )
    );

  if (
    missingOrderIds.length >
    0
  ) {
    const message =
      `TikTok did not return ${missingOrderIds.length} webhook order(s) yet`;

    await saveProcessingError(
      eventIds,
      message
    );

    return Response.json(
      {
        success: false,

        message,

        missing_order_count:
          missingOrderIds.length,
      },
      {
        status: 503,
      }
    );
  }

  /*
   * 6. Rebuild the customer database.
   *
   * This updates:
   *
   * order count
   * gross spend
   * first order
   * last order
   * customer details
   */

  let customerSyncResult:
    Awaited<
      ReturnType<
        typeof rebuildTikTokCustomers
      >
    > | null = null;

  if (
    ordersUpdated > 0
  ) {
    try {
      customerSyncResult =
        await rebuildTikTokCustomers();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown customer sync error";

      await saveProcessingError(
        eventIds,
        message
      );

      return Response.json(
        {
          success: false,

          message:
            "Orders were updated, but customer database refresh failed",

          error:
            message,
        },
        {
          status: 500,
        }
      );
    }
  }

  /*
   * 7. Synchronize the updated customer
   *    database to Google Sheets.
   *
   * This happens BEFORE we mark the webhook
   * as complete.
   */

  let googleSheetSyncResult:
    Awaited<
      ReturnType<
        typeof syncTikTokCustomersToGoogleSheet
      >
    > | null = null;

  if (
    ordersUpdated > 0
  ) {
    try {
      googleSheetSyncResult =
        await syncTikTokCustomersToGoogleSheet();
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Unknown Google Sheets sync error";

      await saveProcessingError(
        eventIds,
        message
      );

      return Response.json(
        {
          success: false,

          message:
            "Customer database updated, but Google Sheet synchronization failed",

          error:
            message,
        },
        {
          status: 500,
        }
      );
    }
  }

  /*
   * 8. Everything succeeded.
   *
   * Only now do we mark the webhook events
   * as processed.
   */

  const {
    error:
      processedError,
  } =
    await supabaseAdmin
      .from(
        "tiktok_webhook_events"
      )
      .update({
        processed: true,

        processed_at:
          new Date()
            .toISOString(),

        processing_error:
          null,
      })
      .in(
        "id",
        eventIds
      );

  if (
    processedError
  ) {
    return Response.json(
      {
        success: false,

        message:
          "Updates succeeded, but webhook events could not be marked processed",

        error:
          processedError.message,
      },
      {
        status: 500,
      }
    );
  }

  /*
   * 9. Return a safe summary.
   *
   * No tokens, email addresses, phone numbers,
   * or private customer data are returned.
   */

  return Response.json({
    success: true,

    message:
      "TikTok webhook events processed successfully",

    events_processed:
      typedEvents.length,

    unique_order_ids:
      ids.length,

    orders_updated:
      ordersUpdated,

    customers_updated:
      customerSyncResult
        ?.unique_customers ??
      0,

    google_sheet_synced:
      googleSheetSyncResult !==
      null,

    google_sheet_customers_synced:
      googleSheetSyncResult
        ?.customers_synced ??
      0,

    token_refreshed:
      connection.token_refreshed,
  });
}