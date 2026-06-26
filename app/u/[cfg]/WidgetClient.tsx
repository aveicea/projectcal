"use client";

import { useState } from "react";
import CalendarWidget from "@/components/CalendarWidget";
import { DEFAULT_BAR_COLORS } from "@/lib/calendarUtils";

interface Config {
  id: string;
  notionConfig: {
    apiKey: string;
    databaseId: string;
    dateProperty: string;
    titleProperty: string;
    groupProperty?: string;
    dependencyProperty?: string;
    highlightProperty?: string;
    highlightBorderColor?: string;
    rowProperty?: string;
    doneProperty?: string;
    plannerDbId?: string;
    plannerToken?: string;
    plannerTitleProp?: string;
    plannerDateProp?: string;
    plannerBookProp?: string;
    plannerLinkProp?: string;
    parentRelProp?: string;
    bookProperty?: string;
  };
  theme: {
    primaryColor: string;
    backgroundColor: string;
    backgroundOpacity: number;
    fontFamily: string;
    barColors: string[];
    labelColor: string;
    multiRow: boolean;
    darkMode: boolean;
    weekView?: boolean;
  };
  gcalCalendarIds?: string[];
  gcalSyncCalId?: string;
  gcalToken?: string;
  gcalRefreshToken?: string;
  gcalShowTimed?: boolean;
  gcalCalColors?: Record<string, string>;
  gcalBorderColors?: Record<string, string>;
  groupColors?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

function decodeWidgetConfig(cfg: string): { config: Config; barColors: string[] } {
  let base64 = cfg.replace(/-/g, "+").replace(/_/g, "/");
  while (base64.length % 4) base64 += "=";
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  const json = JSON.parse(new TextDecoder().decode(bytes));

  const barColors = Array.isArray(json.barColors) ? json.barColors : DEFAULT_BAR_COLORS;
  return {
    barColors,
    config: {
      id: "embedded",
      notionConfig: {
        apiKey: json.token ?? "",
        databaseId: json.dbId ?? "",
        dateProperty: json.dateProp ?? "날짜",
        titleProperty: json.titleProp ?? "제목",
        groupProperty: json.groupProp || undefined,
        dependencyProperty: json.dependsProp || undefined,
        highlightProperty: json.highlightProp || undefined,
        highlightBorderColor: json.highlightBorderColor || undefined,
        rowProperty: json.rowProp || undefined,
        doneProperty: json.doneProp || undefined,
        plannerDbId: json.plannerDbId || undefined,
        plannerToken: json.plannerToken || undefined,
        plannerTitleProp: json.plannerTitleProp || undefined,
        plannerDateProp: json.plannerDateProp || undefined,
        plannerBookProp: json.plannerBookProp || undefined,
        plannerLinkProp: json.plannerLinkProp || undefined,
        parentRelProp: json.parentRelProp || undefined,
        bookProperty: json.bookProp || undefined,
      },
      theme: {
        primaryColor: json.primaryColor ?? "#E8A8C0",
        backgroundColor: json.backgroundColor ?? "#FFFFFF",
        backgroundOpacity: json.backgroundOpacity ?? 100,
        fontFamily: json.fontFamily ?? "Pretendard",
        barColors,
        labelColor: json.labelColor ?? "#444444",
        multiRow: json.multiRow ?? false,
        darkMode: json.darkMode ?? false,
        weekView: json.weekView ?? false,
      },
      gcalCalendarIds: Array.isArray(json.gcalCalIds) ? json.gcalCalIds as string[] : undefined,
      gcalSyncCalId: json.gcalSyncCalId || undefined,
      gcalToken: json.gcalToken || undefined,
      gcalRefreshToken: json.gcalRefreshToken || undefined,
      gcalShowTimed: json.gcalShowTimed ?? false,
      gcalCalColors: json.gcalCalColors && typeof json.gcalCalColors === "object" ? json.gcalCalColors as Record<string, string> : undefined,
      gcalBorderColors: json.gcalBorderColors && typeof json.gcalBorderColors === "object" ? json.gcalBorderColors as Record<string, string> : undefined,
      groupColors: json.groupColors && typeof json.groupColors === "object" ? json.groupColors as Record<string, string> : undefined,
      createdAt: "",
      updatedAt: "",
    },
  };
}

export default function WidgetClient({ cfg }: { cfg: string }) {
  const [initState] = useState<{ config: Config | null; error: string | null; barColors: string[] }>(() => {
    try {
      const { config, barColors } = decodeWidgetConfig(cfg);
      return { config, error: null, barColors };
    } catch (e) {
      return { config: null, error: e instanceof Error ? e.message : String(e), barColors: DEFAULT_BAR_COLORS };
    }
  });

  const { config, error, barColors } = initState;
  const darkMode = config?.theme.darkMode ?? false;

  if (error) {
    return (
      <div style={{ width: "100%", height: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", color: "#e53e3e", fontFamily: "monospace" }}>
          <h2>위젯 설정 오류</h2>
          <pre style={{ fontSize: 12, background: "#fff5f5", padding: 12, borderRadius: 8 }}>{error}</pre>
        </div>
      </div>
    );
  }

  if (!config) return null;

  return (
    <>
      <style suppressHydrationWarning>{`
        html, body {
          background: ${darkMode ? "#191919" : "transparent"} !important;
          background-color: ${darkMode ? "#191919" : "transparent"} !important;
          margin: 0 !important; padding: 0 !important;
        }
        body {
          padding-top: 20px !important;
          display: flex; justify-content: center;
          align-items: flex-start; min-height: 100vh;
        }
      `}</style>
      <CalendarWidget
        configId="embedded"
        config={config}
        theme={{ ...config.theme, barColors }}
        fontFamily={config.theme.fontFamily}
        initialGcalCalendarIds={config.gcalCalendarIds}
        gcalSyncCalId={config.gcalSyncCalId}
        initialGcalToken={config.gcalToken}
        initialGcalRefreshToken={config.gcalRefreshToken}
        initialGcalShowTimed={config.gcalShowTimed}
        initialGcalColorOverrides={config.gcalCalColors}
        initialGcalBorderColorOverrides={config.gcalBorderColors}
        initialGroupColors={config.groupColors}
        widgetConfigStr={cfg}
      />
    </>
  );
}
