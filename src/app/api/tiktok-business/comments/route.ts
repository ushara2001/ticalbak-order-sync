import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const commentId =
      body.tiktok_comment_id ||
      body.comment_id;

    const commentText =
      body.comment_text ||
      body.text;

    if (!commentId || !commentText) {
      return NextResponse.json(
        {
          success: false,
          message: "comment_id and comment_text are required",
        },
        { status: 400 }
      );
    }

    const { data: settings, error: settingsError } = await supabaseAdmin
      .from("tiktok_ai_settings")
      .select("reply_delay_seconds")
      .eq("id", 1)
      .single();

    if (settingsError || !settings) {
      console.error("Failed to load reply delay:", settingsError);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to load reply settings.",
        },
        { status: 500 }
      );
    }

    const scheduledReplyAt = new Date(
      Date.now() + settings.reply_delay_seconds * 1000
    ).toISOString();

    const { data, error } = await supabaseAdmin
      .from("tiktok_ai_comments")
      .insert({
        tiktok_comment_id: String(commentId),
        tiktok_video_id: body.tiktok_video_id ?? body.video_id ?? null,
        parent_comment_id: body.parent_comment_id ?? null,
        author_id: body.author_id ?? null,
        author_username: body.author_username ?? null,
        comment_text: String(commentText),
        comment_created_at: body.comment_created_at ?? null,
        scheduled_reply_at: scheduledReplyAt,
        raw_payload: body,
      })
      .select()
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json({
          success: true,
          duplicate: true,
          message: "Comment already exists and was not duplicated.",
        });
      }

      console.error("Supabase insert error:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to save comment.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      duplicate: false,
      comment: data,
    });
  } catch (error) {
    console.error("Comment ingestion error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Invalid request.",
      },
      { status: 400 }
    );
  }
}
