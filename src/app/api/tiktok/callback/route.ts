export async function GET(request: Request) {
  const url = new URL(request.url);

  const code = url.searchParams.get("code");

  return Response.json({
    success: true,
    message: "TikTok callback received",
    code: code,
  });
}