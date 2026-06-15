import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, pageId } = await req.json();
    if (!apiKey || !pageId) {
      return NextResponse.json({ success: false, error: { message: "필수 파라미터 누락" } }, { status: 400 });
    }
    const notion = new Client({ auth: apiKey });
    await notion.pages.update({ page_id: pageId, archived: true });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
