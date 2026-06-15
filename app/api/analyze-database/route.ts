import { NextRequest, NextResponse } from "next/server";
import { Client } from "@notionhq/client";

export async function POST(req: NextRequest) {
  try {
    const { apiKey, databaseId, groupProperty } = await req.json();
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

    const groupableTypes = ["select", "multi_select", "status", "rich_text", "formula", "title", "rollup", "relation"];
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
      } else if (prop.type === "status") {
        const opts = (tp.status as { options?: { name: string }[] })?.options;
        if (opts) selectOptions[name] = opts.map((o) => o.name);
      }
    }

    // If a groupProperty is provided and not already in selectOptions, fetch unique values from pages
    if (groupProperty && !selectOptions[groupProperty] && props[groupProperty]) {
      try {
        const pages = await notion.databases.query({ database_id: databaseId, page_size: 100 });
        const valSet = new Set<string>();
        const propType = props[groupProperty].type;
        for (const page of pages.results) {
          const pageProps = (page as { properties: Record<string, unknown> }).properties;
          const p = pageProps[groupProperty] as Record<string, unknown> | undefined;
          if (!p) continue;
          let val = "";
          if (propType === "rich_text") {
            const rt = p.rich_text as { plain_text?: string }[] | undefined;
            val = rt?.[0]?.plain_text ?? "";
          } else if (propType === "title") {
            const t = p.title as { plain_text?: string }[] | undefined;
            val = t?.[0]?.plain_text ?? "";
          } else if (propType === "formula") {
            const f = p.formula as { type?: string; string?: string; number?: number } | undefined;
            val = String(f?.string ?? f?.number ?? "");
          } else if (propType === "rollup") {
            type RollupItem = { type?: string; title?: { plain_text?: string }[]; rich_text?: { plain_text?: string }[]; select?: { name?: string }; multi_select?: { name?: string }[]; number?: number };
            const r = p.rollup as { type?: string; number?: number; array?: RollupItem[] } | undefined;
            if (r?.type === "number" && r.number != null) {
              val = String(r.number);
            } else if (r?.type === "array") {
              for (const item of r.array ?? []) {
                let itemVal = "";
                if (item.type === "select") itemVal = item.select?.name ?? "";
                else if (item.type === "multi_select") itemVal = item.multi_select?.map((s) => s.name).filter(Boolean).join(", ") ?? "";
                else if (item.type === "title") itemVal = item.title?.[0]?.plain_text ?? "";
                else if (item.type === "rich_text") itemVal = item.rich_text?.[0]?.plain_text ?? "";
                else if (item.type === "number" && item.number != null) itemVal = String(item.number);
                if (itemVal.trim()) { val = itemVal.trim(); break; }
              }
            }
          }
          if (val.trim()) valSet.add(val.trim());
        }
        if (valSet.size > 0) selectOptions[groupProperty] = [...valSet];
      } catch { /* silent — don't fail the whole request */ }
    }

    return NextResponse.json({ success: true, data: { dateProperty, titleProperty, dateProperties, titleProperties, groupableProperties, selectOptions } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
