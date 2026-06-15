import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, databaseId, titleProperty, dateProperty, title, startDate, endDate } = await req.json();
    if (!apiKey || !databaseId || !title || !startDate) {
      return NextResponse.json({ success: false, error: { message: "필수 파라미터가 누락되었습니다." } }, { status: 400 });
    }
    const notion = new Client({ auth: apiKey });
    const page = await notion.pages.create({
      parent: { database_id: databaseId },
      properties: {
        [titleProperty || "이름"]: { title: [{ text: { content: title } }] },
        [dateProperty || "날짜"]: { date: { start: startDate, end: endDate || startDate } },
      },
    });
    return NextResponse.json({ success: true, id: (page as { id: string }).id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
