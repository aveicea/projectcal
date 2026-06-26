import { NextRequest, NextResponse } from "next/server";
import { Client, isFullPage } from "@notionhq/client";

// 프젝칼 항목 → 플래너로 "복사" (이동 아님).
// 하위 제목이 있으면 각 제목마다 ① 프젝칼 네이티브 하위 항목과 ② 플래너 페이지를 만들고,
// 플래너 페이지의 PLANNER 관계형을 [상위, 하위] 둘 다에 연결한다.
// 하위 제목이 없으면 플래너 페이지 1개만 만들고 PLANNER=[상위]로 연결한다.
// 완료/줄긋기 값은 프젝칼 DB의 `완료` 롤업이 자동 계산하므로 여기서 건드리지 않는다.

interface Body {
  apiKey: string;            // 노션 토큰 (양쪽 DB 공유)
  plannerDbId: string;
  parentPageId: string;
  subTitles?: string[];
  // 플래너 속성명 (기본: 범위/날짜/책/PLANNER)
  plannerTitleProp?: string;
  plannerDateProp?: string;
  plannerBookProp?: string;
  plannerLinkProp?: string;
  // 프젝칼 속성명 (기본: 상위 항목/책) — titleProperty 는 자동 탐지
  parentRelProp?: string;
  bookProp?: string;
  titleProperty?: string;
  dateProperty?: string;
}

type PropMap = Record<string, {
  type: string;
  title?: Array<{ plain_text?: string }>;
  date?: { start?: string; end?: string | null };
  relation?: Array<{ id: string }>;
}>;

function readTitle(props: PropMap, titleProp?: string): string {
  const tp = titleProp ? props[titleProp] : undefined;
  if (tp?.type === "title" && tp.title) {
    const t = tp.title.map((x) => x.plain_text ?? "").join("");
    if (t) return t;
  }
  for (const prop of Object.values(props)) {
    if (prop.type === "title" && prop.title) {
      const t = prop.title.map((x) => x.plain_text ?? "").join("");
      if (t) return t;
    }
  }
  return "Untitled";
}

export async function POST(req: NextRequest) {
  try {
    const b: Body = await req.json();
    if (!b.apiKey || !b.plannerDbId || !b.parentPageId) {
      return NextResponse.json({ success: false, error: { message: "필수 파라미터가 누락되었습니다." } }, { status: 400 });
    }

    const titleProp = "범위";
    const dateProp = "날짜";
    const bookPropPlanner = b.plannerBookProp || "책";
    const linkProp = b.plannerLinkProp || "PLANNER";
    const parentRelProp = b.parentRelProp || "상위 항목";
    const bookPropSrc = b.bookProp || "책";

    const plannerTitleProp = b.plannerTitleProp || titleProp;
    const plannerDateProp = b.plannerDateProp || dateProp;

    const notion = new Client({ auth: b.apiKey });

    // 1) 상위 항목에서 제목·날짜·책 읽기
    const parent = await notion.pages.retrieve({ page_id: b.parentPageId });
    if (!isFullPage(parent)) {
      return NextResponse.json({ success: false, error: { message: "상위 항목을 불러올 수 없습니다." } }, { status: 400 });
    }
    const parentProps = parent.properties as PropMap;
    const parentTitle = readTitle(parentProps, b.titleProperty);

    const srcDateProp = b.dateProperty ? parentProps[b.dateProperty] : undefined;
    const dateVal = srcDateProp?.type === "date" ? srcDateProp.date : undefined;
    const bookRel = parentProps[bookPropSrc]?.type === "relation" ? parentProps[bookPropSrc].relation ?? [] : [];
    const bookIds = bookRel.map((r) => r.id);

    const datePropValue = dateVal?.start
      ? { date: { start: dateVal.start, end: dateVal.end ?? null } }
      : null;

    // 플래너 페이지 1개 생성 헬퍼
    const createPlannerPage = async (title: string, linkIds: string[]) => {
      const properties: Record<string, unknown> = {
        [plannerTitleProp]: { title: [{ text: { content: title } }] },
        [linkProp]: { relation: linkIds.map((id) => ({ id })) },
      };
      if (datePropValue) properties[plannerDateProp] = datePropValue;
      if (bookIds.length > 0) properties[bookPropPlanner] = { relation: bookIds.map((id) => ({ id })) };
      const page = await notion.pages.create({ parent: { database_id: b.plannerDbId }, properties: properties as never });
      return (page as { id: string }).id;
    };

    // 프젝칼 네이티브 하위 항목 1개 생성 헬퍼
    const createSubItem = async (title: string): Promise<string> => {
      const parentDbId = (parent as { parent?: { database_id?: string } }).parent?.database_id;
      const properties: Record<string, unknown> = {};
      // 제목 속성명 — body 우선, 없으면 상위에서 탐지
      let pcalTitleProp = b.titleProperty;
      if (!pcalTitleProp) {
        for (const [name, prop] of Object.entries(parentProps)) {
          if (prop.type === "title") { pcalTitleProp = name; break; }
        }
      }
      if (pcalTitleProp) properties[pcalTitleProp] = { title: [{ text: { content: title } }] };
      properties[parentRelProp] = { relation: [{ id: b.parentPageId }] };
      if (datePropValue && b.dateProperty) properties[b.dateProperty] = datePropValue;
      if (bookIds.length > 0) properties[bookPropSrc] = { relation: bookIds.map((id) => ({ id })) };
      const page = await notion.pages.create({ parent: { database_id: parentDbId! }, properties: properties as never });
      return (page as { id: string }).id;
    };

    const titles = (b.subTitles ?? []).map((t) => t.trim()).filter(Boolean);
    const created: { plannerId: string; subItemId?: string }[] = [];

    if (titles.length === 0) {
      // 하위 없이 상위 제목 그대로 플래너 1개
      const plannerId = await createPlannerPage(parentTitle, [b.parentPageId]);
      created.push({ plannerId });
    } else {
      for (const title of titles) {
        const subItemId = await createSubItem(title);
        const plannerId = await createPlannerPage(title, [b.parentPageId, subItemId]);
        created.push({ plannerId, subItemId });
      }
    }

    return NextResponse.json({ success: true, created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
