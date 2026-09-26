import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export async function GET() {
  try {
    const { data, error } = await supabaseAdmin
      .from("tiktok_ai_settings")
      .select("*")
      .eq("id", 1)
      .single();

    if (error) {
      console.error("Settings load error:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to load settings.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: data,
    });
  } catch (error) {
    console.error("Settings GET error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Failed to load settings.",
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (typeof body.auto_reply_enabled === "boolean") {
      updates.auto_reply_enabled = body.auto_reply_enabled;
    }

    if (
      typeof body.reply_delay_seconds === "number" &&
      body.reply_delay_seconds >= 30
    ) {
      updates.reply_delay_seconds = Math.round(body.reply_delay_seconds);
    }

    if (typeof body.ai_instructions === "string") {
      updates.ai_instructions = body.ai_instructions.trim();
    }

    const { data, error } = await supabaseAdmin
      .from("tiktok_ai_settings")
      .update(updates)
      .eq("id", 1)
      .select()
      .single();

    if (error) {
      console.error("Settings update error:", error);

      return NextResponse.json(
        {
          success: false,
          message: "Failed to update settings.",
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      settings: data,
    });
  } catch (error) {
    console.error("Settings PATCH error:", error);

    return NextResponse.json(
      {
        success: false,
        message: "Invalid settings request.",
      },
      { status: 400 }
    );
  }
}
