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
  // 하위 항목별 제목+날짜 (지정 시 그 날짜로 하위/플래너 생성). subTitles보다 우선
  subItems?: { title: string; start?: string | null; end?: string | null }[];
  // 기존 플래너 항목을 직접 연결 (토글 선택)
  existingPlannerIds?: string[];
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

function dbTitle(db: unknown): string {
  const arr = (db as { title?: Array<{ plain_text?: string }> }).title ?? [];
  return arr.map((t) => t.plain_text ?? "").join("").trim();
}

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

    const cfgLinkProp = b.plannerLinkProp || "PLANNER";
    const cfgBookPropPlanner = b.plannerBookProp || "책";
    const parentRelProp = b.parentRelProp || "상위 항목";
    const bookPropSrc = b.bookProp || "책";
    const cfgPlannerTitleProp = b.plannerTitleProp || "범위";
    const cfgPlannerDateProp = b.plannerDateProp || "날짜";

    const notion = new Client({ auth: b.apiKey });

    // 1) 상위 항목에서 제목·날짜·책 읽기
    const parent = await notion.pages.retrieve({ page_id: b.parentPageId });
    if (!isFullPage(parent)) {
      return NextResponse.json({ success: false, error: { message: "상위 항목을 불러올 수 없습니다." } }, { status: 400 });
    }
    const parentProps = parent.properties as PropMap;
    const parentTitle = readTitle(parentProps, b.titleProperty);
    const parentDbId = (parent as { parent?: { database_id?: string } }).parent?.database_id;

    const srcDateProp = b.dateProperty ? parentProps[b.dateProperty] : undefined;
    const dateVal = srcDateProp?.type === "date" ? srcDateProp.date : undefined;
    const bookRel = parentProps[bookPropSrc]?.type === "relation" ? parentProps[bookPropSrc].relation ?? [] : [];
    const bookIds = bookRel.map((r) => r.id);

    const datePropValue = dateVal?.start
      ? { date: { start: dateVal.start, end: dateVal.end ?? null } }
      : null;

    // 2) 플래너 DB 스키마를 읽어 속성 이름을 실제 스키마 기준으로 해석 (이름 추측 대신)
    const plannerDb = await notion.databases.retrieve({ database_id: b.plannerDbId });
    const plannerSchema = plannerDb.properties as Record<string, { type: string; relation?: { database_id?: string } }>;

    // 제목: 실제 title 속성
    let plannerTitleProp = cfgPlannerTitleProp;
    for (const [name, p] of Object.entries(plannerSchema)) { if (p.type === "title") { plannerTitleProp = name; break; } }

    // 날짜: 설정값이 date면 사용, 아니면 첫 date 속성, 없으면 생략
    let plannerDateProp: string | null = null;
    if (plannerSchema[cfgPlannerDateProp]?.type === "date") plannerDateProp = cfgPlannerDateProp;
    else for (const [name, p] of Object.entries(plannerSchema)) { if (p.type === "date") { plannerDateProp = name; break; } }

    // 책: 설정값이 relation으로 존재할 때만 복사
    const plannerBookProp = plannerSchema[cfgBookPropPlanner]?.type === "relation" ? cfgBookPropPlanner : null;

    // 프젝칼로 연결되는 관계형: 프젝칼 DB를 가리키는 relation 우선, 없으면 설정 이름, 그래도 없으면 새로 생성
    let linkProp: string | null = null;
    for (const [name, p] of Object.entries(plannerSchema)) {
      if (p.type === "relation" && parentDbId && p.relation?.database_id === parentDbId) { linkProp = name; break; }
    }
    if (!linkProp && plannerSchema[cfgLinkProp]?.type === "relation") linkProp = cfgLinkProp;
    if (!linkProp) {
      if (!parentDbId) throw new Error("상위 항목의 데이터베이스를 확인할 수 없어 관계형을 만들 수 없습니다.");
      // 양방향 관계형을 새로 생성하되, 각 속성 이름은 "상대 DB 이름"으로 짓는다.
      const pcalDb = await notion.databases.retrieve({ database_id: parentDbId });
      const pcalName = dbTitle(pcalDb) || cfgLinkProp;       // 플래너 쪽 관계형 = 프젝칼 DB 이름
      const plannerName = dbTitle(plannerDb) || "플래너";      // 프젝칼 쪽 동기화 속성 = 플래너 DB 이름
      const newLinkName = plannerSchema[pcalName]?.type === "relation" ? pcalName : (plannerSchema[pcalName] ? cfgLinkProp : pcalName);

      await notion.databases.update({
        database_id: b.plannerDbId,
        properties: { [newLinkName]: { relation: { database_id: parentDbId, type: "dual_property", dual_property: {} } } } as never,
      });
      linkProp = newLinkName;

      // 프젝칼 쪽에 자동 생성된 동기화 관계형의 이름을 플래너 DB 이름으로 변경
      try {
        const pcalAfter = await notion.databases.retrieve({ database_id: parentDbId });
        const pcalProps = pcalAfter.properties as Record<string, { type: string; relation?: { database_id?: string } }>;
        if (!pcalProps[plannerName]) {
          for (const [name, p] of Object.entries(pcalProps)) {
            if (p.type === "relation" && p.relation?.database_id === b.plannerDbId) {
              await notion.databases.update({
                database_id: parentDbId,
                properties: { [name]: { name: plannerName } } as never,
              });
              break;
            }
          }
        }
      } catch { /* 동기화 속성 이름 변경 실패는 치명적이지 않음 */ }
    }

    // 날짜 값 빌더 (하위별 날짜가 있으면 그걸로, 없으면 상위 날짜)
    const mkDate = (start?: string | null, end?: string | null) =>
      start ? { date: { start, end: end && end !== start ? end : null } } : datePropValue;

    // 플래너 페이지 1개 생성 헬퍼
    const createPlannerPage = async (title: string, linkIds: string[], dateOverride?: { date: { start: string; end: string | null } } | null) => {
      const dv = dateOverride !== undefined ? dateOverride : datePropValue;
      const properties: Record<string, unknown> = {
        [plannerTitleProp]: { title: [{ text: { content: title } }] },
        [linkProp!]: { relation: linkIds.map((id) => ({ id })) },
      };
      if (dv && plannerDateProp) properties[plannerDateProp] = dv;
      if (bookIds.length > 0 && plannerBookProp) properties[plannerBookProp] = { relation: bookIds.map((id) => ({ id })) };
      const page = await notion.pages.create({ parent: { database_id: b.plannerDbId }, properties: properties as never });
      return (page as { id: string }).id;
    };

    // 프젝칼 네이티브 하위 항목 1개 생성 헬퍼
    const createSubItem = async (title: string, dateOverride?: { date: { start: string; end: string | null } } | null): Promise<string> => {
      const dv = dateOverride !== undefined ? dateOverride : datePropValue;
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
      if (dv && b.dateProperty) properties[b.dateProperty] = dv;
      if (bookIds.length > 0) properties[bookPropSrc] = { relation: bookIds.map((id) => ({ id })) };
      const page = await notion.pages.create({ parent: { database_id: parentDbId! }, properties: properties as never });
      return (page as { id: string }).id;
    };

    // 하위 항목 목록: subItems(제목+날짜) 우선, 없으면 subTitles
    const subItems = (b.subItems && b.subItems.length > 0)
      ? b.subItems.map((s) => ({ title: (s.title ?? "").trim(), dv: mkDate(s.start, s.end) })).filter((s) => s.title)
      : (b.subTitles ?? []).map((t) => t.trim()).filter(Boolean).map((title) => ({ title, dv: datePropValue }));
    const titles = subItems.map((s) => s.title);
    const created: { plannerId: string; subItemId?: string }[] = [];

    const withStep = async <T>(step: string, fn: () => Promise<T>): Promise<T> => {
      try { return await fn(); }
      catch (e) {
        const m = e instanceof Error ? e.message : String(e);
        throw new Error(`[${step}] ${m}`);
      }
    };

    // 기존 플래너 항목을 상위에 직접 연결 (현재 관계형에 상위 id 추가)
    const existingIds = [...new Set((b.existingPlannerIds ?? []).filter(Boolean))];
    for (const pid of existingIds) {
      await withStep("기존 항목 연결", async () => {
        const page = await notion.pages.retrieve({ page_id: pid });
        const cur = isFullPage(page)
          ? ((page.properties as PropMap)[linkProp!]?.relation ?? []).map((r) => r.id)
          : [];
        const next = cur.includes(b.parentPageId) ? cur : [...cur, b.parentPageId];
        await notion.pages.update({ page_id: pid, properties: { [linkProp!]: { relation: next.map((id) => ({ id })) } } as never });
      });
      created.push({ plannerId: pid });
    }

    if (titles.length === 0 && existingIds.length === 0) {
      // 입력도 선택도 없으면 상위 제목 그대로 플래너 1개
      const plannerId = await withStep("플래너 페이지 생성", () => createPlannerPage(parentTitle, [b.parentPageId]));
      created.push({ plannerId });
    } else {
      for (const s of subItems) {
        const subItemId = await withStep("하위 항목 생성", () => createSubItem(s.title, s.dv));
        const plannerId = await withStep("플래너 페이지 생성", () => createPlannerPage(s.title, [b.parentPageId, subItemId], s.dv));
        created.push({ plannerId, subItemId });
      }
    }

    return NextResponse.json({ success: true, created });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
