import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, databaseId } = await req.json();
    if (!apiKey || !databaseId) {
      return NextResponse.json({ success: false, error: { message: "API 키와 데이터베이스 ID가 필요합니다." } }, { status: 400 });
    }

    const notion = new Client({ auth: apiKey });
    const db = await notion.databases.retrieve({ database_id: databaseId });

    let dateProperty = "날짜";
    let titleProperty = "이름";

    const props = db.properties as Record<string, { type: string; name: string }>;
    for (const [name, prop] of Object.entries(props)) {
      if (prop.type === "date" && dateProperty === "날짜") {
        dateProperty = name;
      }
      if (prop.type === "title") {
        titleProperty = name;
      }
    }

    return NextResponse.json({ success: true, data: { dateProperty, titleProperty } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
