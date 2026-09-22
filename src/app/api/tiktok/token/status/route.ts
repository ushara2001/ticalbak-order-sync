import { getValidTikTokConnection }
  from "@/lib/tiktokAuth";

export async function GET() {
  try {
    const connection =
      await getValidTikTokConnection();

    return Response.json({
      success: true,

      message:
        "TikTok token is valid",

      token_refreshed:
        connection.token_refreshed,

      access_token_expires_at:
        connection.access_token_expires_at,

      refresh_token_expires_at:
        connection.refresh_token_expires_at,

      shop_connected:
        Boolean(connection.shop_cipher),
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Unknown token error",
      },
      {
        status: 500,
      }
    );
  }
}