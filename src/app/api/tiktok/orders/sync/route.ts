import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createTikTokSign } from "@/lib/tiktokSign";
import { getValidTikTokConnection } from "@/lib/tiktokAuth";

type TikTokOrder = {
  id?: string;
  status?: string;
  create_time?: number;
  [key: string]: unknown;
};

export async function GET() {
  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  if (!appKey || !appSecret) {
    return Response.json(
      {
        success: false,
        message: "TikTok credentials are missing",
      },
      { status: 500 }
    );
  }

  let connection;

  try {
    connection = await getValidTikTokConnection();
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
        message: "TikTok shop cipher is missing",
      },
      { status: 400 }
    );
  }

  const path = "/order/202309/orders/search";

  let pageToken: string | null = null;
  let pagesProcessed = 0;
  let ordersProcessed = 0;

  const maxPages = 100;

  do {
    const timestamp =
      Math.floor(Date.now() / 1000).toString();

    const body = JSON.stringify({});

    const signingParams: Record<string, string> = {
      app_key: appKey,
      timestamp,
      shop_cipher: connection.shop_cipher,
      page_size: "100",
      sort_field: "create_time",
      sort_order: "DESC",
    };

    if (pageToken) {
      signingParams.page_token = pageToken;
    }

    const sign = createTikTokSign(
      path,
      signingParams,
      appSecret,
      body
    );

    const requestUrl = new URL(
      `https://open-api.tiktokglobalshop.com${path}`
    );

    for (const [key, value] of Object.entries(signingParams)) {
      requestUrl.searchParams.set(key, value);
    }

    requestUrl.searchParams.set("sign", sign);

    const response = await fetch(requestUrl.toString(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-tts-access-token": connection.access_token,
      },
      body,
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok || result.code !== 0) {
      return Response.json(
        {
          success: false,
          message: "TikTok historical sync failed",
          pages_processed: pagesProcessed,
          orders_processed: ordersProcessed,
          tiktok_code: result.code,
          error: result.message,
          request_id: result.request_id,
        },
        { status: 500 }
      );
    }

    const orders: TikTokOrder[] =
      result.data?.orders ?? [];

    if (orders.length > 0) {
      const rows = orders
        .filter((order) => order.id)
        .map((order) => ({
          tiktok_order_id: order.id,
          status: order.status ?? null,

          create_time_unix:
            order.create_time ?? null,

          created_at_tiktok:
            order.create_time
              ? new Date(
                  order.create_time * 1000
                ).toISOString()
              : null,

          raw_data: order,

          last_synced_at:
            new Date().toISOString(),
        }));

      const { error: saveError } =
        await supabaseAdmin
          .from("tiktok_orders")
          .upsert(rows, {
            onConflict: "tiktok_order_id",
          });

      if (saveError) {
        return Response.json(
          {
            success: false,
            message:
              "Orders were retrieved but saving to Supabase failed",
            pages_processed: pagesProcessed,
            orders_processed: ordersProcessed,
            error: saveError.message,
          },
          { status: 500 }
        );
      }

      ordersProcessed += rows.length;
    }

    pagesProcessed += 1;

    pageToken =
      result.data?.next_page_token || null;

    if (pagesProcessed >= maxPages) {
      return Response.json(
        {
          success: false,
          message:
            "Historical sync stopped at safety limit",
          pages_processed: pagesProcessed,
          orders_processed: ordersProcessed,
        },
        { status: 500 }
      );
    }
  } while (pageToken);

  return Response.json({
    success: true,
    message:
      "TikTok historical order sync completed",

    token_refreshed:
      connection.token_refreshed,

    pages_processed:
      pagesProcessed,

    orders_processed:
      ordersProcessed,
  });
}