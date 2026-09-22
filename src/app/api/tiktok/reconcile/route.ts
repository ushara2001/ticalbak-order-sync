import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createTikTokSign } from "@/lib/tiktokSign";
import { getValidTikTokConnection } from "@/lib/tiktokAuth";
import { rebuildTikTokCustomers } from "@/lib/rebuildTikTokCustomers";
import { syncTikTokCustomersToGoogleSheet } from "@/lib/syncTikTokCustomersToGoogleSheet";

type TikTokOrderSummary = {
  id?: string;
  [key: string]: unknown;
};

type TikTokOrderDetail = {
  id?: string;
  status?: string;
  create_time?: number;
  [key: string]: unknown;
};

function isAuthorized(request: Request) {
  const authorization =
    request.headers.get("authorization");

  const allowedSecrets = [
    process.env.CRON_SECRET,
    process.env.INTERNAL_PROCESSOR_SECRET,
  ].filter(Boolean);

  return allowedSecrets.some(
    (secret) =>
      authorization === `Bearer ${secret}`
  );
}

export async function GET(request: Request) {
  /*
   * 1. Security
   */

  if (!isAuthorized(request)) {
    return Response.json(
      {
        success: false,
        message: "Unauthorized",
      },
      { status: 401 }
    );
  }

  const appKey =
    process.env.TIKTOK_APP_KEY;

  const appSecret =
    process.env.TIKTOK_APP_SECRET;

  if (!appKey || !appSecret) {
    return Response.json(
      {
        success: false,
        message:
          "TikTok credentials are missing",
      },
      { status: 500 }
    );
  }

  /*
   * 2. Get valid TikTok connection.
   */

  let connection;

  try {
    connection =
      await getValidTikTokConnection();
  } catch (error) {
    return Response.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Could not get valid TikTok connection",
      },
      { status: 500 }
    );
  }

  if (!connection.shop_cipher) {
    return Response.json(
      {
        success: false,
        message:
          "TikTok shop cipher is missing",
      },
      { status: 400 }
    );
  }

  /*
   * 3. Search TikTok for orders updated
   *    during the previous 48 hours.
   */

  const now =
    Math.floor(Date.now() / 1000);

  const fortyEightHoursAgo =
    now - 48 * 60 * 60;

  const recentOrderIds =
    new Set<string>();

  let pageToken = "";
  let pagesProcessed = 0;

  while (true) {
    const path =
      "/order/202309/orders/search";

    const timestamp =
      Math.floor(
        Date.now() / 1000
      ).toString();

    /*
     * These are URL/query parameters.
     */

    const signingParams:
      Record<string, string> = {
        app_key: appKey,
        timestamp,
        shop_cipher:
          connection.shop_cipher,
        page_size: "100",
      };

    if (pageToken) {
      signingParams.page_token =
        pageToken;
    }

    /*
     * IMPORTANT:
     *
     * TikTok requires update_time_ge and
     * update_time_lt as INTEGER values
     * inside the POST body.
     */

    const requestBody = {
      update_time_ge:
        fortyEightHoursAgo,

      update_time_lt:
        now,
    };

    const body =
      JSON.stringify(
        requestBody
      );

    const sign =
      createTikTokSign(
        path,
        signingParams,
        appSecret,
        body
      );

    const requestUrl =
      new URL(
        `https://open-api.tiktokglobalshop.com${path}`
      );

    for (
      const [key, value] of
      Object.entries(
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
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-tts-access-token":
              connection.access_token,
          },

          body,

          cache: "no-store",
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      result.code !== 0
    ) {
      return Response.json(
        {
          success: false,

          message:
            "TikTok recent-order reconciliation search failed",

          error:
            result.message,

          tiktok_code:
            result.code,

          request_id:
            result.request_id,
        },
        { status: 500 }
      );
    }

    const orders:
      TikTokOrderSummary[] =
        result.data?.orders ?? [];

    for (const order of orders) {
      if (
        typeof order.id === "string" &&
        order.id.length > 0
      ) {
        recentOrderIds.add(
          order.id
        );
      }
    }

    pagesProcessed += 1;

    const nextPageToken =
      result.data?.next_page_token;

    if (
      !nextPageToken ||
      typeof nextPageToken !== "string"
    ) {
      break;
    }

    pageToken =
      nextPageToken;

    /*
     * Safety limit:
     * 100 pages x 100 orders.
     */

    if (pagesProcessed >= 100) {
      return Response.json(
        {
          success: false,

          message:
            "Reconciliation stopped because pagination exceeded safety limit",
        },
        { status: 500 }
      );
    }
  }

  const ids =
    Array.from(
      recentOrderIds
    );

  /*
   * 4. Nothing changed during the
   *    previous 48 hours.
   */

  if (ids.length === 0) {
    return Response.json({
      success: true,

      message:
        "Reconciliation complete — no recently changed TikTok orders",

      window_hours: 48,

      pages_processed:
        pagesProcessed,

      orders_found: 0,

      orders_refreshed: 0,

      customers_synced: 0,

      google_sheet_synced: false,

      token_refreshed:
        connection.token_refreshed,
    });
  }

  /*
   * 5. Fetch the latest full details.
   *
   * Maximum 50 IDs per request.
   */

  let ordersRefreshed = 0;

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
      Record<string, string> = {
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
      const [key, value] of
      Object.entries(
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

          cache: "no-store",
        }
      );

    const result =
      await response.json();

    if (
      !response.ok ||
      result.code !== 0
    ) {
      return Response.json(
        {
          success: false,

          message:
            "TikTok reconciliation Order Detail request failed",

          error:
            result.message,

          tiktok_code:
            result.code,

          request_id:
            result.request_id,
        },
        { status: 500 }
      );
    }

    const orders:
      TikTokOrderDetail[] =
        result.data?.orders ?? [];

    const syncedAt =
      new Date().toISOString();

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
        .map((order) => {
          returnedOrderIds.add(
            order.id
          );

          return {
            tiktok_order_id:
              order.id,

            status:
              order.status ?? null,

            create_time_unix:
              order.create_time ?? null,

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
              syncedAt,

            last_synced_at:
              syncedAt,
          };
        });

    if (rows.length === 0) {
      continue;
    }

    const {
      error: saveError,
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

    if (saveError) {
      return Response.json(
        {
          success: false,

          message:
            "Reconciliation retrieved orders but could not save them",

          error:
            saveError.message,
        },
        { status: 500 }
      );
    }

    ordersRefreshed +=
      rows.length;
  }

  /*
   * Make sure TikTok returned all IDs
   * discovered by the search.
   */

  const missingOrderIds =
    ids.filter(
      (id) =>
        !returnedOrderIds.has(id)
    );

  if (
    missingOrderIds.length > 0
  ) {
    return Response.json(
      {
        success: false,

        message:
          "Some reconciliation orders were not returned by TikTok Order Detail",

        missing_order_count:
          missingOrderIds.length,
      },
      { status: 503 }
    );
  }

  /*
   * 6. Rebuild customers.
   */

  let customerResult;

  try {
    customerResult =
      await rebuildTikTokCustomers();
  } catch (error) {
    return Response.json(
      {
        success: false,

        message:
          "Orders reconciled, but customer database rebuild failed",

        error:
          error instanceof Error
            ? error.message
            : "Unknown customer rebuild error",
      },
      { status: 500 }
    );
  }

  /*
   * 7. Synchronize Google Sheets.
   */

  let sheetResult;

  try {
    sheetResult =
      await syncTikTokCustomersToGoogleSheet();
  } catch (error) {
    return Response.json(
      {
        success: false,

        message:
          "Orders and customers reconciled, but Google Sheet sync failed",

        error:
          error instanceof Error
            ? error.message
            : "Unknown Google Sheets error",
      },
      { status: 500 }
    );
  }

  /*
   * 8. Safe result.
   */

  return Response.json({
    success: true,

    message:
      "TikTok reconciliation completed successfully",

    window_hours: 48,

    pages_processed:
      pagesProcessed,

    orders_found:
      ids.length,

    orders_refreshed:
      ordersRefreshed,

    customers_synced:
      customerResult.unique_customers,

    google_sheet_synced:
      true,

    google_sheet_customers_synced:
      sheetResult.customers_synced,

    token_refreshed:
      connection.token_refreshed,
  });
}