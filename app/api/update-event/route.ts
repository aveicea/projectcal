import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, pageId, property, value, propType } = await req.json();
    if (!apiKey || !pageId || !property) {
      return NextResponse.json({ success: false, error: { message: "필수 파라미터 누락" } }, { status: 400 });
    }
    const notion = new Client({ auth: apiKey });
    type PropValue =
      | { select: { name: string } }
      | { multi_select: { name: string }[] }
      | { status: { name: string } }
      | { rich_text: { text: { content: string } }[] }
      | { title: { text: { content: string } }[] }
      | { relation: { id: string }[] };
    let propValue: PropValue;
    if (propType === "multi_select") {
      propValue = { multi_select: [{ name: value }] };
    } else if (propType === "status") {
      propValue = { status: { name: value } };
    } else if (propType === "rich_text") {
      propValue = { rich_text: [{ text: { content: value } }] };
    } else if (propType === "title") {
      propValue = { title: [{ text: { content: value } }] };
    } else if (propType === "relation") {
      propValue = { relation: [{ id: value }] };
    } else {
      propValue = { select: { name: value } };
    }
    await notion.pages.update({
      page_id: pageId,
      properties: { [property]: propValue },
    });
    return NextResponse.json({ success: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
