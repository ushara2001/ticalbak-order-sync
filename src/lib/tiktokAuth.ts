import { supabaseAdmin } from "@/lib/supabaseAdmin";

type TikTokConnection = {
  id: string;
  open_id: string | null;
  access_token: string;
  refresh_token: string;
  access_token_expires_at: string | null;
  refresh_token_expires_at: string | null;
  shop_id: string | null;
  shop_cipher: string | null;
};

export async function getValidTikTokConnection() {
  const { data: connections, error } =
    await supabaseAdmin
      .from("tiktok_connections")
      .select(
        `
        id,
        open_id,
        access_token,
        refresh_token,
        access_token_expires_at,
        refresh_token_expires_at,
        shop_id,
        shop_cipher
        `
      )
      .limit(1);

  if (error) {
    throw new Error(
      `Could not read TikTok connection: ${error.message}`
    );
  }

  const connection =
    connections?.[0] as TikTokConnection | undefined;

  if (
    !connection?.access_token ||
    !connection?.refresh_token
  ) {
    throw new Error(
      "TikTok connection or tokens are missing"
    );
  }

  /*
   * Refresh if the access token will expire
   * within the next 24 hours.
   */
  const expiryTime =
    connection.access_token_expires_at
      ? new Date(
          connection.access_token_expires_at
        ).getTime()
      : 0;

  const twentyFourHours =
    24 * 60 * 60 * 1000;

  const shouldRefresh =
    !expiryTime ||
    expiryTime - Date.now() <
      twentyFourHours;

  if (!shouldRefresh) {
    return {
      ...connection,
      token_refreshed: false,
    };
  }

  const appKey =
    process.env.TIKTOK_APP_KEY;

  const appSecret =
    process.env.TIKTOK_APP_SECRET;

  if (!appKey || !appSecret) {
    throw new Error(
      "TikTok app credentials are missing"
    );
  }

  /*
   * Check that the refresh token itself
   * has not already expired.
   */
  if (
    connection.refresh_token_expires_at &&
    new Date(
      connection.refresh_token_expires_at
    ).getTime() <= Date.now()
  ) {
    throw new Error(
      "TikTok refresh token has expired. Reauthorization is required."
    );
  }

  const refreshUrl = new URL(
    "https://auth.tiktok-shops.com/api/v2/token/refresh"
  );

  refreshUrl.searchParams.set(
    "app_key",
    appKey
  );

  refreshUrl.searchParams.set(
    "app_secret",
    appSecret
  );

  refreshUrl.searchParams.set(
    "refresh_token",
    connection.refresh_token
  );

  refreshUrl.searchParams.set(
    "grant_type",
    "refresh_token"
  );

  const response = await fetch(
    refreshUrl.toString(),
    {
      method: "GET",
      cache: "no-store",
    }
  );

  const result = await response.json();

  if (!response.ok || result.code !== 0) {
    throw new Error(
      `TikTok token refresh failed: ${
        result.message ??
        "Unknown TikTok error"
      }`
    );
  }

  const tokenData = result.data;

  /*
   * TikTok returns these as Unix timestamps,
   * not durations.
   */
  const accessTokenExpiresAt =
    new Date(
      tokenData.access_token_expire_in *
        1000
    ).toISOString();

  const refreshTokenExpiresAt =
    new Date(
      tokenData.refresh_token_expire_in *
        1000
    ).toISOString();

  /*
   * IMPORTANT:
   * TikTok may return a new refresh token.
   * Always save the token returned here.
   */
  const newRefreshToken =
    tokenData.refresh_token ||
    connection.refresh_token;

  const { error: updateError } =
    await supabaseAdmin
      .from("tiktok_connections")
      .update({
        access_token:
          tokenData.access_token,

        refresh_token:
          newRefreshToken,

        access_token_expires_at:
          accessTokenExpiresAt,

        refresh_token_expires_at:
          refreshTokenExpiresAt,

        open_id:
          tokenData.open_id ??
          connection.open_id,

        granted_scopes:
          tokenData.granted_scopes ?? null,

        last_token_refresh_at:
          new Date().toISOString(),

        updated_at:
          new Date().toISOString(),
      })
      .eq("id", connection.id);

  if (updateError) {
    throw new Error(
      `New TikTok tokens were received but could not be saved: ${updateError.message}`
    );
  }

  return {
    ...connection,

    access_token:
      tokenData.access_token,

    refresh_token:
      newRefreshToken,

    access_token_expires_at:
      accessTokenExpiresAt,

    refresh_token_expires_at:
      refreshTokenExpiresAt,

    token_refreshed: true,
  };
}