import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
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

  return NextResponse.json({
    success: true,
    message: "TikTok Business authorization callback received.",
    authCodeReceived: true,
    state: state ?? null,
  });
}
