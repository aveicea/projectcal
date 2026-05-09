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

    const events = response.results
      .filter(isFullPage)
      .map((page) => {
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
        if (!dateProp?.date?.start) return null;

        const eventStart = dateProp.date.start.slice(0, 10);
        const eventEnd = (dateProp.date.end ?? dateProp.date.start).slice(0, 10);

        if (eventEnd < startDate || eventStart > endDate) return null;

        let group: string | undefined;
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
          } else if (gp?.type === "relation") {
            const rel = gp.relation;
            if (rel && rel.length > 0) group = `${rel.length}개 연결됨`;
          }
        }

        return {
          id: page.id,
          title,
          startDate: eventStart,
          endDate: eventEnd,
          pageUrl: (page as { url?: string }).url ?? "#",
          ...(group ? { group } : {}),
        };
      })
      .filter(Boolean);

    return NextResponse.json({ success: true, data: events });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
