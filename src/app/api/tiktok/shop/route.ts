import { supabaseAdmin } from "@/lib/supabaseAdmin";
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

  const path = "/authorization/202309/shops";

  const timestamp =
    Math.floor(Date.now() / 1000).toString();

  const signingParams = {
    app_key: appKey,
    timestamp,
  };

  const sign = createTikTokSign(
    path,
    signingParams,
    appSecret
  );

  const requestUrl = new URL(
    `https://open-api.tiktokglobalshop.com${path}`
  );

  requestUrl.searchParams.set("app_key", appKey);
  requestUrl.searchParams.set("timestamp", timestamp);
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
        message: "TikTok API request failed",
        token_refreshed: connection.token_refreshed,
        tiktok_code: result.code,
        error: result.message,
        request_id: result.request_id,
      },
      { status: 500 }
    );
  }

  const shop = result.data?.shops?.[0];

  if (!shop) {
    return Response.json(
      {
        success: false,
        message: "TikTok returned no authorized shops",
      },
      { status: 404 }
    );
  }

  const { error: saveError } = await supabaseAdmin
    .from("tiktok_connections")
    .update({
      shop_id: shop.id,
      shop_cipher: shop.cipher,
      shop_code: shop.code,
      seller_name: shop.name,
      seller_base_region: shop.region,
      seller_type: shop.seller_type,
      updated_at: new Date().toISOString(),
    })
    .eq("id", connection.id);

  if (saveError) {
    return Response.json(
      {
        success: false,
        message: "Shop retrieved but saving failed",
        error: saveError.message,
      },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    message:
      "TikTok Shop information retrieved successfully",

    token_refreshed:
      connection.token_refreshed,

    shop: {
      id: shop.id,
      code: shop.code,
      name: shop.name,
      region: shop.region,
      seller_type: shop.seller_type,
    },
  });
}