import { syncTikTokCustomersToGoogleSheet } from "@/lib/syncTikTokCustomersToGoogleSheet";

export async function POST(request: Request) {
  const secret =
    process.env.INTERNAL_PROCESSOR_SECRET;

  const authorization =
    request.headers.get("authorization");

  if (
    !secret ||
    authorization !== `Bearer ${secret}`
  ) {
    return Response.json(
      {
        success: false,
        message: "Unauthorized",
      },
      {
        status: 401,
      }
    );
  }

  try {
    const result =
      await syncTikTokCustomersToGoogleSheet();

    return Response.json({
      success: true,

      message:
        "TikTok customers synchronized to Google Sheets",

      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,

        message:
          error instanceof Error
            ? error.message
            : "Google Sheets synchronization failed",
      },
      {
        status: 500,
      }
    );
  }
}