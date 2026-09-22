import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createTikTokSign } from "@/lib/tiktokSign";
import { getValidTikTokConnection } from "@/lib/tiktokAuth";

type TikTokOrderDetail = {
  id?: string;
  status?: string;
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

  const path = "/order/202507/orders";

  let batchesProcessed = 0;
  let ordersProcessed = 0;

  const maxBatches = 20;

  while (batchesProcessed < maxBatches) {
    const { data: unsyncedOrders, error: orderReadError } =
      await supabaseAdmin
        .from("tiktok_orders")
        .select("tiktok_order_id")
        .eq("detail_synced", false)
        .limit(50);

    if (orderReadError) {
      return Response.json(
        {
          success: false,
          message: "Could not read unsynced orders",
          error: orderReadError.message,
        },
        { status: 500 }
      );
    }

    if (!unsyncedOrders || unsyncedOrders.length === 0) {
      break;
    }

    const ids = unsyncedOrders.map(
      (order) => order.tiktok_order_id
    );

    const timestamp =
      Math.floor(Date.now() / 1000).toString();

    const signingParams: Record<string, string> = {
      app_key: appKey,
      timestamp,
      shop_cipher: connection.shop_cipher,
      ids: ids.join(","),
    };

    const sign = createTikTokSign(
      path,
      signingParams,
      appSecret
    );

    const requestUrl = new URL(
      `https://open-api.tiktokglobalshop.com${path}`
    );

    for (const [key, value] of Object.entries(signingParams)) {
      requestUrl.searchParams.set(key, value);
    }

    requestUrl.searchParams.set("sign", sign);

    const response = await fetch(requestUrl.toString(), {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "x-tts-access-token": connection.access_token,
      },
      cache: "no-store",
    });

    const result = await response.json();

    if (!response.ok || result.code !== 0) {
      return Response.json(
        {
          success: false,
          message: "TikTok Order Detail API request failed",
          token_refreshed: connection.token_refreshed,
          batches_processed: batchesProcessed,
          orders_processed: ordersProcessed,
          tiktok_code: result.code,
          error: result.message,
          request_id: result.request_id,
        },
        { status: 500 }
      );
    }

    const detailedOrders: TikTokOrderDetail[] =
      result.data?.orders ?? [];

    for (const order of detailedOrders) {
      if (!order.id) {
        continue;
      }

      const { error: saveError } = await supabaseAdmin
        .from("tiktok_orders")
        .update({
          status: order.status ?? null,
          raw_detail: order,
          detail_synced: true,
          detail_synced_at: new Date().toISOString(),
          last_synced_at: new Date().toISOString(),
        })
        .eq("tiktok_order_id", order.id);

      if (saveError) {
        return Response.json(
          {
            success: false,
            message:
              "Order detail retrieved but saving failed",
            order_id: order.id,
            error: saveError.message,
          },
          { status: 500 }
        );
      }

      ordersProcessed += 1;
    }

    batchesProcessed += 1;
  }

  const { count: remaining } = await supabaseAdmin
    .from("tiktok_orders")
    .select("*", {
      count: "exact",
      head: true,
    })
    .eq("detail_synced", false);

  return Response.json({
    success: true,
    message: "TikTok order detail sync completed",
    token_refreshed: connection.token_refreshed,
    batches_processed: batchesProcessed,
    orders_processed: ordersProcessed,
    remaining_unsynced: remaining ?? 0,
  });
}