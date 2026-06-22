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

    // 강조용 체크박스 속성, 행 위치용 선택 속성(또는 텍스트)
    const checkboxProperties = Object.entries(props)
      .filter(([, p]) => p.type === "checkbox")
      .map(([name]) => name);
    const rowProperties = Object.entries(props)
      .filter(([, p]) => p.type === "select" || p.type === "rich_text")
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

    // Mapping from display title → Notion page ID for relation properties
    const relationOptionIds: Record<string, Record<string, string>> = {};
    // For rollup group properties: maps groupProperty name → underlying relation property name
    const rollupRelationProps: Record<string, string> = {};

    // Helper: fetch linked DB pages and build title→pageId map
    const fetchLinkedDbTitles = async (linkedDbId: string): Promise<Record<string, string>> => {
      const linked = await notion.databases.query({ database_id: linkedDbId, page_size: 100 });
      const titleMap: Record<string, string> = {};
      for (const page of linked.results) {
        if (!("properties" in page)) continue;
        const pp = (page as { id: string; properties: Record<string, unknown> });
        for (const pv of Object.values(pp.properties)) {
          const pvc = pv as { type?: string; title?: { plain_text?: string }[] };
          if (pvc.type === "title" && pvc.title) {
            const name = pvc.title.map((t) => t.plain_text ?? "").join("").trim();
            if (name) { titleMap[name] = pp.id; break; }
          }
        }
      }
      return titleMap;
    };

    // If a groupProperty is provided and not already in selectOptions, fetch unique values from pages
    if (groupProperty && !selectOptions[groupProperty] && props[groupProperty]) {
      try {
        const propType = props[groupProperty].type;

        if (propType === "relation") {
          // For relation props, query the linked database to get target page titles
          const relProp = props[groupProperty] as Record<string, unknown>;
          const linkedDbId = (relProp.relation as { database_id?: string })?.database_id;
          if (linkedDbId) {
            const titleMap = await fetchLinkedDbTitles(linkedDbId);
            if (Object.keys(titleMap).length > 0) {
              selectOptions[groupProperty] = Object.keys(titleMap);
              relationOptionIds[groupProperty] = titleMap;
            }
          }
        } else if (propType === "rollup") {
          // Extract relation_property_name from rollup schema
          const rollupProp = props[groupProperty] as Record<string, unknown>;
          const rollupMeta = rollupProp.rollup as { relation_property_name?: string } | undefined;
          const relPropName = rollupMeta?.relation_property_name;

          if (relPropName) {
            // Record the underlying relation property name immediately
            rollupRelationProps[groupProperty] = relPropName;

            // Build title→pageId from current DB pages (no linked DB access needed)
            type RollupItem = { type?: string; title?: { plain_text?: string }[]; rich_text?: { plain_text?: string }[]; select?: { name?: string }; multi_select?: { name?: string }[]; number?: number };
            const pages = await notion.databases.query({ database_id: databaseId, page_size: 100 });
            const titleMap: Record<string, string> = {};
            const titleSet = new Set<string>();
            for (const page of pages.results) {
              const pageProps = (page as { properties: Record<string, unknown> }).properties;
              const rollupPageProp = pageProps[groupProperty] as Record<string, unknown> | undefined;
              const relPageProp = pageProps[relPropName] as Record<string, unknown> | undefined;

              // Extract rollup display value
              let displayVal = "";
              if (rollupPageProp) {
                const r = rollupPageProp.rollup as { type?: string; number?: number; array?: RollupItem[] } | undefined;
                if (r?.type === "number" && r.number != null) {
                  displayVal = String(r.number);
                } else if (r?.type === "array") {
                  for (const item of r.array ?? []) {
                    let itemVal = "";
                    if (item.type === "title") itemVal = item.title?.[0]?.plain_text ?? "";
                    else if (item.type === "rich_text") itemVal = item.rich_text?.[0]?.plain_text ?? "";
                    else if (item.type === "select") itemVal = item.select?.name ?? "";
                    else if (item.type === "multi_select") itemVal = item.multi_select?.map((s) => s.name).filter(Boolean).join(", ") ?? "";
                    else if (item.type === "number" && item.number != null) itemVal = String(item.number);
                    if (itemVal.trim()) { displayVal = itemVal.trim(); break; }
                  }
                }
              }

              if (displayVal) {
                titleSet.add(displayVal);
                // Map to relation page ID if relation property is present
                const rels = relPageProp?.relation as { id: string }[] | undefined;
                if (rels?.[0]?.id && !titleMap[displayVal]) {
                  titleMap[displayVal] = rels[0].id;
                }
              }
            }

            if (Object.keys(titleMap).length > 0) {
              selectOptions[groupProperty] = Object.keys(titleMap);
              relationOptionIds[groupProperty] = titleMap;
            } else if (titleSet.size > 0) {
              // No pageIds found but we have display values
              selectOptions[groupProperty] = [...titleSet];
            }
          } else {
            // No relation_property_name in schema — collect unique rollup display values
            type RollupItem = { type?: string; title?: { plain_text?: string }[]; rich_text?: { plain_text?: string }[]; select?: { name?: string }; multi_select?: { name?: string }[]; number?: number };
            const pages = await notion.databases.query({ database_id: databaseId, page_size: 100 });
            const valSet = new Set<string>();
            for (const page of pages.results) {
              const pageProps = (page as { properties: Record<string, unknown> }).properties;
              const p = pageProps[groupProperty] as Record<string, unknown> | undefined;
              if (!p) continue;
              const r = p.rollup as { type?: string; number?: number; array?: RollupItem[] } | undefined;
              let val = "";
              if (r?.type === "number" && r.number != null) val = String(r.number);
              else if (r?.type === "array") {
                for (const item of r.array ?? []) {
                  let itemVal = "";
                  if (item.type === "title") itemVal = item.title?.[0]?.plain_text ?? "";
                  else if (item.type === "rich_text") itemVal = item.rich_text?.[0]?.plain_text ?? "";
                  else if (item.type === "select") itemVal = item.select?.name ?? "";
                  else if (item.type === "multi_select") itemVal = item.multi_select?.map((s) => s.name).filter(Boolean).join(", ") ?? "";
                  else if (item.type === "number" && item.number != null) itemVal = String(item.number);
                  if (itemVal.trim()) { val = itemVal.trim(); break; }
                }
              }
              if (val.trim()) valSet.add(val.trim());
            }
            if (valSet.size > 0) selectOptions[groupProperty] = [...valSet];
          }
        } else {
          const pages = await notion.databases.query({ database_id: databaseId, page_size: 100 });
          const valSet = new Set<string>();
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
            }
            if (val.trim()) valSet.add(val.trim());
          }
          if (valSet.size > 0) selectOptions[groupProperty] = [...valSet];
        }
      } catch { /* silent — don't fail the whole request */ }
    }

    return NextResponse.json({ success: true, data: { dateProperty, titleProperty, dateProperties, titleProperties, groupableProperties, checkboxProperties, rowProperties, selectOptions, relationOptionIds, rollupRelationProps } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
    return NextResponse.json({ success: false, error: { message: msg } }, { status: 500 });
  }
}
