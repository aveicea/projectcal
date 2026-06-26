import { NextRequest, NextResponse } from "next/server";
import { Client, isFullPage } from "@notionhq/client";

// 프젝칼 항목을 옮기면(날짜 변경) 그 항목과 연결된 플래너 항목들의 날짜도 맞춘다.
// 단, 플래너에서 "완료"된 항목은 건드리지 않는다(미완료만).
export async function POST(req: NextRequest) {
  try {
    const { apiKey, plannerDbId, parentPageId, start, end, plannerDateProp, plannerDoneProp }:
      { apiKey: string; plannerDbId: string; parentPageId: string; start: string; end?: string | null; plannerDateProp?: string; plannerDoneProp?: string } = await req.json();
    if (!apiKey || !plannerDbId || !parentPageId || !start) {
      return NextResponse.json({ success: false, error: { message: "필수 파라미터 누락" } }, { status: 400 });
    }
    const notion = new Client({ auth: apiKey });

    // 상위(프젝칼) 페이지의 DB id
    const parent = await notion.pages.retrieve({ page_id: parentPageId });
    const parentDbId = (parent as { parent?: { database_id?: string } }).parent?.database_id;

    // 플래너 스키마에서 연결 관계형/날짜/완료 속성 해석
    const db = await notion.databases.retrieve({ database_id: plannerDbId });
    const schema = db.properties as Record<string, { type: string; relation?: { database_id?: string } }>;

    let linkProp: string | undefined;
    for (const [name, p] of Object.entries(schema)) {
      if (p.type === "relation" && parentDbId && p.relation?.database_id === parentDbId) { linkProp = name; break; }
    }
    if (!linkProp) return NextResponse.json({ success: true, updated: 0 });

    let dateProp = plannerDateProp && schema[plannerDateProp]?.type === "date" ? plannerDateProp : undefined;
    if (!dateProp) for (const [name, p] of Object.entries(schema)) { if (p.type === "date") { dateProp = name; break; } }
    if (!dateProp) return NextResponse.json({ success: true, updated: 0 });

    let doneProp = plannerDoneProp && schema[plannerDoneProp]?.type === "checkbox" ? plannerDoneProp : undefined;
    if (!doneProp && schema["완료"]?.type === "checkbox") doneProp = "완료";

    // 연결된 플래너 항목 조회 (미완료만)
    const filter: Record<string, unknown> = doneProp
      ? { and: [
          { property: linkProp, relation: { contains: parentPageId } },
          { property: doneProp, checkbox: { equals: false } },
        ] }
      : { property: linkProp, relation: { contains: parentPageId } };

    const res = await notion.databases.query({ database_id: plannerDbId, filter: filter as never, page_size: 100 });
    const dateValue = { date: { start, end: end && end !== start ? end : null } };
    let updated = 0;
    await Promise.all(res.results.filter(isFullPage).map(async (page) => {
      await notion.pages.update({ page_id: page.id, properties: { [dateProp!]: dateValue } as never });
      updated++;
    }));

    return NextResponse.json({ success: true, updated });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
