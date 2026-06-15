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

    const dateProperties = Object.entries(props)
      .filter(([, p]) => p.type === "date")
      .map(([name]) => name);

    const titleProperties = Object.entries(props)
      .filter(([, p]) => p.type === "title" || p.type === "rich_text")
      .map(([name, p]) => ({ name, type: p.type }));

    const groupableTypes = ["select", "multi_select", "rich_text", "formula", "title", "rollup", "relation"];
    const groupableProperties = Object.entries(props)
      .filter(([, p]) => groupableTypes.includes(p.type))
      .map(([name, p]) => ({ name, type: p.type }));

    const selectOptions: Record<string, string[]> = {};
    for (const [name, prop] of Object.entries(props)) {
      const tp = prop as Record<string, unknown>;
      if (prop.type === "select") {
        const opts = (tp.select as { options?: { name: string }[] })?.options;
        if (opts) selectOptions[name] = opts.map((o) => o.name);
      } else if (prop.type === "multi_select") {
        const opts = (tp.multi_select as { options?: { name: string }[] })?.options;
        if (opts) selectOptions[name] = opts.map((o) => o.name);
      }
    }

    return NextResponse.json({ success: true, data: { dateProperty, titleProperty, dateProperties, titleProperties, groupableProperties, selectOptions } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
