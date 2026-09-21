import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: Request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.json(
      {
        success: false,
        message: "TikTok authorization was denied or failed",
        error,
      },
      { status: 400 }
    );
  }

  if (!code) {
    return Response.json(
      {
        success: false,
        message: "No TikTok authorization code was received",
      },
      { status: 400 }
    );
  }

  const appKey = process.env.TIKTOK_APP_KEY;
  const appSecret = process.env.TIKTOK_APP_SECRET;

  if (!appKey || !appSecret) {
    return Response.json(
      {
        success: false,
        message: "TikTok app credentials are missing",
      },
      { status: 500 }
    );
  }

  const tokenUrl = new URL(
    "https://auth.tiktok-shops.com/api/v2/token/get"
  );

  tokenUrl.searchParams.set("app_key", appKey);
  tokenUrl.searchParams.set("app_secret", appSecret);
  tokenUrl.searchParams.set("auth_code", code);
  tokenUrl.searchParams.set("grant_type", "authorized_code");

  const tokenResponse = await fetch(tokenUrl.toString(), {
    method: "GET",
    cache: "no-store",
  });

  const tokenResult = await tokenResponse.json();

  if (!tokenResponse.ok || tokenResult.code !== 0) {
    return Response.json(
      {
        success: false,
        message: "TikTok token exchange failed",
        error: tokenResult.message ?? "Unknown TikTok error",
      },
      { status: 500 }
    );
  }

  const tokenData = tokenResult.data;

  if (tokenData.user_type !== 0) {
    return Response.json(
      {
        success: false,
        message: "The authorization is not a TikTok Shop seller authorization",
      },
      { status: 400 }
    );
  }

  const accessTokenExpiresAt = new Date(
    tokenData.access_token_expire_in * 1000
  ).toISOString();

  const refreshTokenExpiresAt = new Date(
    tokenData.refresh_token_expire_in * 1000
  ).toISOString();

  const { error: databaseError } = await supabaseAdmin
    .from("tiktok_connections")
    .upsert(
      {
        open_id: tokenData.open_id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        access_token_expires_at: accessTokenExpiresAt,
        refresh_token_expires_at: refreshTokenExpiresAt,
        seller_name: tokenData.seller_name,
        seller_base_region: tokenData.seller_base_region,
        user_type: tokenData.user_type,
        granted_scopes: tokenData.granted_scopes ?? [],
        updated_at: new Date().toISOString(),
      },
      {
        onConflict: "open_id",
      }
    );

  if (databaseError) {
    return Response.json(
      {
        success: false,
        message: "TikTok connected, but saving to Supabase failed",
        error: databaseError.message,
      },
      { status: 500 }
    );
  }

  return Response.json({
    success: true,
    message: "TikTok Shop connected successfully",
    seller: tokenData.seller_name,
    region: tokenData.seller_base_region,
  });
}
//redeploy