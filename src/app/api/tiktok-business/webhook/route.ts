import { NextRequest, NextResponse } from "next/server";
import JSONbigImport from "json-bigint";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

const JSONbig = JSONbigImport({
  storeAsString: true,
});

function unixSecondsToIso(value: unknown) {
  if (value === null || value === undefined) return null;

  const seconds = Number(value);

  if (!Number.isFinite(seconds)) return null;

  return new Date(seconds * 1000).toISOString();
}

export async function GET() {
  return NextResponse.json({
    success: true,
    message: "TikTok Business webhook receiver is online.",
  });
}

export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    let payload: any;

    try {
      payload = JSONbig.parse(rawBody);
    } catch {
      console.error("TikTok webhook contained invalid JSON.");

      return NextResponse.json(
        { success: false, message: "Invalid JSON." },
        { status: 400 }
      );
    }

    let content = payload?.content ?? {};

    if (typeof content === "string") {
      try {
        content = JSONbig.parse(content);
      } catch {
        console.error("TikTok webhook content could not be parsed.");

        return NextResponse.json(
          { success: false, message: "Invalid webhook content." },
          { status: 400 }
        );
      }
    }

    // We only care about new comments/replies.
    if (
      payload?.event !== "comment.update" ||
      content?.comment_action !== "insert"
    ) {
      return NextResponse.json({
        success: true,
        ignored: true,
      });
    }

    const commentId =
      content?.comment_id !== undefined
        ? String(content.comment_id)
        : null;

    const videoId =
      content?.video_id !== undefined
        ? String(content.video_id)
        : null;

    const parentCommentId =
      content?.parent_comment_id !== undefined
        ? String(content.parent_comment_id)
        : null;

    const businessId =
      payload?.user_openid ??
      content?.business_id ??
      content?.user_openid ??
      null;

    if (!commentId || !videoId || !businessId) {
      console.error("TikTok comment webhook is missing required IDs:", {
        commentId,
        videoId,
        businessId,
      });

      return NextResponse.json(
        {
          success: false,
          message: "Webhook is missing required identifiers.",
        },
        { status: 400 }
      );
    }

    // Load the latest authorized TikTok access token.
    const {
      data: connection,
      error: connectionError,
    } = await supabaseAdmin
      .from("tiktok_business_connections")
      .select("access_token")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (connectionError || !connection?.access_token) {
      console.error(
        "TikTok access token is unavailable:",
        connectionError
      );

      return NextResponse.json(
        {
          success: false,
          message: "TikTok account is not authorized.",
        },
        { status: 503 }
      );
    }

    // TikTok's webhook gives us the ID, but we fetch the actual comment text.
    const commentUrl = new URL(
      "https://business-api.tiktok.com/open_api/v1.3/business/comment/list/"
    );

    commentUrl.searchParams.set("business_id", String(businessId));
    commentUrl.searchParams.set("video_id", videoId);
    commentUrl.searchParams.set(
      "comment_ids",
      JSON.stringify([commentId])
    );
    commentUrl.searchParams.set("max_count", "30");

    const commentResponse = await fetch(commentUrl.toString(), {
      method: "GET",
      headers: {
        "Access-Token": connection.access_token,
      },
      cache: "no-store",
    });

    const commentRaw = await commentResponse.text();

    let commentResult: any;

    try {
      commentResult = JSONbig.parse(commentRaw);
    } catch {
      console.error(
        "Could not parse TikTok comment API response:",
        commentRaw
      );

      return NextResponse.json(
        {
          success: false,
          message: "Invalid response from TikTok.",
        },
        { status: 502 }
      );
    }

    if (
      !commentResponse.ok ||
      Number(commentResult?.code ?? -1) !== 0
    ) {
      console.error(
        "TikTok comment retrieval failed:",
        commentResult
      );

      return NextResponse.json(
        {
          success: false,
          message: "TikTok comment retrieval failed.",
        },
        { status: 502 }
      );
    }

    const comments = Array.isArray(commentResult?.data?.comments)
      ? commentResult.data.comments
      : [];

    const comment =
      comments.find(
        (item: any) =>
          String(item?.comment_id) === commentId
      ) ?? comments[0];

    if (!comment) {
      console.error(
        "TikTok did not return the new comment:",
        commentId
      );

      return NextResponse.json(
        {
          success: false,
          message: "Comment was not returned by TikTok.",
        },
        { status: 502 }
      );
    }

    const commentText = String(comment?.text ?? "").trim();

    if (!commentText) {
      return NextResponse.json({
        success: true,
        ignored: true,
        message: "Comment has no text.",
      });
    }

    const { data: settings, error: settingsError } =
      await supabaseAdmin
        .from("tiktok_ai_settings")
        .select("reply_delay_seconds")
        .eq("id", 1)
        .single();

    if (settingsError) {
      console.warn(
        "Could not load reply delay. Using 30 seconds.",
        settingsError
      );
    }

    const replyDelaySeconds =
      Number(settings?.reply_delay_seconds) || 30;

    const scheduledReplyAt = new Date(
      Date.now() + replyDelaySeconds * 1000
    ).toISOString();

    const { data, error } = await supabaseAdmin
      .from("tiktok_ai_comments")
      .insert({
        tiktok_comment_id: commentId,
        tiktok_video_id: videoId,
        parent_comment_id:
          parentCommentId ??
          (comment?.parent_comment_id
            ? String(comment.parent_comment_id)
            : null),
        author_id:
          comment?.unique_identifier ?? null,
        author_username:
          comment?.username ?? null,
        comment_text: commentText,
        comment_created_at: unixSecondsToIso(
          comment?.create_time
        ),
        scheduled_reply_at: scheduledReplyAt,
        raw_payload: {
          webhook: payload,
          webhook_content: content,
          tiktok_comment: comment,
        },
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: "Comment already exists.",
        });
      }

      console.error("Supabase comment insert failed:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to queue comment.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      queued: true,
      comment: data,
    });
  } catch (error) {
    console.error("TikTok Business webhook error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Webhook processing failed.",
      },
      { status: 500 }
    );
  }
}
