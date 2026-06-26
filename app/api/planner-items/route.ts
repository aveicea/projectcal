import { NextRequest, NextResponse } from "next/server";
import { Client, isFullPage } from "@notionhq/client";

// 플래너 DB의 기존 항목 목록(id + 제목 + 완료여부)을 반환 — 보내기 모달에서 토글로 선택용
export async function POST(req: NextRequest) {
  try {
    const { apiKey, plannerDbId, doneProp }: { apiKey: string; plannerDbId: string; doneProp?: string } = await req.json();
    if (!apiKey || !plannerDbId) {
      return NextResponse.json({ success: false, error: { message: "필수 파라미터가 누락되었습니다." } }, { status: 400 });
    }
    const notion = new Client({ auth: apiKey });
    const res = await notion.databases.query({
      database_id: plannerDbId,
      page_size: 100,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    });

    const donePropName = doneProp || "완료";
    type P = { type: string; title?: Array<{ plain_text?: string }>; checkbox?: boolean };
    const items = res.results.filter(isFullPage).map((page) => {
      const props = page.properties as Record<string, P>;
      let title = "제목 없음";
      for (const prop of Object.values(props)) {
        if (prop.type === "title" && prop.title) {
          const t = prop.title.map((x) => x.plain_text ?? "").join("").trim();
          if (t) { title = t; break; }
        }
      }
      const dp = props[donePropName];
      const done = dp?.type === "checkbox" ? !!dp.checkbox : false;
      return { id: page.id, title, done };
    });

    return NextResponse.json({ success: true, items });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
