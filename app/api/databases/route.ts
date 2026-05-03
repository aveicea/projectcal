import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export async function POST(req: NextRequest) {
  try {
    const { apiKey } = await req.json();
    if (!apiKey) {
      return NextResponse.json({ success: false, error: { message: "API 키가 필요합니다." } }, { status: 400 });
    }

    const notion = new Client({ auth: apiKey });
    const response = await notion.search({
      filter: { value: "database", property: "object" },
      page_size: 50,
    });

    const databases = response.results
      .filter((r): r is Extract<typeof r, { object: "database" }> => r.object === "database")
      .map((db) => {
        const titleArr = (db as { title?: Array<{ plain_text?: string }> }).title ?? [];
        const title = titleArr.map((t) => t.plain_text ?? "").join("") || "Untitled";
        return { id: db.id, title };
      });

    return NextResponse.json({ success: true, data: databases });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
