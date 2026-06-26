import { NextRequest, NextResponse } from "next/server";
import { Client, isFullPage } from "@notionhq/client";

interface EventConfig {
  token: string;
  dbId: string;
  dateProp: string;
  titleProp: string;
  groupProp?: string;
  // Notion 관계형 "선행 작업"(predecessor) 속성 이름
  dependsProp?: string;
  // 강조(체크박스) 속성 — 체크되면 테두리 표시
  highlightProp?: string;
  // 행 위치(선택) 속성 — 줄 위치 저장/복원
  rowProp?: string;
  // 완료(줄긋기) 속성 — 연결된 플래너 항목이 모두 완료되면 줄긋기. 롤업/수식/체크박스 지원
  doneProp?: string;
  // 플래너 DB id — 이 DB로 연결된 관계형에 항목이 있으면 "이미 보냄(sent)"으로 표시
  plannerDbId?: string;
}

type RollupValue =
  | { type: "number"; number: number | null }
  | { type: "date"; date: { start?: string } | null }
  | { type: "array"; array: Array<{ type: string; select?: { name?: string }; multi_select?: Array<{ name?: string }>; rich_text?: Array<{ plain_text?: string }>; checkbox?: boolean }> }
  | { type: "incomplete" | "unsupported" };

type PropMap = Record<string, {
  type: string;
  date?: { start?: string; end?: string | null };
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string };
  multi_select?: Array<{ name?: string }>;
  formula?: { type?: string; string?: string; boolean?: boolean; number?: number };
  rollup?: RollupValue;
  relation?: Array<{ id: string }>;
  checkbox?: boolean;
}>;

// 완료(줄긋기) 판정: 체크박스/수식(boolean·문자열·숫자)/롤업(퍼센트·체크박스 배열) 지원.
// "연결된 항목이 하나라도 있고 전부 완료"일 때만 true (빈 관계형은 줄긋기 안 함).
function computeDone(prop: PropMap[string] | undefined): boolean {
  if (!prop) return false;
  if (prop.type === "checkbox") return !!prop.checkbox;
  if (prop.type === "formula" && prop.formula) {
    const f = prop.formula;
    if (typeof f.boolean === "boolean") return f.boolean;
    if (typeof f.number === "number") return f.number >= 1;
    if (typeof f.string === "string") {
      const s = f.string.trim().toLowerCase();
      if (s === "") return false;
      if (["true", "완료", "done", "yes", "✓", "✅", "100%", "o"].includes(s)) return true;
      const pct = parseFloat(s.replace("%", ""));
      if (!Number.isNaN(pct)) return pct >= 100;
      return false;
    }
    return false;
  }
  if (prop.type === "rollup" && prop.rollup) {
    const r = prop.rollup;
    if (r.type === "number") return r.number != null && r.number >= 1; // 퍼센트(체크 100%→1.0) 또는 카운트
    if (r.type === "array") {
      const checks = r.array.filter((it) => it.type === "checkbox");
      if (checks.length === 0) return false;
      return checks.every((it) => it.checkbox === true);
    }
    return false;
  }
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const { config, startDate, endDate }: { config: EventConfig; startDate: string; endDate: string } = await req.json();
    if (!config?.token || !config?.dbId) {
      return NextResponse.json({ success: false, error: { message: "설정이 올바르지 않습니다." } }, { status: 400 });
    }

    const notion = new Client({ auth: config.token });

    const response = await notion.databases.query({
      database_id: config.dbId,
      filter: {
        property: config.dateProp,
        date: { on_or_after: startDate },
      },
      page_size: 100,
    });

    // 1차: 각 페이지의 기본 데이터와 관계형 ID 수집
    type RawEvent = {
      id: string; title: string; startDate: string; endDate: string;
      pageUrl: string; group?: string; relationIds?: string[]; dependsOn?: string[];
      highlighted?: boolean; rowPos?: number; done?: boolean; sent?: boolean;
    };

    const rawEvents: RawEvent[] = [];

    // "이미 보냄" 판정용: 프젝칼 DB에서 플래너 DB를 가리키는 관계형 속성 이름 탐지
    let plannerLinkBackProp: string | undefined;
    if (config.plannerDbId) {
      try {
        const db = await notion.databases.retrieve({ database_id: config.dbId });
        const props = db.properties as Record<string, { type: string; relation?: { database_id?: string } }>;
        for (const [name, p] of Object.entries(props)) {
          if (p.type === "relation" && p.relation?.database_id === config.plannerDbId) { plannerLinkBackProp = name; break; }
        }
      } catch { /* 무시 — sent 미표시 */ }
    }

    // 의존성(선행 작업) 속성 결정: 명시 설정이 없으면 노션이 의존성 기능을 켤 때
    // 자동 생성하는 "선행 작업"(predecessor) 관계형을 이름으로 자동 탐지한다.
    // (이미 받아온 페이지 속성에서 찾으므로 추가 API 호출 없음)
    let dependsProp = config.dependsProp;
    if (!dependsProp) {
      const predKeys = ["선행", "종속", "이전", "blocked by", "blocked_by", "blocked", "depends", "dependency", "dependencies", "predecessor"];
      const firstFull = response.results.find(isFullPage);
      if (firstFull) {
        const props = firstFull.properties as PropMap;
        for (const [name, prop] of Object.entries(props)) {
          if (prop.type === "relation" && predKeys.some((k) => name.toLowerCase().includes(k))) {
            dependsProp = name;
            break;
          }
        }
      }
    }

    for (const page of response.results.filter(isFullPage)) {
      const props = page.properties as PropMap;

      const titleProp = props[config.titleProp];
      let title = "Untitled";
      if (titleProp?.type === "title" && titleProp.title) {
        title = titleProp.title.map((t) => t.plain_text ?? "").join("") || "Untitled";
      } else {
        for (const prop of Object.values(props)) {
          if (prop.type === "title" && prop.title) {
            title = prop.title.map((t) => t.plain_text ?? "").join("") || "Untitled";
            break;
          }
        }
      }

      const dateProp = props[config.dateProp];
      if (!dateProp?.date?.start) continue;

      const eventStart = dateProp.date.start.slice(0, 10);
      const eventEnd = (dateProp.date.end ?? dateProp.date.start).slice(0, 10);
      if (eventEnd < startDate || eventStart > endDate) continue;

      let group: string | undefined;
      let relationIds: string[] | undefined;

      if (config.groupProp) {
        const gp = props[config.groupProp];
        if (gp?.type === "select") group = gp.select?.name;
        else if (gp?.type === "multi_select") group = gp.multi_select?.[0]?.name;
        else if (gp?.type === "rich_text") group = gp.rich_text?.map((t) => t.plain_text ?? "").join("") || undefined;
        else if (gp?.type === "title") group = gp.title?.map((t) => t.plain_text ?? "").join("") || undefined;
        else if (gp?.type === "formula") group = gp.formula?.string || undefined;
        else if (gp?.type === "rollup" && gp.rollup) {
          const r = gp.rollup;
          if (r.type === "number" && r.number != null) group = String(r.number);
          else if (r.type === "array" && r.array?.length > 0) {
            const first = r.array[0];
            if (first.type === "select") group = first.select?.name;
            else if (first.type === "multi_select") group = first.multi_select?.[0]?.name;
            else if (first.type === "rich_text") group = first.rich_text?.map((t) => t.plain_text ?? "").join("") || undefined;
          }
        } else if (gp?.type === "relation" && gp.relation && gp.relation.length > 0) {
          relationIds = gp.relation.map((r) => r.id);
        }
      }

      // 선행 작업(predecessor) 관계형 ID 수집 — 같은 DB 내 자기참조 관계
      let dependsOn: string[] | undefined;
      if (dependsProp) {
        const dp = props[dependsProp];
        if (dp?.type === "relation" && dp.relation && dp.relation.length > 0) {
          dependsOn = dp.relation.map((r) => r.id);
        }
      }

      // 강조(체크박스) 속성
      let highlighted: boolean | undefined;
      if (config.highlightProp) {
        const hp = props[config.highlightProp];
        if (hp?.type === "checkbox") highlighted = !!hp.checkbox;
      }

      // 행 위치(선택) 속성 → 숫자
      let rowPos: number | undefined;
      if (config.rowProp) {
        const rp = props[config.rowProp];
        let raw: string | undefined;
        if (rp?.type === "select") raw = rp.select?.name;
        else if (rp?.type === "rich_text") raw = rp.rich_text?.map((t) => t.plain_text ?? "").join("");
        if (raw != null && raw !== "") {
          const n = parseInt(raw, 10);
          if (!Number.isNaN(n) && n >= 0) rowPos = n;
        }
      }

      // 완료(줄긋기) 속성 — 연결된 플래너 항목이 모두 완료되면 true
      let done: boolean | undefined;
      if (config.doneProp) done = computeDone(props[config.doneProp]);

      // 이미 플래너로 보냄 — 연결 관계형에 항목이 1개 이상
      let sent: boolean | undefined;
      if (plannerLinkBackProp) {
        const lp = props[plannerLinkBackProp];
        sent = lp?.type === "relation" && (lp.relation?.length ?? 0) > 0;
      }

      rawEvents.push({
        id: page.id, title, startDate: eventStart, endDate: eventEnd,
        pageUrl: (page as { url?: string }).url ?? "#",
        ...(group ? { group } : {}),
        ...(relationIds ? { relationIds } : {}),
        ...(dependsOn ? { dependsOn } : {}),
        ...(highlighted ? { highlighted } : {}),
        ...(rowPos != null ? { rowPos } : {}),
        ...(done ? { done } : {}),
        ...(sent ? { sent } : {}),
      });
    }

    // 2차: 관계형 속성이 있는 경우 관련 페이지 제목 일괄 조회
    const allRelationIds = [...new Set(rawEvents.flatMap((e) => e.relationIds ?? []))];
    const relationTitleMap = new Map<string, string>();

    if (allRelationIds.length > 0) {
      const fetched = await Promise.allSettled(
        allRelationIds.map((id) => notion.pages.retrieve({ page_id: id }))
      );
      for (let i = 0; i < allRelationIds.length; i++) {
        const result = fetched[i];
        if (result.status === "fulfilled" && isFullPage(result.value)) {
          const relProps = result.value.properties as PropMap;
          for (const prop of Object.values(relProps)) {
            if (prop.type === "title" && prop.title) {
              const name = prop.title.map((t) => t.plain_text ?? "").join("").trim();
              if (name) { relationTitleMap.set(allRelationIds[i], name); break; }
            }
          }
        }
      }
    }

    const events = rawEvents.map(({ relationIds, ...ev }) => {
      if (relationIds && relationIds.length > 0) {
        const names = relationIds.map((id) => relationTitleMap.get(id)).filter(Boolean);
        return { ...ev, ...(names.length > 0 ? { group: names.join(", ") } : {}) };
      }
      return ev;
    });

    return NextResponse.json({ success: true, data: events, dependsProp: dependsProp ?? null });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
