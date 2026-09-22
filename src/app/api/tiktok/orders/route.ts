import { createTikTokSign } from "@/lib/tiktokSign";
import { getValidTikTokConnection } from "@/lib/tiktokAuth";

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

  const timestamp =
    Math.floor(Date.now() / 1000).toString();

  const body = JSON.stringify({});

  const signingParams = {
    app_key: appKey,
    timestamp,
    shop_cipher: connection.shop_cipher,
    page_size: "20",
    sort_field: "create_time",
    sort_order: "DESC",
  };

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
        message: "TikTok Orders API request failed",
        tiktok_code: result.code,
        error: result.message,
        request_id: result.request_id,
      },
      { status: 500 }
    );
  }

  const orders = result.data?.orders ?? [];

  return Response.json({
    success: true,

    message:
      "TikTok orders retrieved successfully",

    token_refreshed:
      connection.token_refreshed,

    count: orders.length,

    next_page_token:
      result.data?.next_page_token ?? null,

    orders: orders.map(
      (order: {
        id?: string;
        status?: string;
        create_time?: number;
      }) => ({
        id: order.id,
        status: order.status,
        create_time: order.create_time,
      })
    ),
  });
}