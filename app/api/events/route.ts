import { NextRequest, NextResponse } from "next/server";
import { Client, isFullPage } from "@notionhq/client";

interface EventConfig {
  token: string;
  dbId: string;
  dateProp: string;
  titleProp: string;
  groupProp?: string;
}

type RollupValue =
  | { type: "number"; number: number | null }
  | { type: "date"; date: { start?: string } | null }
  | { type: "array"; array: Array<{ type: string; select?: { name?: string }; multi_select?: Array<{ name?: string }>; rich_text?: Array<{ plain_text?: string }> }> }
  | { type: "incomplete" | "unsupported" };

type PropMap = Record<string, {
  type: string;
  date?: { start?: string; end?: string | null };
  title?: Array<{ plain_text?: string }>;
  rich_text?: Array<{ plain_text?: string }>;
  select?: { name?: string };
  multi_select?: Array<{ name?: string }>;
  formula?: { string?: string };
  rollup?: RollupValue;
  relation?: Array<{ id: string }>;
}>;

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
      pageUrl: string; group?: string; relationIds?: string[];
    };

    const rawEvents: RawEvent[] = [];

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

      rawEvents.push({
        id: page.id, title, startDate: eventStart, endDate: eventEnd,
        pageUrl: (page as { url?: string }).url ?? "#",
        ...(group ? { group } : {}),
        ...(relationIds ? { relationIds } : {}),
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

    return NextResponse.json({ success: true, data: events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
