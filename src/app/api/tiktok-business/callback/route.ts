import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);

    const authCode =
      url.searchParams.get("auth_code") ||
      url.searchParams.get("code");

    const state = url.searchParams.get("state");

    if (!authCode) {
      return NextResponse.json(
        {
          success: false,
          message: "TikTok Business callback reached, but no authorization code was provided.",
        },
        { status: 400 }
      );
    }

    const appId = process.env.TIKTOK_BUSINESS_APP_ID;
    const appSecret = process.env.TIKTOK_BUSINESS_APP_SECRET;

    if (!appId || !appSecret) {
      return NextResponse.json(
        {
          success: false,
          message: "TikTok Business app credentials are missing.",
        },
        { status: 500 }
      );
    }

    const tokenResponse = await fetch(
      "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          app_id: appId,
          secret: appSecret,
          auth_code: authCode,
        }),
      }
    );

    const tokenResult = await tokenResponse.json();

    if (!tokenResponse.ok || tokenResult?.code !== 0 || !tokenResult?.data?.access_token) {
      console.error("TikTok Business token exchange failed:", tokenResult);

      return NextResponse.json(
        {
          success: false,
          message: "TikTok Business token exchange failed.",
        },
        { status: 400 }
      );
    }

    const tokenData = tokenResult.data;

    const { error } = await supabaseAdmin
      .from("tiktok_business_connections")
      .upsert(
        {
          id: 1,
          access_token: tokenData.access_token,
          advertiser_ids: tokenData.advertiser_ids ?? [],
          granted_scopes: tokenData.scope ?? tokenData.scopes ?? [],
          raw_token_response: tokenResult,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "id" }
      );

    if (error) {
      console.error("TikTok Business token save error:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Authorization succeeded, but saving the connection failed.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "TikTok Business account connected successfully.",
      state: state ?? null,
    });
  } catch (error) {
    console.error("TikTok Business callback error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "TikTok Business authorization failed.",
      },
      { status: 500 }
    );
  }
}
