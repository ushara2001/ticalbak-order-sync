import { rebuildTikTokCustomers }
  from "@/lib/rebuildTikTokCustomers";

export async function GET() {
  try {
    const result =
      await rebuildTikTokCustomers();

    return Response.json({
      success: true,
      message:
        "TikTok customer database rebuilt successfully",
      ...result,
    });
  } catch (error) {
    return Response.json(
      {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Customer rebuild failed",
      },
      { status: 500 }
    );
  }
}