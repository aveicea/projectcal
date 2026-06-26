"use client";

import React, { useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Link, Send } from "lucide-react";
import {
  Project,
  ProjectSegment,
  DEFAULT_BAR_COLORS,
  getDaysInMonth,
  getDaysInWeek,
  getWeekStart,
  assignRows,
  assignRowsWithDeps,
  assignColors,
  hexToRgba,
  lightenColor,
  hexToRgbaBackground,
  truncateTitle,
  getFontFamily,
  formatDate,
  addDays,
  daysBetween,
} from "@/lib/calendarUtils";
import { safeStorage } from "@/lib/safeStorage";

// ── GCal types ──────────────────────────────────────────────────────────────
interface GCalEventRaw {
  id: string;
  summary?: string;
  start: { date?: string; dateTime?: string };
  end: { date?: string; dateTime?: string };
  htmlLink?: string;
  extendedProperties?: { private?: { source?: string; notionId?: string } };
}

interface GCalCalendar {
  id: string;
  summary: string;
  backgroundColor?: string;
  primary?: boolean;
}

type AnySegment = ProjectSegment & {
  isGCal?: boolean;
  gcalLink?: string;
  gcalEventId?: string;
  gcalCalendarId?: string;
};

// ── Widget interfaces ───────────────────────────────────────────────────────
interface CalendarConfig {
  id: string;
  notionConfig: {
    apiKey: string;
    databaseId: string;
    dateProperty: string;
    titleProperty: string;
    groupProperty?: string;
    // 팝업에 표시할 분류(그룹 옵션) 화이트리스트. 비어있으면 전체 표시
    groupOptionFilter?: string[];
    dependencyProperty?: string;
    highlightProperty?: string;
    highlightBorderColor?: string;
    rowProperty?: string;
    // 완료(줄긋기) 속성 — 연결된 플래너 항목이 모두 완료되면 줄긋기
    doneProperty?: string;
    // 플래너 연결 (프젝칼 → 플래너 보내기)
    plannerDbId?: string;
    plannerToken?: string;       // 비우면 apiKey 공유
    plannerTitleProp?: string;   // 기본 범위
    plannerDateProp?: string;    // 기본 날짜
    plannerBookProp?: string;    // 기본 책
    plannerLinkProp?: string;    // 기본 PLANNER (플래너→프젝칼 관계형)
    parentRelProp?: string;      // 프젝칼 네이티브 상위 항목 관계형 (기본 "상위 항목")
    bookProperty?: string;       // 프젝칼 책 관계형 (기본 책)
  };
  theme: CalendarTheme;
}

interface CalendarTheme {
  primaryColor: string;
  backgroundColor: string;
  backgroundOpacity: number;
  barColors: string[];
  labelColor: string;
  multiRow: boolean;
  darkMode: boolean;
  weekView?: boolean;
}

interface CalendarWidgetProps {
  configId: string;
  config?: CalendarConfig;
  theme?: CalendarTheme;
  fontFamily?: string;
  previewProjects?: Project[];
  initialGcalCalendarIds?: string[];
  gcalSyncCalId?: string;
  initialGcalToken?: string;
  initialGcalRefreshToken?: string;
  initialGcalShowTimed?: boolean;
  initialGcalColorOverrides?: Record<string, string>;
  initialGcalBorderColorOverrides?: Record<string, string>;
  initialGroupColors?: Record<string, string>;
  widgetConfigStr?: string;
}

const DAY_WIDTH = 25;
const WEEK_DAY_WIDTH = 100;
const ROW_HEIGHT = 26;
const BAR_HEIGHT = 22;
const GCAL_DEFAULT_COLOR = "#4285F4";

export default function CalendarWidget({
  configId,
  config,
  theme,
  fontFamily = "Pretendard",
  previewProjects,
  initialGcalCalendarIds,
  gcalSyncCalId,
  initialGcalToken,
  initialGcalRefreshToken,
  initialGcalShowTimed,
  initialGcalColorOverrides,
  initialGcalBorderColorOverrides,
  initialGroupColors,
  widgetConfigStr,
}: CalendarWidgetProps) {
  // ssr:false로 로드되므로 현재 날짜로 즉시 초기화 → 첫 로딩에 "로딩 중" 대신 컨테이너 바로 표시
  const [centerYear, setCenterYear] = useState<number | null>(() => new Date().getFullYear());
  const [centerMonth, setCenterMonth] = useState<number | null>(() => new Date().getMonth());
  const [todayStr, setTodayStr] = useState<string>(() => new Date().toDateString());
  const [weekStartStr, setWeekStartStr] = useState<string>(() => formatDate(getWeekStart(new Date())));

  const [projects, setProjects] = useState<ProjectSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const hasLoadedOnce = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Map<string, number>>(new Map());
  const [dateOverrides, setDateOverrides] = useState<Map<string, { startDate: string; endDate: string }>>(new Map());
  const [dropDateStr, setDropDateStr] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: "", color: "" });
  const [createInput, setCreateInput] = useState<{ dateStr: string; title: string; row: number } | null>(null);
  const [creating, setCreating] = useState(false);
  const [dropOnHeader, setDropOnHeader] = useState(false);
  const [groupOptions, setGroupOptions] = useState<string[]>([]);
  const [groupPropType, setGroupPropType] = useState<string>("select");
  // 설정에서 지정한 화이트리스트가 있으면 그 항목만 팝업에 표시
  const groupFilter = config?.notionConfig.groupOptionFilter;
  const visibleGroupOptions = groupFilter && groupFilter.length > 0
    ? groupOptions.filter((o) => groupFilter.includes(o))
    : groupOptions;
  const [groupOptionIds, setGroupOptionIds] = useState<Record<string, string>>({});
  // For rollup group props: the underlying relation property name to actually write
  const [groupWriteProp, setGroupWriteProp] = useState<string>("");
  const [eventPopup, setEventPopup] = useState<{ id: string; group: string; left: number; right: number; top: number; bottom: number } | null>(null);
  const [editingTitle, setEditingTitle] = useState<{ id: string; value: string } | null>(null);
  // 플래너로 보내기 모달
  const [sendPopup, setSendPopup] = useState<{ id: string; title: string } | null>(null);
  const [sendText, setSendText] = useState("");
  const [sendState, setSendState] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [sendError, setSendError] = useState("");
  // 기존 플래너 항목 토글 선택
  const [plannerItems, setPlannerItems] = useState<{ id: string; title: string; done: boolean }[]>([]);
  const [plannerItemsLoading, setPlannerItemsLoading] = useState(false);
  const [selectedPlannerIds, setSelectedPlannerIds] = useState<Set<string>>(new Set());
  // 그룹 팝업: 위젯 본문 영역 안에서 항목 기준 세로 중앙 정렬 + 경계 클램프 (측정 기반)
  const popupRef = useRef<HTMLDivElement>(null);
  const [popupPos, setPopupPos] = useState<{ top: number; maxH: number } | null>(null);
  // 상위 항목 토글 → 펼치면 하위 항목이 그 아래에 막대로 표시됨
  const [expandedParents, setExpandedParents] = useState<Set<string>>(new Set());
  const bodyRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);

  // 그룹 팝업 세로 위치: 위젯 본문(헤더 아래 ~ 위젯 맨 밑) 영역 안에서 항목 중심으로 중앙 정렬,
  // 위(헤더)나 아래(푸터/맨밑) 공간이 부족하면 그 경계로 밀어 넣는다.
  useLayoutEffect(() => {
    if (!eventPopup) { setPopupPos(null); return; }
    if (!popupRef.current || !bodyRef.current || !widgetRef.current) return;
    const bodyR = bodyRef.current.getBoundingClientRect();
    const widget = widgetRef.current.getBoundingClientRect();
    const m = 6;
    // 상단: 헤더 아래(본문 top), 하단: 위젯의 보이는 맨 밑(컨테이너 bottom) — 본문은 내용이 길면
    // 컨테이너 밖까지 늘어나므로 bottom은 반드시 위젯 컨테이너 기준으로 클램프
    const boundTop = bodyR.top;
    const boundBottom = widget.bottom - m;
    const maxH = Math.max(120, boundBottom - boundTop);
    const natural = popupRef.current.scrollHeight;
    const h = Math.min(natural, maxH);
    const center = (eventPopup.top + eventPopup.bottom) / 2;
    let top = center - h / 2;
    if (top + h > boundBottom) top = boundBottom - h; // 밑 공간 부족 → 위로
    if (top < boundTop) top = boundTop;               // 헤더 공간 부족 → 아래로
    setPopupPos({ top, maxH });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventPopup]);
  // Pointer-based drag (works on mouse + touch). Replaces native HTML5 DnD.
  const pdrag = useRef<{
    mode: "move" | "resize-start" | "resize-end" | "link";
    segId: string;
    isGCal: boolean;
    grabDate: string;
    originStart: string;
    originEnd: string;
    fromEnd: boolean;
    startX: number;
    startY: number;
    active: boolean;
    curStart: string;
    curEnd: string;
    curRow: number;
  } | null>(null);
  const lastDragEnd = useRef(0);
  // 단일 클릭(그룹 팝업) vs 더블 클릭(제목 편집) 구분용 지연 타이머
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [linkTargetId, setLinkTargetId] = useState<string | null>(null);
  const [detectedDependsProp, setDetectedDependsProp] = useState<string>("");

  // ── GCal state ────────────────────────────────────────────────────────────
  const [gcalToken, setGcalToken] = useState<string | null>(null);
  const [gcalCalendars, setGcalCalendars] = useState<GCalCalendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [gcalProjects, setGcalProjects] = useState<AnySegment[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [showGCalPanel, setShowGCalPanel] = useState(false);
  const [syncingNotionId, setSyncingNotionId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
  // GCal → Notion 가져오기 진행 중인 이벤트 id
  const [importingId, setImportingId] = useState<string | null>(null);
  const [gcalUpdatingId, setGcalUpdatingId] = useState<string | null>(null);
  // Notion IDs that have a corresponding event in GCal → hide the Notion bar
  const [gcalSyncedNotionIds, setGcalSyncedNotionIds] = useState<Set<string>>(new Set());
  // Whether to include timed events (not just all-day events)
  const [gcalShowTimed, setGcalShowTimed] = useState(false);
  // Per-calendar color overrides (calId → hex fill, border)
  const [gcalColorOverrides, setGcalColorOverrides] = useState<Record<string, string>>({});
  const [gcalBorderColorOverrides, setGcalBorderColorOverrides] = useState<Record<string, string>>({});
  // Per-group Notion color overrides (groupValue → hex)
  const [groupColorOverrides, setGroupColorOverrides] = useState<Record<string, string>>({});
  // Custom calendar display order (calId[])
  const [gcalCalendarOrder, setGcalCalendarOrder] = useState<string[]>([]);
  const panelDragCalId = useRef<string | null>(null);

  const gcalRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gcalRefreshInFlight = useRef<Promise<string | null> | null>(null);
  // In-memory copies so Google auth survives even when localStorage is blocked
  // (iOS Safari third-party iframe / Notion embed). Seeded from the embed URL.
  const gcalRefreshTokenRef = useRef<string | null>(initialGcalRefreshToken ?? null);
  const gcalExpiryRef = useRef<number>(0);

  const saveGcalToken = (token: string, expiry: number) => {
    gcalExpiryRef.current = expiry;
    safeStorage.setItem("pcal_gcal_token", token);
    safeStorage.setItem("pcal_gcal_expiry", String(expiry));
    setGcalToken(token);
    if (gcalRefreshTimer.current) clearTimeout(gcalRefreshTimer.current);
    const refreshIn = expiry - Date.now() - 5 * 60 * 1000;
    if (refreshIn > 0) {
      gcalRefreshTimer.current = setTimeout(() => refreshGcalToken(), refreshIn);
    }
  };

  const refreshGcalToken = (): Promise<string | null> => {
    if (gcalRefreshInFlight.current) return gcalRefreshInFlight.current;
    const refreshToken = gcalRefreshTokenRef.current ?? safeStorage.getItem("pcal_gcal_refresh_token");
    if (!refreshToken) return Promise.resolve(null);
    gcalRefreshInFlight.current = (async () => {
      try {
        const res = await fetch("/api/gcal-refresh", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refresh_token: refreshToken }),
        });
        const data = await res.json();
        if (data.access_token) {
          const expiry = Date.now() + (data.expires_in ?? 3600) * 1000;
          saveGcalToken(data.access_token, expiry);
          return data.access_token as string;
        }
      } catch { /* silent */ } finally {
        gcalRefreshInFlight.current = null;
      }
      return null;
    })();
    return gcalRefreshInFlight.current;
  };

  // On mount: seed refresh token from embedded URL, then restore access token or auto-refresh
  useEffect(() => {
    if (typeof window === "undefined") return;

    if (initialGcalRefreshToken) {
      gcalRefreshTokenRef.current = initialGcalRefreshToken;
      safeStorage.setItem("pcal_gcal_refresh_token", initialGcalRefreshToken);
    }

    const storedToken = safeStorage.getItem("pcal_gcal_token");
    const storedExpiry = parseInt(safeStorage.getItem("pcal_gcal_expiry") ?? "0");
    const hasRefreshToken = !!(gcalRefreshTokenRef.current ?? safeStorage.getItem("pcal_gcal_refresh_token"));

    if (storedToken && Date.now() < storedExpiry - 60000) {
      // Valid cached token — use it and arm refresh timer
      setGcalToken(storedToken);
      if (gcalRefreshTimer.current) clearTimeout(gcalRefreshTimer.current);
      const refreshIn = storedExpiry - Date.now() - 5 * 60 * 1000;
      if (refreshIn > 0) gcalRefreshTimer.current = setTimeout(() => refreshGcalToken(), refreshIn);
    } else if (initialGcalToken) {
      // Fresh link with embedded access token — use immediately, auto-refresh via refresh token
      const expiry = Date.now() + 3540 * 1000;
      saveGcalToken(initialGcalToken, expiry);
    } else if (hasRefreshToken) {
      // No access token but have refresh token — get fresh one
      refreshGcalToken();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const synced = safeStorage.getItem("pcal_synced_ids");
    if (synced) {
      try { setSyncedIds(new Set(JSON.parse(synced))); } catch { /* ignore */ }
    }
    const showTimed = safeStorage.getItem("pcal_gcal_show_timed");
    if (showTimed === "true") setGcalShowTimed(true);
    else if (initialGcalShowTimed) setGcalShowTimed(true);

    const savedCalColors = safeStorage.getItem("pcal_gcal_colors");
    if (savedCalColors) {
      try { setGcalColorOverrides({ ...JSON.parse(savedCalColors), ...initialGcalColorOverrides }); } catch { if (initialGcalColorOverrides) setGcalColorOverrides(initialGcalColorOverrides); }
    } else if (initialGcalColorOverrides) {
      setGcalColorOverrides(initialGcalColorOverrides);
    }

    const savedBorderColors = safeStorage.getItem("pcal_gcal_border_colors");
    if (savedBorderColors) {
      try { setGcalBorderColorOverrides({ ...JSON.parse(savedBorderColors), ...initialGcalBorderColorOverrides }); } catch { if (initialGcalBorderColorOverrides) setGcalBorderColorOverrides(initialGcalBorderColorOverrides); }
    } else if (initialGcalBorderColorOverrides) {
      setGcalBorderColorOverrides(initialGcalBorderColorOverrides);
    }

    const savedGroupColors = safeStorage.getItem("pcal_group_colors");
    if (savedGroupColors) {
      try { setGroupColorOverrides({ ...JSON.parse(savedGroupColors), ...initialGroupColors }); } catch { if (initialGroupColors) setGroupColorOverrides(initialGroupColors); }
    } else if (initialGroupColors) {
      setGroupColorOverrides(initialGroupColors);
    }

    const savedCalOrder = safeStorage.getItem("pcal_gcal_order");
    if (savedCalOrder) {
      try { setGcalCalendarOrder(JSON.parse(savedCalOrder)); } catch { /* ignore */ }
    }

    const savedRowOverrides = safeStorage.getItem("pcal_row_overrides");
    if (savedRowOverrides) {
      try {
        const obj = JSON.parse(savedRowOverrides) as Record<string, number>;
        setRowOverrides(new Map(Object.entries(obj).map(([k, v]) => [k, v])));
      } catch { /* ignore */ }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch calendar list when token changes
  useEffect(() => {
    if (!gcalToken) {
      setGcalCalendars([]);
      setSelectedCalendarIds(new Set());
      setGcalProjects([]);
      return;
    }
    fetch(`/api/gcal?token=${encodeURIComponent(gcalToken)}&action=list`)
      .then((res) => {
        if (res.status === 401) throw new Error("401");
        return res.json();
      })
      .then((data) => {
        if (Array.isArray(data.items)) {
          const cals: GCalCalendar[] = data.items;
          setGcalCalendars(cals);
          const saved = safeStorage.getItem("pcal_gcal_selected");
          if (saved) {
            try {
              const savedIds = new Set<string>(JSON.parse(saved));
              // Only keep IDs that still exist
              const valid = new Set(cals.map((c) => c.id).filter((id) => savedIds.has(id)));
              setSelectedCalendarIds(valid.size > 0 ? valid : new Set(cals.map((c) => c.id)));
            } catch {
              setSelectedCalendarIds(new Set(cals.map((c) => c.id)));
            }
          } else if (initialGcalCalendarIds && initialGcalCalendarIds.length > 0) {
            const initial = new Set(cals.map((c) => c.id).filter((id) => initialGcalCalendarIds.includes(id)));
            setSelectedCalendarIds(initial.size > 0 ? initial : new Set(cals.map((c) => c.id)));
          } else {
            setSelectedCalendarIds(new Set(cals.map((c) => c.id)));
          }
        }
      })
      .catch(async (e: unknown) => {
        if ((e as Error).message === "401") {
          const newToken = await refreshGcalToken();
          if (!newToken) {
            setGcalToken(null);
            safeStorage.removeItem("pcal_gcal_token");
          }
        }
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gcalToken]);

  const primaryColor = theme?.primaryColor ?? "#E8A8C0";
  const backgroundOpacity = theme?.backgroundOpacity ?? 100;
  const rawBg = theme?.backgroundColor ?? "#FFFFFF";
  const barColors = theme?.barColors ?? DEFAULT_BAR_COLORS;
  const labelColor = theme?.labelColor ?? "#444444";
  const multiRow = theme?.multiRow ?? false;
  const darkMode = theme?.darkMode ?? false;
  const weekView = theme?.weekView ?? false;

  const bgColor = rawBg.startsWith("rgba") ? rawBg : hexToRgbaBackground(rawBg, backgroundOpacity);
  const headerBg = lightenColor(primaryColor, 0.85);
  const font = getFontFamily(fontFamily);

  const year = centerYear ?? new Date().getFullYear();
  const month = centerMonth ?? new Date().getMonth();

  const prevDays = getDaysInMonth(
    new Date(year, month - 1, 1).getFullYear(),
    new Date(year, month - 1, 1).getMonth()
  );
  const currDays = getDaysInMonth(year, month);
  const nextDays = getDaysInMonth(
    new Date(year, month + 1, 1).getFullYear(),
    new Date(year, month + 1, 1).getMonth()
  );
  const allDays = [...prevDays, ...currDays, ...nextDays];

  const weekStartDate = weekStartStr ? new Date(weekStartStr + "T00:00:00") : new Date();
  const prevWeekStart = new Date(weekStartDate); prevWeekStart.setDate(prevWeekStart.getDate() - 7);
  const nextWeekStart = new Date(weekStartDate); nextWeekStart.setDate(nextWeekStart.getDate() + 7);
  const prevWeekDays = weekView && weekStartStr ? getDaysInWeek(prevWeekStart) : [];
  const weekDays     = weekView && weekStartStr ? getDaysInWeek(weekStartDate) : [];
  const nextWeekDays = weekView && weekStartStr ? getDaysInWeek(nextWeekStart) : [];
  const allWeekDays  = [...prevWeekDays, ...weekDays, ...nextWeekDays];

  const dayWidth = weekView ? WEEK_DAY_WIDTH : DAY_WIDTH;
  const displayDays = weekView ? allWeekDays : allDays;

  const fetchStart = weekView && weekStartStr
    ? formatDate(new Date(prevWeekStart.getFullYear(), prevWeekStart.getMonth() - 1, 1))
    : formatDate(new Date(year, month - 1, 1));
  const fetchEnd = weekView && allWeekDays.length > 0
    ? allWeekDays[allWeekDays.length - 1].dateStr
    : formatDate(new Date(year, month + 2, 0));

  useEffect(() => { scrolledRef.current = false; }, [year, month, weekStartStr]);

  useEffect(() => {
    if (!loading && !scrolledRef.current && bodyRef.current) {
      const offset = weekView
        ? prevWeekDays.length * WEEK_DAY_WIDTH + 12
        : prevDays.length * DAY_WIDTH + 12;
      bodyRef.current.scrollLeft = offset;
      scrolledRef.current = true;
    }
  }, [loading, prevDays.length, prevWeekDays.length, weekView]);

  // ── Fetch GCal events whenever selection/dates change ────────────────────
  useEffect(() => {
    if (!gcalToken || selectedCalendarIds.size === 0 || gcalCalendars.length === 0) {
      setGcalProjects([]);
      return;
    }

    let cancelled = false;
    setGcalLoading(true);

    const calIds = [...selectedCalendarIds];
    const colorMap = new Map(gcalCalendars.map((c) => [c.id, gcalColorOverrides[c.id] || c.backgroundColor || GCAL_DEFAULT_COLOR]));

    Promise.all(
      calIds.map(async (calId) => {
        const params = new URLSearchParams({
          token: gcalToken,
          calendarId: calId,
          timeMin: `${fetchStart}T00:00:00Z`,
          timeMax: `${fetchEnd}T23:59:59Z`,
        });
        const res = await fetch(`/api/gcal?${params}`);
        if (res.status === 401) throw new Error("401");
        const data = await res.json();
        return { calId, data };
      })
    )
      .then((results) => {
        if (cancelled) return;
        const events: AnySegment[] = results.flatMap(({ calId, data }) => {
          if (!Array.isArray(data.items)) return [];
          const calColor = colorMap.get(calId) || GCAL_DEFAULT_COLOR;
          return (data.items as GCalEventRaw[])
            .filter((e) => {
              if (!e.start.date && !e.start.dateTime) return false;
              // Timed events (not all-day) — only include if user opted in
              if (!gcalShowTimed && e.start.dateTime) return false;
              return true;
            })
            .map((e) => {
              const startDate = e.start.date || e.start.dateTime!.slice(0, 10);
              let endDate = e.end.date
                ? addDays(e.end.date, -1)
                : (e.end.dateTime?.slice(0, 10) || startDate);
              if (endDate < startDate) endDate = startDate;
              return {
                id: `gcal_${e.id}`,
                title: e.summary || "(제목 없음)",
                startDate,
                endDate,
                pageUrl: e.htmlLink || "#",
                color: calColor,
                group: undefined,
                isStart: false,
                isEnd: false,
                duration: 0,
                rowIndex: 0,
                isGCal: true,
                gcalLink: e.htmlLink || "#",
                gcalEventId: e.id,
                gcalCalendarId: calId,
              } as AnySegment;
            });
        });
        // Collect Notion IDs that have a GCal counterpart → hide the Notion bar
        const syncedFromGCal = new Set<string>();
        results.forEach(({ data }) => {
          (data.items as GCalEventRaw[] ?? []).forEach((e) => {
            const nid = e.extendedProperties?.private?.notionId;
            if (nid) syncedFromGCal.add(nid);
          });
        });
        setGcalSyncedNotionIds(syncedFromGCal);
        setGcalProjects(events);
      })
      .catch(async (e: unknown) => {
        if (cancelled) return;
        if ((e as Error).message === "401") {
          const newToken = await refreshGcalToken();
          if (!newToken) {
            setGcalToken(null);
            safeStorage.removeItem("pcal_gcal_token");
          }
        }
        console.error("GCal fetch error:", e);
      })
      .finally(() => {
        if (!cancelled) setGcalLoading(false);
      });

    return () => { cancelled = true; };
  }, [gcalToken, selectedCalendarIds, gcalCalendars, fetchStart, fetchEnd, gcalShowTimed, gcalColorOverrides]);

  // ── GCal functions ────────────────────────────────────────────────────────

  const connectGCal = () => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      alert("NEXT_PUBLIC_GOOGLE_CLIENT_ID 환경 변수가 설정되지 않았습니다.\nVercel 대시보드에서 추가해주세요.");
      return;
    }
    const redirectUri = `${window.location.origin}/gcal-callback`;
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      access_type: "offline",
      scope: "https://www.googleapis.com/auth/calendar",
      prompt: "consent",
    });
    const popup = window.open(
      `https://accounts.google.com/o/oauth2/v2/auth?${params}`,
      "gcal-auth",
      "width=500,height=600,left=200,top=100"
    );
    const handleMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type === "gcal-token") {
        const { token, refreshToken, expiresIn } = event.data as { type: string; token: string; refreshToken?: string; expiresIn: string };
        const expiry = Date.now() + parseInt(expiresIn) * 1000 - 60000;
        gcalExpiryRef.current = expiry;
        safeStorage.setItem("pcal_gcal_token", token);
        safeStorage.setItem("pcal_gcal_expiry", String(expiry));
        if (refreshToken) {
          gcalRefreshTokenRef.current = refreshToken;
          safeStorage.setItem("pcal_gcal_refresh_token", refreshToken);
        }
        setGcalToken(token);
        window.removeEventListener("message", handleMessage);
        popup?.close();
      }
    };
    window.addEventListener("message", handleMessage);
  };

  const disconnectGCal = () => {
    setGcalToken(null);
    setGcalProjects([]);
    setGcalCalendars([]);
    setSelectedCalendarIds(new Set());
    setGcalSyncedNotionIds(new Set());
    setShowGCalPanel(false);
    gcalRefreshTokenRef.current = null;
    gcalExpiryRef.current = 0;
    safeStorage.removeItem("pcal_gcal_token");
    safeStorage.removeItem("pcal_gcal_expiry");
    safeStorage.removeItem("pcal_gcal_selected");
    safeStorage.removeItem("pcal_gcal_refresh_token");
  };

  const toggleCalendar = (calId: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      safeStorage.setItem("pcal_gcal_selected", JSON.stringify([...next]));
      return next;
    });
  };

  const syncToGCal = async (project: ProjectSegment) => {
    if (!gcalToken) { connectGCal(); return; }
    setSyncingNotionId(project.id);
    try {
      const event = {
        summary: project.title,
        start: { date: project.startDate },
        end: { date: addDays(project.endDate, 1) },
        ...(project.pageUrl && project.pageUrl !== "#"
          ? { source: { title: "Project Calendar", url: project.pageUrl } }
          : {}),
        extendedProperties: {
          private: { source: "projectcal", notionId: project.id },
        },
      };
      const targetCalId = gcalSyncCalId || [...selectedCalendarIds][0] || "primary";
      const res = await fetch("/api/gcal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: gcalToken, calendarId: targetCalId, event }),
      });
      if (res.status === 401) {
        setGcalToken(null);
        safeStorage.removeItem("pcal_gcal_token");
        return;
      }
      if (res.ok) {
        setSyncedIds((prev) => {
          const next = new Set([...prev, project.id]);
          safeStorage.setItem("pcal_synced_ids", JSON.stringify([...next]));
          return next;
        });
      }
    } catch (e) {
      console.error("Sync error:", e);
    } finally {
      setSyncingNotionId(null);
    }
  };

  // 구글 일정 → 노션으로 가져오기. 성공 시 구글 일정은 삭제하고 노션에만 남긴다.
  const importToNotion = async (seg: AnySegment) => {
    if (!config || configId === "preview" || !seg.gcalEventId) return;
    setImportingId(seg.id);
    try {
      const res = await fetch("/api/create-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: config.notionConfig.apiKey,
          databaseId: config.notionConfig.databaseId,
          titleProperty: config.notionConfig.titleProperty,
          dateProperty: config.notionConfig.dateProperty,
          title: seg.title,
          startDate: seg.startDate,
          endDate: seg.endDate,
        }),
      });
      const d = await res.json();
      if (d.success && d.id) {
        // 노션 일정 추가 (낙관적)
        const newProj: ProjectSegment = {
          id: d.id, title: seg.title, startDate: seg.startDate, endDate: seg.endDate,
          color: barColors[projects.length % barColors.length] || "#FFB3BA",
          pageUrl: `https://notion.so/${String(d.id).replace(/-/g, "")}`,
          isStart: false, isEnd: false, duration: 0, rowIndex: 0,
        };
        setProjects((prev) => [...prev, newProj]);
        // 구글 일정 삭제 → 노션에만 남김
        setGcalProjects((prev) => prev.filter((p) => p.id !== seg.id));
        if (gcalToken) {
          fetch(`/api/gcal?token=${encodeURIComponent(gcalToken)}&action=delete&eventId=${encodeURIComponent(seg.gcalEventId)}&calendarId=${encodeURIComponent(seg.gcalCalendarId || "primary")}`)
            .catch(() => { /* 노션엔 이미 생성됨 */ });
        }
      }
    } catch (e) {
      console.error("Import error:", e);
    } finally {
      setImportingId(null);
    }
  };

  const updateGCalEvent = async (seg: AnySegment, newStart: string, newEnd: string) => {
    if (!gcalToken || !seg.gcalEventId) return;
    setGcalUpdatingId(seg.id);
    try {
      const res = await fetch("/api/gcal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: gcalToken,
          calendarId: seg.gcalCalendarId || "primary",
          eventId: seg.gcalEventId,
          patch: {
            start: { date: newStart },
            end: { date: addDays(newEnd, 1) },
          },
        }),
      });
      if (res.status === 401) {
        setGcalToken(null);
        safeStorage.removeItem("pcal_gcal_token");
        // Revert optimistic update
        setDateOverrides((prev) => { const next = new Map(prev); next.delete(seg.id); return next; });
      } else if (!res.ok) {
        // Revert on failure
        setDateOverrides((prev) => { const next = new Map(prev); next.delete(seg.id); return next; });
      }
    } catch (e) {
      console.error("GCal update error:", e);
      setDateOverrides((prev) => { const next = new Map(prev); next.delete(seg.id); return next; });
    } finally {
      setGcalUpdatingId(null);
    }
  };

  const renameGCalEvent = async (seg: AnySegment, newTitle: string, prevTitle: string) => {
    let token = gcalToken;
    if (!token || !seg.gcalEventId) return;
    const expiry = gcalExpiryRef.current || parseInt(safeStorage.getItem("pcal_gcal_expiry") ?? "0");
    if (Date.now() > expiry) token = await refreshGcalToken() ?? token;
    try {
      const res = await fetch("/api/gcal", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          calendarId: seg.gcalCalendarId || "primary",
          eventId: seg.gcalEventId,
          patch: { summary: newTitle },
        }),
      });
      if (res.status === 401) {
        const refreshed = await refreshGcalToken();
        if (refreshed) {
          renameGCalEvent(seg, newTitle, prevTitle);
        } else {
          setGcalToken(null); safeStorage.removeItem("pcal_gcal_token");
          setGcalProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: prevTitle } : p));
        }
      } else if (!res.ok) {
        setGcalProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: prevTitle } : p));
      }
    } catch {
      setGcalProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: prevTitle } : p));
    }
  };

  // ── Notion fetch ──────────────────────────────────────────────────────────

  const getPreviewProjects = useCallback((): Project[] => {
    const d = (monthOffset: number, day: number): string => {
      const dt = new Date(year, month + monthOffset, 1);
      const lastDay = new Date(dt.getFullYear(), dt.getMonth() + 1, 0).getDate();
      return formatDate(new Date(dt.getFullYear(), dt.getMonth(), Math.min(day, lastDay)));
    };
    return [
      { id: "s1", title: "Website Redesign", startDate: d(-1, 20), endDate: d(0, 4),  pageUrl: "#" },
      { id: "s2", title: "Mobile App MVP",   startDate: d(0, 6),   endDate: d(0, 10), pageUrl: "#" },
      { id: "s3", title: "QA Testing",       startDate: d(0, 12),  endDate: d(0, 14), pageUrl: "#" },
      { id: "s4", title: "Final Launch",     startDate: d(0, 17),  endDate: d(1, 5),  pageUrl: "#" },
      { id: "s5", title: "Design Polish",    startDate: d(0, 21),  endDate: d(0, 24), pageUrl: "#" },
    ];
  }, [year, month]);

  // Fetch group property options once for the inline picker
  useEffect(() => {
    const gp = config?.notionConfig.groupProperty;
    if (!gp || !config?.notionConfig.apiKey || !config?.notionConfig.databaseId) return;
    fetch("/api/analyze-database", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: config.notionConfig.apiKey, databaseId: config.notionConfig.databaseId, groupProperty: gp }),
    })
      .then((r) => r.json())
      .then((d) => {
        if (d.success && d.data?.selectOptions?.[gp]) {
          setGroupOptions(d.data.selectOptions[gp]);
        }
        const gpMeta = d.data?.groupableProperties?.find((p: { name: string; type: string }) => p.name === gp);
        if (gpMeta) setGroupPropType(gpMeta.type);
        if (d.success && d.data?.relationOptionIds?.[gp]) {
          setGroupOptionIds(d.data.relationOptionIds[gp]);
        }
        if (d.success && d.data?.rollupRelationProps?.[gp]) {
          setGroupWriteProp(d.data.rollupRelationProps[gp]);
        }
      })
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?.notionConfig.groupProperty]);

  const fetchProjects = useCallback(async () => {
    if (centerYear === null || centerMonth === null) return;
    if (!hasLoadedOnce.current) setLoading(true);
    setError(null);

    const applyGroupColors = (segs: ReturnType<typeof assignColors>) => {
      if (Object.keys(groupColorOverrides).length === 0) return segs;
      return segs.map((p) => ({
        ...p,
        color: (p.group && groupColorOverrides[p.group])
          || (!p.group?.trim() && groupColorOverrides["__none__"])
          || p.color,
      }));
    };

    if (configId === "preview") {
      const raw = previewProjects ?? getPreviewProjects();
      setProjects(applyGroupColors(assignColors(raw, barColors)));
      setLoading(false);
      return;
    }

    if (config) {
      try {
        const res = await fetch("/api/events", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            config: {
              token: config.notionConfig.apiKey,
              dbId: config.notionConfig.databaseId,
              dateProp: config.notionConfig.dateProperty,
              titleProp: config.notionConfig.titleProperty,
              ...(config.notionConfig.groupProperty ? { groupProp: config.notionConfig.groupProperty } : {}),
              ...(config.notionConfig.dependencyProperty ? { dependsProp: config.notionConfig.dependencyProperty } : {}),
              ...(config.notionConfig.highlightProperty ? { highlightProp: config.notionConfig.highlightProperty } : {}),
              ...(config.notionConfig.rowProperty ? { rowProp: config.notionConfig.rowProperty } : {}),
              ...(config.notionConfig.doneProperty ? { doneProp: config.notionConfig.doneProperty } : {}),
              ...(config.notionConfig.plannerDbId ? { plannerDbId: config.notionConfig.plannerDbId } : {}),
              ...(config.notionConfig.parentRelProp ? { parentRelProp: config.notionConfig.parentRelProp } : {}),
            },
            startDate: fetchStart,
            endDate: fetchEnd,
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setProjects(json.success && json.data ? applyGroupColors(assignColors(json.data, barColors)) : []);
        if (json.dependsProp) setDetectedDependsProp(json.dependsProp as string);
      } catch (e) {
        console.error(e);
        setError("프로젝트를 불러올 수 없습니다.");
        setProjects([]);
      } finally {
        setLoading(false);
        hasLoadedOnce.current = true;
      }
      return;
    }

    setLoading(false);
    hasLoadedOnce.current = true;
  }, [configId, config, centerYear, centerMonth, fetchStart, fetchEnd, barColors, previewProjects, getPreviewProjects, groupColorOverrides]);

  useEffect(() => { fetchProjects(); }, [fetchProjects]);

  const navigateMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    setCenterYear(d.getFullYear());
    setCenterMonth(d.getMonth());
  };

  const navigateWeek = (delta: number) => {
    setWeekStartStr((prev) => {
      if (!prev) return prev;
      const d = new Date(prev + "T00:00:00");
      d.setDate(d.getDate() + delta * 7);
      return formatDate(d);
    });
  };

  const scrollToToday = () => {
    if (!bodyRef.current) return;
    const offset = weekView
      ? prevWeekDays.length * WEEK_DAY_WIDTH + 12
      : prevDays.length * DAY_WIDTH + 12;
    bodyRef.current.scrollLeft = offset;
  };

  // 오늘 날짜로 이동: 멀리 이동한 상태여도 오늘이 포함된 달/주로 리셋 후 스크롤
  // (새로고침했을 때 보이는 그 화면)
  const goToToday = () => {
    const now = new Date();
    const ty = now.getFullYear(), tm = now.getMonth();
    const tw = formatDate(getWeekStart(now));
    scrolledRef.current = false;
    if (weekView) {
      if (weekStartStr === tw) scrollToToday();
      else setWeekStartStr(tw);
    } else if (centerYear === ty && centerMonth === tm) {
      scrollToToday();
    } else {
      setCenterYear(ty);
      setCenterMonth(tm);
    }
  };

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // ── Layout computation ────────────────────────────────────────────────────

  // 상위→하위 항목 맵 (하위 항목은 개별 막대로 표시하지 않고 상위 토글 안에서 보여준다)
  const childrenByParent = new Map<string, Project[]>();
  for (const p of projects) {
    if (p.parentId) {
      const arr = childrenByParent.get(p.parentId) ?? [];
      arr.push(p);
      childrenByParent.set(p.parentId, arr);
    }
  }

  // Apply date overrides to both Notion and GCal events
  // Hide Notion events that have been synced to GCal (show GCal version instead)
  // 하위 항목(parentId 있음)은 부모가 펼쳐진 경우에만 막대로 렌더
  const effectiveNotionProjects: AnySegment[] = projects
    .filter((p) => !gcalSyncedNotionIds.has(p.id) && (!p.parentId || expandedParents.has(p.parentId)))
    .map((p) => {
      const o = dateOverrides.get(p.id);
      return o ? { ...p, ...o } : p;
    });

  const effectiveGCalProjects: AnySegment[] = gcalProjects.map((p) => {
    const o = dateOverrides.get(p.id);
    return o ? { ...p, ...o } : p;
  });

  const allDisplayProjects: AnySegment[] = [...effectiveGCalProjects, ...effectiveNotionProjects];

  // Dependency-aware layout when any event has predecessors ("선행 작업"),
  // otherwise keep the original packing behavior unchanged.
  const hasDeps = allDisplayProjects.some((p) => p.dependsOn && p.dependsOn.length > 0);
  // 선행으로 참조되는 일정 ID 집합 (오른쪽 ✕ 표시 여부 판단용)
  const referencedPredIds = new Set(allDisplayProjects.flatMap((p) => p.dependsOn ?? []));
  const rowMap = hasDeps
    ? assignRowsWithDeps(allDisplayProjects as ProjectSegment[])
    : assignRows(allDisplayProjects as ProjectSegment[], multiRow);
  const effectiveRowMap = new Map(rowMap);
  // Notion "행 위치" 속성에 저장된 줄 위치를 먼저 반영 (복원)
  allDisplayProjects.forEach((p) => {
    if (p.rowPos != null && effectiveRowMap.has(p.id)) effectiveRowMap.set(p.id, p.rowPos);
  });
  // 이번 세션 드래그로 바뀐 줄 위치를 그 위에 반영
  rowOverrides.forEach((row, id) => {
    if (effectiveRowMap.has(id)) effectiveRowMap.set(id, row);
  });

  const rowValues = Array.from(effectiveRowMap.values());
  const maxRow = rowValues.length > 0 ? Math.max(...rowValues) + 1 : 1;
  const totalRows = Math.max(dragId ? Math.max(maxRow, 2) : maxRow, 1);

  // ── Dependency connector lines (선행 → 후속) ─────────────────────────────────
  // Geometry mirrors the day-grid: each column is `dayWidth` wide, the grid has
  // 12px horizontal padding, and bars start below the date header (HEADER_OFFSET).
  const GRID_PAD = 12;
  const HEADER_OFFSET = 40; // date header height (34) + marginBottom (6)
  const dependencyConnectors: Array<{ id: string; x1: number; y1: number; x2: number; y2: number; sameRow: boolean; backward: boolean }> = [];
  // Bars to mask out so connector lines never show through the (translucent) bars.
  const barMaskRects: Array<{ id: string; x: number; y: number; w: number; h: number }> = [];
  if (hasDeps && displayDays.length > 0) {
    const dateIndex = new Map<string, number>();
    displayDays.forEach((d, i) => dateIndex.set(d.dateStr, i));
    const firstDate = displayDays[0].dateStr;
    const idxFor = (date: string) => {
      const i = dateIndex.get(date);
      if (i != null) return i;
      return date < firstDate ? 0 : displayDays.length - 1;
    };
    const byId = new Map(allDisplayProjects.map((p) => [p.id, p]));
    for (const succ of allDisplayProjects) {
      if (!succ.dependsOn || succ.dependsOn.length === 0) continue;
      const sRow = effectiveRowMap.get(succ.id) ?? 0;
      const x2 = GRID_PAD + idxFor(succ.startDate) * dayWidth;
      const y2 = HEADER_OFFSET + sRow * ROW_HEIGHT + BAR_HEIGHT / 2;
      for (const predId of succ.dependsOn) {
        const pred = byId.get(predId);
        if (!pred) continue; // predecessor not in the current window
        const pRow = effectiveRowMap.get(pred.id) ?? 0;
        const x1 = GRID_PAD + (idxFor(pred.endDate) + 1) * dayWidth;
        const y1 = HEADER_OFFSET + pRow * ROW_HEIGHT + BAR_HEIGHT / 2;
        // 선행이 후속보다 늦게 끝나면(역전) 화살표를 빨강으로. 같은 날은 제외.
        const backward = pred.endDate > succ.startDate;
        dependencyConnectors.push({ id: `${predId}__${succ.id}`, x1, y1, x2, y2, sameRow: pRow === sRow, backward });
      }
    }
    if (dependencyConnectors.length > 0) {
      for (const p of allDisplayProjects) {
        const row = effectiveRowMap.get(p.id) ?? 0;
        const x = GRID_PAD + idxFor(p.startDate) * dayWidth;
        const xEnd = GRID_PAD + (idxFor(p.endDate) + 1) * dayWidth;
        barMaskRects.push({ id: p.id, x, y: HEADER_OFFSET + row * ROW_HEIGHT, w: xEnd - x, h: BAR_HEIGHT });
      }
    }
  }
  const connectorSvgWidth = GRID_PAD * 2 + displayDays.length * dayWidth;
  const connectorSvgHeight = HEADER_OFFSET + totalRows * ROW_HEIGHT;

  function bumpRows(movedId: string, newRow: number, prevOverrides: Map<string, number>): Map<string, number> {
    const uniqueById = new Map<string, AnySegment>();
    for (const p of allDisplayProjects) { if (!uniqueById.has(p.id)) uniqueById.set(p.id, p); }
    const effective = new Map(rowMap);
    prevOverrides.forEach((r, id) => { if (effective.has(id)) effective.set(id, r); });
    effective.set(movedId, newRow);
    const next = new Map(prevOverrides);
    next.set(movedId, newRow);
    const overlap = (a: AnySegment, b: AnySegment) => a.startDate <= b.endDate && a.endDate >= b.startDate;
    let changed = true;
    let guard = 0;
    while (changed && guard++ < 200) {
      changed = false;
      const ids = Array.from(uniqueById.keys());
      for (let i = 0; i < ids.length; i++) {
        for (let j = i + 1; j < ids.length; j++) {
          const pA = uniqueById.get(ids[i])!;
          const pB = uniqueById.get(ids[j])!;
          if ((effective.get(ids[i]) ?? 0) === (effective.get(ids[j]) ?? 0) && overlap(pA, pB)) {
            const pushId = ids[i] === movedId ? ids[j] : ids[i];
            const pushed = (effective.get(pushId) ?? 0) + 1;
            effective.set(pushId, pushed);
            next.set(pushId, pushed);
            changed = true;
          }
        }
      }
    }
    return next;
  }

  // ── Persist Notion drag changes (date / row position) ─────────────────────
  const persistNotionDate = (pageId: string, startDate: string, endDate: string) => {
    if (!config || configId === "preview") return;
    fetch("/api/update-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: config.notionConfig.apiKey,
        pageId,
        property: config.notionConfig.dateProperty,
        value: { start: startDate, end: endDate },
        propType: "date",
      }),
    }).catch(() => { /* keep optimistic value */ });
  };

  const persistNotionRow = (pageId: string, row: number) => {
    const rowProp = config?.notionConfig.rowProperty;
    if (!config || configId === "preview" || !rowProp) return;
    fetch("/api/update-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        apiKey: config.notionConfig.apiKey,
        pageId,
        property: rowProp,
        value: String(row),
        propType: "select",
      }),
    }).catch(() => { /* ignore */ });
  };

  // 일정 삭제 (헤더로 드롭)
  const deleteEvent = (proj: AnySegment) => {
    if (proj.isGCal) {
      if (gcalToken && proj.gcalEventId) {
        setGcalProjects((prev) => prev.filter((p) => p.id !== proj.id));
        fetch(`/api/gcal?token=${encodeURIComponent(gcalToken)}&action=delete&eventId=${encodeURIComponent(proj.gcalEventId)}&calendarId=${encodeURIComponent(proj.gcalCalendarId || "primary")}`)
          .then((r) => { if (!r.ok) setGcalProjects((prev) => [...prev, proj]); })
          .catch(() => setGcalProjects((prev) => [...prev, proj]));
      }
    } else {
      setProjects((prev) => prev.filter((p) => p.id !== proj.id));
      fetch("/api/delete-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: config?.notionConfig.apiKey, pageId: proj.id }),
      })
        .then((r) => r.json())
        .then((d) => { if (!d.success) setProjects((prev) => [...prev, proj as ProjectSegment]); })
        .catch(() => setProjects((prev) => [...prev, proj as ProjectSegment]));
    }
  };

  // 선후관계(의존성) 생성: 동그라미에서 다른 일정으로 드래그
  // fromEnd=true → source가 선행(predecessor), target이 후속
  // fromEnd=false → source가 후속, target이 선행
  const createDependency = (sourceId: string, targetId: string, fromEnd: boolean) => {
    if (configId === "preview" || !config) return;
    const prop = config.notionConfig.dependencyProperty || detectedDependsProp;
    if (!prop) return;
    const succId = fromEnd ? targetId : sourceId;
    const predId = fromEnd ? sourceId : targetId;
    if (succId === predId) return;
    const succ = projects.find((p) => p.id === succId);
    if (!succ) return; // 후속이 노션 일정이어야 함
    const existing = succ.dependsOn ?? [];
    if (existing.includes(predId)) return;
    const next = [...existing, predId];
    setProjects((ps) => ps.map((p) => p.id === succId ? { ...p, dependsOn: next } : p));
    fetch("/api/update-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: config.notionConfig.apiKey, pageId: succId, property: prop, value: next, propType: "relation" }),
    })
      .then((r) => r.json())
      .then((d) => { if (!d.success) setProjects((ps) => ps.map((p) => p.id === succId ? { ...p, dependsOn: existing } : p)); })
      .catch(() => setProjects((ps) => ps.map((p) => p.id === succId ? { ...p, dependsOn: existing } : p)));
  };

  // 한 일정의 선후 연결을 끊는다 (노션에 저장)
  const writeDependsOn = (pageId: string, next: string[], prevOnFail: string[]) => {
    if (!config) return;
    const prop = config.notionConfig.dependencyProperty || detectedDependsProp;
    if (!prop) return;
    fetch("/api/update-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: config.notionConfig.apiKey, pageId, property: prop, value: next, propType: "relation" }),
    })
      .then((r) => r.json())
      .then((d) => { if (!d.success) setProjects((ps) => ps.map((p) => p.id === pageId ? { ...p, dependsOn: prevOnFail } : p)); })
      .catch(() => setProjects((ps) => ps.map((p) => p.id === pageId ? { ...p, dependsOn: prevOnFail } : p)));
  };

  // 왼쪽 ✕: 이 일정의 선행 작업(들)을 모두 제거
  const clearIncoming = (seg: AnySegment) => {
    if (configId === "preview" || !config) return;
    const prev = seg.dependsOn ?? [];
    if (prev.length === 0) return;
    setProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, dependsOn: [] } : p));
    writeDependsOn(seg.id, [], prev);
  };

  // 오른쪽 ✕: 이 일정을 선행으로 두는 후속들에서 연결 제거
  const clearOutgoing = (seg: AnySegment) => {
    if (configId === "preview" || !config) return;
    const successors = allDisplayProjects.filter((p) => !p.isGCal && (p.dependsOn ?? []).includes(seg.id));
    for (const succ of successors) {
      const prev = succ.dependsOn ?? [];
      const next = prev.filter((x) => x !== seg.id);
      setProjects((ps) => ps.map((p) => p.id === succ.id ? { ...p, dependsOn: next } : p));
      writeDependsOn(succ.id, next, prev);
    }
  };

  // 강조(중요) 체크박스 토글 → 노션 저장
  const toggleHighlight = (pageId: string, next: boolean) => {
    if (configId === "preview" || !config) return;
    const prop = config.notionConfig.highlightProperty;
    if (!prop) return;
    setProjects((ps) => ps.map((p) => p.id === pageId ? { ...p, highlighted: next } : p));
    fetch("/api/update-event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ apiKey: config.notionConfig.apiKey, pageId, property: prop, value: next, propType: "checkbox" }),
    })
      .then((r) => r.json())
      .then((d) => { if (!d.success) setProjects((ps) => ps.map((p) => p.id === pageId ? { ...p, highlighted: !next } : p)); })
      .catch(() => setProjects((ps) => ps.map((p) => p.id === pageId ? { ...p, highlighted: !next } : p)));
  };

  // 기존 플래너 항목 목록 불러오기 (보내기 모달 열 때)
  const loadPlannerItems = async () => {
    if (!config?.notionConfig.plannerDbId) return;
    const nc = config.notionConfig;
    setPlannerItemsLoading(true);
    try {
      const res = await fetch("/api/planner-items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: nc.plannerToken || nc.apiKey, plannerDbId: nc.plannerDbId }),
      });
      const d = await res.json();
      setPlannerItems(d.success && Array.isArray(d.items) ? d.items : []);
    } catch {
      setPlannerItems([]);
    } finally {
      setPlannerItemsLoading(false);
    }
  };

  // 프젝칼 항목 → 플래너로 복사 (하위 제목 줄단위) + 기존 항목 토글 연결. 둘 다 비우면 제목 그대로 1개
  const sendToPlanner = async () => {
    if (!config || !sendPopup) return;
    const nc = config.notionConfig;
    if (!nc.plannerDbId) return;
    const subTitles = sendText.split("\n").map((s) => s.trim()).filter(Boolean);
    setSendState("sending");
    setSendError("");
    try {
      const res = await fetch("/api/send-to-planner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          apiKey: nc.plannerToken || nc.apiKey,
          plannerDbId: nc.plannerDbId,
          parentPageId: sendPopup.id,
          subTitles,
          existingPlannerIds: [...selectedPlannerIds],
          plannerTitleProp: nc.plannerTitleProp,
          plannerDateProp: nc.plannerDateProp,
          plannerBookProp: nc.plannerBookProp,
          plannerLinkProp: nc.plannerLinkProp,
          parentRelProp: nc.parentRelProp,
          bookProp: nc.bookProperty,
          titleProperty: nc.titleProperty,
          dateProperty: nc.dateProperty,
        }),
      });
      const d = await res.json();
      if (!res.ok || !d.success) throw new Error(d.error?.message || "보내기 실패");
      setSendState("done");
      setTimeout(() => { setSendPopup(null); setSendText(""); setSendState("idle"); fetchProjects(); }, 700);
    } catch (e) {
      console.error(e);
      setSendError(e instanceof Error ? e.message : String(e));
      setSendState("error");
    }
  };

  // 날짜 더블클릭 → 그 날짜에 걸친 "아직 안 보낸" 항목 전체를 플래너로 보내기(제목 그대로)
  const [bulkSending, setBulkSending] = useState(false);
  const bulkSendDay = async (dateStr: string) => {
    if (!config) return;
    const nc = config.notionConfig;
    if (!nc.plannerDbId || bulkSending) return;
    const targets = projects.filter((p) => !p.sent && p.startDate <= dateStr && dateStr <= p.endDate);
    if (targets.length === 0) return;
    if (typeof window !== "undefined" && !window.confirm(`${dateStr}의 안 보낸 항목 ${targets.length}개를 플래너로 보낼까요?`)) return;
    setBulkSending(true);
    try {
      for (const p of targets) {
        await fetch("/api/send-to-planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            apiKey: nc.plannerToken || nc.apiKey,
            plannerDbId: nc.plannerDbId,
            parentPageId: p.id,
            subTitles: [],
            plannerTitleProp: nc.plannerTitleProp,
            plannerDateProp: nc.plannerDateProp,
            plannerBookProp: nc.plannerBookProp,
            plannerLinkProp: nc.plannerLinkProp,
            parentRelProp: nc.parentRelProp,
            bookProp: nc.bookProperty,
            titleProperty: nc.titleProperty,
            dateProperty: nc.dateProperty,
          }),
        }).catch(() => {});
      }
    } finally {
      setBulkSending(false);
      fetchProjects();
    }
  };

  // 포인터 위치 → 날짜/행/일정/헤더 (마우스+터치 공통)
  const locateAt = (x: number, y: number) => {
    const els = (typeof document !== "undefined" ? document.elementsFromPoint(x, y) : []) as HTMLElement[];
    let date: string | null = null, dropEl: HTMLElement | null = null, segId: string | null = null, header = false;
    for (const el of els) {
      const ds = el.dataset;
      if (!ds) continue;
      if (!date && ds.pcalDate) { date = ds.pcalDate; dropEl = el; }
      if (!segId && ds.pcalSeg) segId = ds.pcalSeg;
      if (ds.pcalHeader) header = true;
    }
    let row = 0;
    if (dropEl) { const r = dropEl.getBoundingClientRect(); row = Math.max(0, Math.floor((y - r.top) / ROW_HEIGHT)); }
    return { date, row, segId, header };
  };

  // 포인터 기반 드래그 시작 (이동/리사이즈/링크) — 마우스와 터치 모두 동작
  const startPointerDrag = (
    e: React.PointerEvent,
    mode: "move" | "resize-start" | "resize-end" | "link",
    seg: AnySegment,
    dateStr: string,
    fromEnd = false,
  ) => {
    if (gcalUpdatingId === seg.id) return;
    e.stopPropagation();
    setHoveredId(seg.id); // 터치에서 핸들/동그라미 노출
    pdrag.current = {
      mode, segId: seg.id, isGCal: !!seg.isGCal, grabDate: dateStr,
      originStart: seg.startDate, originEnd: seg.endDate, fromEnd,
      startX: e.clientX, startY: e.clientY, active: false,
      curStart: seg.startDate, curEnd: seg.endDate, curRow: effectiveRowMap.get(seg.id) ?? 0,
    };

    const onMove = (ev: PointerEvent) => {
      const d = pdrag.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY) < 5) return;
        d.active = true;
        setDragId(d.segId);
        setTooltip((t) => ({ ...t, visible: false }));
      }
      ev.preventDefault();
      const loc = locateAt(ev.clientX, ev.clientY);
      if (d.mode === "link") {
        setLinkTargetId(loc.segId && loc.segId !== d.segId ? loc.segId : null);
        return;
      }
      setDropOnHeader(loc.header);
      if (loc.header) { setDropDateStr(null); return; }
      if (!loc.date) return;
      setDropDateStr(loc.date);
      if (d.mode === "move") {
        const delta = daysBetween(d.grabDate, loc.date);
        const ns = addDays(d.originStart, delta), ne = addDays(d.originEnd, delta);
        d.curStart = ns; d.curEnd = ne; d.curRow = loc.row;
        setDateOverrides((prev) => { const n = new Map(prev); n.set(d.segId, { startDate: ns, endDate: ne }); return n; });
      } else if (d.mode === "resize-end") {
        const ne = loc.date >= d.originStart ? loc.date : d.originStart;
        d.curStart = d.originStart; d.curEnd = ne;
        setDateOverrides((prev) => { const n = new Map(prev); n.set(d.segId, { startDate: d.originStart, endDate: ne }); return n; });
      } else if (d.mode === "resize-start") {
        const ns = loc.date <= d.originEnd ? loc.date : d.originEnd;
        d.curStart = ns; d.curEnd = d.originEnd;
        setDateOverrides((prev) => { const n = new Map(prev); n.set(d.segId, { startDate: ns, endDate: d.originEnd }); return n; });
      }
    };

    const onUp = (ev: PointerEvent) => {
      const d = pdrag.current;
      pdrag.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (!d) return;
      if (!d.active) return; // 단순 탭/클릭 → 클릭 핸들러에 맡김
      lastDragEnd.current = Date.now();
      const loc = locateAt(ev.clientX, ev.clientY);
      const proj = allDisplayProjects.find((p) => p.id === d.segId);
      if (d.mode === "link") {
        if (loc.segId && loc.segId !== d.segId) createDependency(d.segId, loc.segId, d.fromEnd);
      } else if (proj) {
        if (loc.header) {
          deleteEvent(proj);
        } else if (d.mode === "move") {
          if (d.curStart !== d.originStart) {
            if (proj.isGCal) updateGCalEvent(proj, d.curStart, d.curEnd);
            else persistNotionDate(d.segId, d.curStart, d.curEnd);
          }
          setRowOverrides((prev) => {
            const next = bumpRows(d.segId, d.curRow, prev);
            const obj: Record<string, number> = {};
            next.forEach((v, k) => { obj[k] = v; });
            safeStorage.setItem("pcal_row_overrides", JSON.stringify(obj));
            return next;
          });
          if (!proj.isGCal) persistNotionRow(d.segId, d.curRow);
        } else {
          // resize
          if (proj.isGCal) updateGCalEvent(proj, d.curStart, d.curEnd);
          else persistNotionDate(d.segId, d.curStart, d.curEnd);
        }
      }
      setDragId(null); setDropDateStr(null); setDropOnHeader(false); setLinkTargetId(null);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  function getSegmentsForDay(dateStr: string): AnySegment[] {
    return allDisplayProjects
      .filter((p) => dateStr >= p.startDate && dateStr <= p.endDate)
      .map((p) => {
        const isStart = dateStr === p.startDate;
        const isEnd = dateStr === p.endDate;
        const duration = isStart
          ? Math.round((new Date(p.endDate + "T00:00:00").getTime() - new Date(p.startDate + "T00:00:00").getTime()) / 86400000) + 1
          : 0;
        return { ...p, isStart, isEnd, duration, rowIndex: 0 };
      });
  }

  if (centerYear === null || centerMonth === null) {
    return (
      <div style={{
        fontFamily: font, background: bgColor,
        border: darkMode ? "none" : `1px solid ${primaryColor}`,
        outline: darkMode ? "none" : `2px solid ${lightenColor(primaryColor, 0.85)}`,
        borderRadius: 10, overflow: "hidden",
        padding: "20px 40px", fontSize: 11, color: "#aaa",
        minWidth: 200,
      }}>
        로딩 중...
      </div>
    );
  }

  const centerMonthLabel = new Date(year, month).toLocaleDateString("en-US", { month: "long", year: "numeric" });

  const weekLabel = weekView && weekDays.length > 0 ? (() => {
    const s = weekDays[0].dateObj;
    const e = weekDays[6].dateObj;
    const sm = s.toLocaleDateString("en-US", { month: "short" });
    const em = e.toLocaleDateString("en-US", { month: "short" });
    return s.getMonth() === e.getMonth()
      ? `${sm} ${s.getDate()} – ${e.getDate()}, ${s.getFullYear()}`
      : `${sm} ${s.getDate()} – ${em} ${e.getDate()}, ${e.getFullYear()}`;
  })() : "";

  const headerLabel = weekView ? weekLabel : centerMonthLabel;

  return (
    <>
      <style>{`
        @import url("https://cdn.jsdelivr.net/npm/galmuri@latest/dist/galmuri.css");
        @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css");
        @keyframes pcal-spin { 100% { transform: rotate(360deg); } }
      `}</style>

      {/* Click-away overlay for GCal panel */}
      {showGCalPanel && (
        <div
          onClick={() => setShowGCalPanel(false)}
          style={{ position: "fixed", inset: 0, zIndex: 499 }}
        />
      )}

      <div ref={widgetRef} style={{
        fontFamily: font, background: bgColor,
        border: darkMode ? "none" : `1px solid ${primaryColor}`,
        outline: darkMode ? "none" : `2px solid ${headerBg}`,
        boxShadow: darkMode ? "none" : `2px 2px 0px ${primaryColor}4D, 4px 4px 12px ${primaryColor}26`,
        borderRadius: 10, overflow: "hidden", userSelect: "none",
        width: "fit-content", maxWidth: "100%",
        display: "flex", flexDirection: "column", position: "relative",
      }}>
        {/* Header */}
        <div style={{
          height: 22, background: headerBg, borderBottom: `1px solid ${primaryColor}`,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "0 12px", fontSize: 11, color: primaryColor,
          fontWeight: "bold", letterSpacing: 0.2, flexShrink: 0,
        }}>
          <span style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span onClick={goToToday} style={{ display: "flex", gap: 6, alignItems: "center", cursor: "pointer" }}>
              <Link size={12} strokeWidth={2.5} />
              {headerLabel} Timeline
            </span>
            <span style={{ display: "flex", gap: 2, alignItems: "center", marginLeft: 2 }}>
              <button onClick={() => weekView ? navigateWeek(-1) : navigateMonth(-1)}
                aria-label="Previous" style={{ cursor: "pointer", padding: 2, borderRadius: 4, color: primaryColor, display: "flex", alignItems: "center", background: "none", border: "none" }}>
                <ChevronLeft size={14} />
              </button>
              <button onClick={() => weekView ? navigateWeek(1) : navigateMonth(1)}
                aria-label="Next" style={{ cursor: "pointer", padding: 2, borderRadius: 4, color: primaryColor, display: "flex", alignItems: "center", background: "none", border: "none" }}>
                <ChevronRight size={14} />
              </button>
            </span>
          </span>

          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {configId !== "preview" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (gcalToken) setShowGCalPanel((p) => !p);
                  else connectGCal();
                }}
                title={gcalToken ? "Google Calendar 설정" : "Google Calendar 연결"}
                style={{
                  cursor: "pointer",
                  padding: "1px 6px",
                  borderRadius: 4,
                  fontSize: 8,
                  fontWeight: 700,
                  letterSpacing: 0.3,
                  color: primaryColor,
                  background: "transparent",
                  border: "none",
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  lineHeight: 1,
                  transition: "all 0.2s",
                }}
              >
                {gcalLoading
                  ? <span style={{ display: "inline-block", animation: "pcal-spin 1s linear infinite" }}>↻</span>
                  : gcalToken ? "● GCal" : "+ GCal"
                }
              </button>
            )}
            {widgetConfigStr ? (
              <a
                href={`/setup?from=${widgetConfigStr}`}
                title="설정 수정"
                style={{ fontSize: 6, color: primaryColor, letterSpacing: 1, opacity: 0.7, textDecoration: "none", cursor: "pointer" }}
              >
                PROJECT CAL
              </a>
            ) : (
              <span style={{ fontSize: 6, color: primaryColor, letterSpacing: 1, opacity: 0.7 }}>PROJECT CAL</span>
            )}
          </span>
        </div>

        {/* Google Calendar settings panel */}
        {showGCalPanel && gcalToken && (
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 22,
              right: 0,
              zIndex: 500,
              background: darkMode ? "#2a2a2a" : "white",
              border: `1px solid ${primaryColor}`,
              borderTop: "none",
              borderRadius: "0 0 8px 8px",
              boxShadow: `0 8px 20px ${primaryColor}30`,
              minWidth: 220,
              maxWidth: 280,
              fontSize: 11,
              // 위젯 높이 안에 맞추고, 더 길면 패널 전체를 스크롤
              maxHeight: "calc(100% - 24px)",
              overflowY: "auto",
              overflowX: "hidden",
            }}
          >
            {/* Panel header */}
            <div style={{
              padding: "8px 12px",
              borderBottom: `1px solid ${primaryColor}20`,
              fontWeight: 700,
              color: primaryColor,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}>
              <span>Google Calendar</span>
              <button
                onClick={() => setShowGCalPanel(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: primaryColor, fontSize: 11, padding: 2 }}
              >✕</button>
            </div>

            {/* Calendar list */}
            {gcalCalendars.length === 0 ? (
              <div style={{ padding: "10px 12px", color: "#888", textAlign: "center" }}>
                <span style={{ display: "inline-block", animation: "pcal-spin 1s linear infinite" }}>↻</span>
                {" "}불러오는 중...
              </div>
            ) : (
              <div>
                {[...gcalCalendars].sort((a, b) => {
                  const ai = gcalCalendarOrder.indexOf(a.id);
                  const bi = gcalCalendarOrder.indexOf(b.id);
                  if (ai === -1 && bi === -1) return 0;
                  if (ai === -1) return 1;
                  if (bi === -1) return -1;
                  return ai - bi;
                }).map((cal) => {
                  const isSelected = selectedCalendarIds.has(cal.id);
                  const calColor = gcalColorOverrides[cal.id] || cal.backgroundColor || GCAL_DEFAULT_COLOR;
                  return (
                    <div
                      key={cal.id}
                      draggable
                      onDragStart={() => { panelDragCalId.current = cal.id; }}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={() => {
                        if (!panelDragCalId.current || panelDragCalId.current === cal.id) return;
                        const allIds = [...gcalCalendars].sort((a, b) => {
                          const ai = gcalCalendarOrder.indexOf(a.id); const bi = gcalCalendarOrder.indexOf(b.id);
                          if (ai === -1 && bi === -1) return 0; if (ai === -1) return 1; if (bi === -1) return -1; return ai - bi;
                        }).map((c) => c.id);
                        const from = allIds.indexOf(panelDragCalId.current!);
                        const to = allIds.indexOf(cal.id);
                        if (from === -1 || to === -1) return;
                        allIds.splice(from, 1); allIds.splice(to, 0, panelDragCalId.current!);
                        setGcalCalendarOrder(allIds);
                        safeStorage.setItem("pcal_gcal_order", JSON.stringify(allIds));
                        panelDragCalId.current = null;
                      }}
                      onClick={() => toggleCalendar(cal.id)}
                      style={{
                        padding: "5px 10px",
                        display: "flex",
                        alignItems: "center",
                        gap: 7,
                        cursor: "grab",
                        background: "transparent",
                        transition: "background 0.1s",
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = `${primaryColor}10`)}
                      onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                    >
                      {/* Fill color picker */}
                      <input
                        type="color"
                        value={gcalColorOverrides[cal.id] || cal.backgroundColor || GCAL_DEFAULT_COLOR}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => {
                          e.stopPropagation();
                          const next = { ...gcalColorOverrides, [cal.id]: e.target.value };
                          setGcalColorOverrides(next);
                          safeStorage.setItem("pcal_gcal_colors", JSON.stringify(next));
                        }}
                        style={{ width: 14, height: 14, padding: 0, border: "none", borderRadius: "50%", cursor: "pointer", flexShrink: 0, opacity: isSelected ? 1 : 0.4 }}
                      />
                      {/* Border color picker */}
                      <div
                        title="테두리 색"
                        onClick={(e) => e.stopPropagation()}
                        style={{ position: "relative", width: 14, height: 14, flexShrink: 0, opacity: isSelected ? 1 : 0.4 }}
                      >
                        <input
                          type="color"
                          value={gcalBorderColorOverrides[cal.id] || "#ffffff"}
                          onChange={(e) => {
                            const next = { ...gcalBorderColorOverrides, [cal.id]: e.target.value };
                            setGcalBorderColorOverrides(next);
                            safeStorage.setItem("pcal_gcal_border_colors", JSON.stringify(next));
                          }}
                          style={{ width: 14, height: 14, padding: 0, border: "1px dashed #aaa", borderRadius: "50%", cursor: "pointer", opacity: 1 }}
                        />
                      </div>
                      {/* Calendar name */}
                      <span style={{
                        flex: 1,
                        color: darkMode ? "#ccc" : "#444",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        opacity: isSelected ? 1 : 0.5,
                        fontSize: 10,
                      }}>
                        {cal.summary}
                        {cal.primary && <span style={{ marginLeft: 4, fontSize: 9, color: "#aaa" }}>(기본)</span>}
                      </span>
                      {/* Checkbox */}
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${isSelected ? calColor : "#ccc"}`,
                        background: isSelected ? calColor : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {isSelected && <span style={{ color: "white", fontSize: 9, lineHeight: 1 }}>✓</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Timed events toggle */}
            <div style={{ padding: "6px 12px", borderTop: `1px solid ${primaryColor}20` }}>
              <label
                onClick={() => {
                  const next = !gcalShowTimed;
                  setGcalShowTimed(next);
                  safeStorage.setItem("pcal_gcal_show_timed", String(next));
                }}
                style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", padding: "4px 0" }}
              >
                <div style={{
                  width: 28, height: 16, borderRadius: 8, flexShrink: 0, position: "relative",
                  background: gcalShowTimed ? "#4285F4" : "#ccc", transition: "background 0.2s",
                }}>
                  <div style={{
                    position: "absolute", top: 2, left: gcalShowTimed ? 14 : 2,
                    width: 12, height: 12, borderRadius: "50%", background: "white",
                    transition: "left 0.2s", boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
                  }} />
                </div>
                <span style={{ fontSize: 10, color: darkMode ? "#ccc" : "#555", fontWeight: 600 }}>
                  시간 지정 일정 포함
                </span>
              </label>
            </div>

            {/* Disconnect button */}
            <div style={{ padding: "8px 12px", borderTop: `1px solid ${primaryColor}20` }}>
              <button
                onClick={disconnectGCal}
                style={{
                  width: "100%", padding: "5px 0",
                  borderRadius: 6, border: "1px solid #e53e3e",
                  background: "transparent", color: "#e53e3e",
                  cursor: "pointer", fontSize: 10, fontWeight: 600,
                }}
              >
                연결 해제
              </button>
            </div>
          </div>
        )}

        {error && (
          <div style={{ textAlign: "center", padding: 12, color: "#e53e3e", fontSize: 11 }}>{error}</div>
        )}

        {loading ? (
          <div style={{ textAlign: "center", padding: 12, color: "#888", fontSize: 11 }}>Loading...</div>
        ) : (
          <div
            ref={bodyRef}
            onWheel={(e) => { if (bodyRef.current) bodyRef.current.scrollLeft += e.deltaY; }}
            style={{
              padding: "10px 0 18px", overflowX: "auto", overflowY: "hidden",
              display: "flex", background: bgColor,
              scrollbarWidth: "thin", scrollbarColor: `${primaryColor}40 transparent`,
            }}
          >
            <div style={{ display: "flex", padding: "0 12px", minWidth: "min-content", position: "relative" }}>
              {/* Dependency connector lines (선행 작업 → 후속 작업) */}
              {dependencyConnectors.length > 0 && (
                <svg
                  width={connectorSvgWidth}
                  height={connectorSvgHeight}
                  style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", zIndex: 3, overflow: "visible" }}
                >
                  <defs>
                    {/* Mask: white = line visible, black bars = line hidden where it overlaps a bar */}
                    <mask id="pcal-dep-mask" maskUnits="userSpaceOnUse" x={0} y={0} width={connectorSvgWidth} height={connectorSvgHeight}>
                      <rect x={0} y={0} width={connectorSvgWidth} height={connectorSvgHeight} fill="white" />
                      {barMaskRects.map((r) => (
                        <rect key={r.id} x={r.x} y={r.y} width={r.w} height={r.h} rx={4} fill="black" />
                      ))}
                    </mask>
                  </defs>
                  {/* Lines: masked so they never show through the translucent bars */}
                  <g mask="url(#pcal-dep-mask)">
                    {dependencyConnectors.map((c) => {
                      const dx = Math.max(10, Math.abs(c.x2 - c.x1) / 2);
                      const d = c.sameRow
                        ? `M ${c.x1} ${c.y1} L ${c.x2} ${c.y2}`
                        : `M ${c.x1} ${c.y1} C ${c.x1 + dx} ${c.y1}, ${c.x2 - dx} ${c.y2}, ${c.x2} ${c.y2}`;
                      return (
                        <path
                          key={c.id}
                          d={d}
                          fill="none"
                          stroke={c.backward ? "#B01818" : primaryColor}
                          strokeWidth={1.75}
                          strokeOpacity={c.backward ? 0.95 : 0.85}
                        />
                      );
                    })}
                  </g>
                  {/* Arrowheads: NOT masked → always visible at the connection point */}
                  <g>
                    {dependencyConnectors.map((c) => (
                      <path
                        key={`${c.id}__arrow`}
                        d={`M ${c.x2 - 5} ${c.y2 - 3.2} L ${c.x2} ${c.y2} L ${c.x2 - 5} ${c.y2 + 3.2} Z`}
                        fill={c.backward ? "#B01818" : primaryColor}
                      />
                    ))}
                  </g>
                </svg>
              )}
              {displayDays.map((day) => {
                const { dateStr } = day;
                const isMonthBoundary = day.day === 1;
                const segments = getSegmentsForDay(dateStr);
                const dow = day.dateObj.getDay();
                const isWeekend = dow === 0 || dow === 6;
                const isToday = todayStr === day.dateObj.toDateString();
                const isCurrWeek = weekView
                  ? weekDays.some((d) => d.dateStr === dateStr)
                  : (day.dateObj.getMonth() === month && day.dateObj.getFullYear() === year);
                const isColDrop = !!dragId && dropDateStr === dateStr;

                return (
                  <div key={dateStr} data-pcal-col="1" style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    width: dayWidth, flexShrink: 0,
                  }}>
                    {/* Date header — drag an event here to delete */}
                    <div
                      data-pcal-header="1"
                      title={config?.notionConfig.plannerDbId && configId !== "preview" ? "더블클릭: 이 날짜의 안 보낸 항목 전체 플래너로 보내기" : undefined}
                      style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 6, height: 34, position: "relative", opacity: isCurrWeek ? 1 : 0.55, borderRadius: 6, background: dropOnHeader && dragId ? "rgba(239,68,68,0.12)" : "transparent", transition: "background 0.15s", cursor: "pointer" }}
                      onClick={goToToday}
                      onDoubleClick={(e) => { if (config?.notionConfig.plannerDbId && configId !== "preview") { e.stopPropagation(); bulkSendDay(dateStr); } }}
                    >
                      {isMonthBoundary ? (
                        <span style={{
                          fontSize: 7, fontWeight: 700, color: primaryColor, letterSpacing: 0.5,
                          whiteSpace: "nowrap", lineHeight: 1, marginBottom: 2,
                          borderLeft: `2px solid ${primaryColor}`, paddingLeft: 3,
                        }}>
                          {day.dateObj.toLocaleDateString("en-US", { month: "short" })}
                        </span>
                      ) : (
                        <span style={{ height: 9, display: "block" }} />
                      )}
                      <span style={{
                        fontSize: weekView ? 10 : 8, color: isWeekend ? primaryColor : "#bbb",
                        textTransform: "uppercase", lineHeight: 1, marginBottom: 1,
                      }}>
                        {day.dayName}
                      </span>
                      <span style={{
                        fontSize: weekView ? 13 : 10, fontWeight: 600,
                        color: isToday ? "white" : isWeekend ? primaryColor : "#555",
                        width: weekView ? 22 : 16, height: weekView ? 22 : 16,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        borderRadius: "50%",
                        background: isToday ? primaryColor : isWeekend ? headerBg : "transparent",
                      }}>
                        {day.day}
                      </span>
                      {isToday && (
                        <div style={{ position: "absolute", top: -2, width: 3, height: 3, borderRadius: "50%", background: primaryColor }} />
                      )}
                    </div>

                    {/* Drop zone */}
                    <div
                      data-pcal-date={dateStr}
                      style={{
                        height: `${Math.max(totalRows, (createInput?.dateStr === dateStr ? createInput.row + 1 : 0)) * ROW_HEIGHT}px`, width: "100%", position: "relative",
                        background: isColDrop ? hexToRgba(primaryColor, 0.12) : "transparent",
                        transition: "background 0.1s",
                        borderRadius: 4,
                      }}
                      onDoubleClick={(e) => {
                        if ((e.target as HTMLElement) === e.currentTarget) {
                          const rect = e.currentTarget.getBoundingClientRect();
                          const row = Math.max(0, Math.floor((e.clientY - rect.top) / ROW_HEIGHT));
                          setCreateInput({ dateStr, title: "", row });
                        }
                      }}
                    >
                      {segments.map((seg) => {
                        const isHovered = hoveredId === seg.id;
                        const segChildren = !seg.isGCal ? childrenByParent.get(seg.id) : undefined;
                        const hasChildren = !!segChildren && segChildren.length > 0;
                        const isDragging = dragId === seg.id;
                        const isUpdating = gcalUpdatingId === seg.id;
                        const row = effectiveRowMap.get(seg.id) ?? 0;
                        const currWeekFirst = weekDays[0]?.dateStr;
                        const currWeekLast = weekDays[weekDays.length - 1]?.dateStr;
                        const spansCurrentWeek = weekView && !isCurrWeek && currWeekFirst && currWeekLast
                          ? seg.startDate <= currWeekLast && seg.endDate >= currWeekFirst
                          : true;
                        const segOpacity = spansCurrentWeek ? 1 : 0.55;
                        const zIdx = isHovered ? (seg.isStart ? 210 : 200) : hoveredId ? 0 : (seg.isStart ? 2 : 1);

                        const isMonthStart = isMonthBoundary && dateStr > seg.startDate;
                        const showLabel = seg.isStart || isMonthStart;
                        const labelDuration = seg.isStart
                          ? seg.duration
                          : Math.round(
                              (new Date(seg.endDate + "T00:00:00").getTime() - new Date(dateStr + "T00:00:00").getTime()) / 86400000
                            ) + 1;

                        const shapeStyle: React.CSSProperties =
                          seg.isStart && seg.isEnd
                            ? { borderRadius: 4, margin: "0 2px", width: "calc(100% - 4px)" }
                            : seg.isStart
                            ? { borderTopLeftRadius: 4, borderBottomLeftRadius: 4, marginLeft: 2, width: "calc(100% - 2px)" }
                            : seg.isEnd
                            ? { borderTopRightRadius: 4, borderBottomRightRadius: 4, marginRight: 2, width: "calc(100% - 2px)" }
                            : { width: "100%" };

                        const gcalColor = seg.color || GCAL_DEFAULT_COLOR;
                        const gcalBorderColor = (seg.gcalCalendarId && gcalBorderColorOverrides[seg.gcalCalendarId]) || "rgba(255,255,255,0.45)";
                        const gcalOutlineStyle: React.CSSProperties = seg.isGCal ? {
                          boxShadow: [
                            `inset 0 1px 0 0 ${gcalBorderColor}`,
                            `inset 0 -1px 0 0 ${gcalBorderColor}`,
                            seg.isStart ? `inset 1px 0 0 0 ${gcalBorderColor}` : "",
                            seg.isEnd ? `inset -1px 0 0 0 ${gcalBorderColor}` : "",
                          ].filter(Boolean).join(", "),
                          cursor: isUpdating ? "wait" : "grab",
                        } : {};

                        // 강조(체크) 속성이 켜진 노션 일정에 테두리 (두께는 GCal과 동일한 inset 1px)
                        const hlColor = config?.notionConfig.highlightBorderColor || "#FF5A5F";
                        const highlightOutlineStyle: React.CSSProperties = (!seg.isGCal && seg.highlighted) ? {
                          boxShadow: [
                            `inset 0 1px 0 0 ${hlColor}`,
                            `inset 0 -1px 0 0 ${hlColor}`,
                            seg.isStart ? `inset 1px 0 0 0 ${hlColor}` : "",
                            seg.isEnd ? `inset -1px 0 0 0 ${hlColor}` : "",
                          ].filter(Boolean).join(", "),
                        } : {};

                        const bgC = seg.isGCal
                          ? gcalColor
                          : isHovered ? seg.color : hexToRgba(seg.color, 0.55);

                        const isLinkTarget = linkTargetId === seg.id;
                        return (
                          <div
                            key={seg.id}
                            data-pcal-seg={seg.id}
                            style={{
                              height: BAR_HEIGHT, display: "flex", alignItems: "center",
                              justifyContent: "center", position: "absolute", color: "white",
                              fontSize: 10, fontWeight: "bold", overflow: "visible",
                              transition: "background-color .2s",
                              cursor: isDragging ? "grabbing" : "grab",
                              touchAction: "none",
                              left: 0, zIndex: isLinkTarget ? 215 : zIdx, backgroundColor: bgC,
                              top: `${row * ROW_HEIGHT}px`,
                              ...shapeStyle,
                              ...(isDragging ? { opacity: 0.3 } : isUpdating ? { opacity: 0.6 } : { opacity: segOpacity }),
                              ...gcalOutlineStyle,
                              ...highlightOutlineStyle,
                              ...(isLinkTarget ? { boxShadow: `0 0 0 2px ${primaryColor}` } : {}),
                            }}
                            onPointerDown={(e) => { if (!isUpdating) startPointerDrag(e, "move", seg, dateStr); }}
                            onDoubleClick={(e) => {
                              if (clickTimer.current) { clearTimeout(clickTimer.current); clickTimer.current = null; }
                              if (seg.isStart) {
                                e.stopPropagation();
                                setEditingTitle({ id: seg.id, value: seg.title });
                              }
                            }}
                            onClick={(e) => {
                              if (Date.now() - lastDragEnd.current < 300) return;
                              // 더블클릭이면 팝업을 열지 않도록 지연 후 실행 (dblclick에서 취소)
                              const hasGroup = !!config?.notionConfig.groupProperty && visibleGroupOptions.length > 0;
                              if (!seg.isGCal && seg.isStart && hasGroup) {
                                e.stopPropagation();
                                const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                const anchor = { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
                                if (clickTimer.current) clearTimeout(clickTimer.current);
                                clickTimer.current = setTimeout(() => {
                                  clickTimer.current = null;
                                  setEventPopup({ id: seg.id, group: seg.group ?? "", ...anchor });
                                }, 250);
                              }
                            }}
                            onMouseEnter={(e) => {
                              setHoveredId(seg.id);
                              setTooltip({
                                visible: true, x: e.clientX, y: e.clientY,
                                text: seg.startDate === seg.endDate
                                  ? seg.title
                                  : `${seg.title}  ${formatShortDate(seg.startDate)} ~ ${formatShortDate(seg.endDate)}`,
                                color: seg.isGCal ? gcalColor : seg.color,
                              });
                            }}
                            onMouseMove={(e) => {
                              if (tooltip.visible) setTooltip((t) => ({ ...t, x: e.clientX, y: e.clientY }));
                            }}
                            onMouseLeave={() => {
                              setHoveredId(null);
                              setTooltip((t) => ({ ...t, visible: false }));
                            }}
                          >
                            {/* Left resize handle */}
                            {seg.isStart && (
                              <div
                                style={{
                                  position: "absolute", left: 0, top: 0, width: 9, height: "100%",
                                  cursor: "ew-resize", zIndex: 20, touchAction: "none",
                                  borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
                                  background: "transparent",
                                }}
                                onPointerDown={(e) => startPointerDrag(e, "resize-start", seg, dateStr)}
                              />
                            )}

                            {/* Right resize handle */}
                            {seg.isEnd && (
                              <div
                                style={{
                                  position: "absolute", right: 0, top: 0, width: 9, height: "100%",
                                  cursor: "ew-resize", zIndex: 20, touchAction: "none",
                                  borderTopRightRadius: 4, borderBottomRightRadius: 4,
                                  background: "transparent",
                                }}
                                onPointerDown={(e) => startPointerDrag(e, "resize-end", seg, dateStr)}
                              />
                            )}

                            {/* Dependency link handles
                                - 연결 없음: 동그라미(드래그로 선후관계 생성)
                                - 이미 연결됨: ✕(클릭/탭으로 연결 삭제, 노션 저장) */}
                            {isHovered && !seg.isGCal && configId !== "preview" && !isDragging && (() => {
                              const hasIncoming = (seg.dependsOn?.length ?? 0) > 0;
                              const hasOutgoing = referencedPredIds.has(seg.id);
                              return (
                                <>
                                  {seg.isStart && (hasIncoming ? (
                                    // 작은 ✕는 유지하되, 막대 모서리에 밀착한 넓은 투명 히트 영역으로 감싸 틈 없이 클릭 가능
                                    <div
                                      title="선행 작업 연결 삭제"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => { e.stopPropagation(); clearIncoming(seg); }}
                                      style={{ position: "absolute", right: "100%", top: 0, height: "100%", width: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 30 }}
                                    >
                                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#e53e3e", color: "#fff", fontSize: 6, fontWeight: 600, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>×</div>
                                    </div>
                                  ) : (
                                    <div
                                      title="선행 작업 연결"
                                      onPointerDown={(e) => startPointerDrag(e, "link", seg, dateStr, false)}
                                      style={{ position: "absolute", right: "100%", top: 0, height: "100%", width: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "crosshair", zIndex: 30 }}
                                    >
                                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", border: `1.5px solid ${primaryColor}`, boxShadow: "0 1px 2px rgba(0,0,0,0.25)", pointerEvents: "none" }} />
                                    </div>
                                  ))}
                                  {seg.isEnd && (hasOutgoing ? (
                                    <div
                                      title="후속 작업 연결 삭제"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => { e.stopPropagation(); clearOutgoing(seg); }}
                                      style={{ position: "absolute", left: "100%", top: 0, height: "100%", width: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", zIndex: 30 }}
                                    >
                                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: "#e53e3e", color: "#fff", fontSize: 6, fontWeight: 600, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: "0 1px 2px rgba(0,0,0,0.25)" }}>×</div>
                                    </div>
                                  ) : (
                                    <div
                                      title="후속 작업 연결"
                                      onPointerDown={(e) => startPointerDrag(e, "link", seg, dateStr, true)}
                                      style={{ position: "absolute", left: "100%", top: 0, height: "100%", width: 16, display: "flex", alignItems: "center", justifyContent: "center", cursor: "crosshair", zIndex: 30 }}
                                    >
                                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff", border: `1.5px solid ${primaryColor}`, boxShadow: "0 1px 2px rgba(0,0,0,0.25)", pointerEvents: "none" }} />
                                    </div>
                                  ))}
                                </>
                              );
                            })()}

                            {/* Label / inline title editor */}
                            {editingTitle?.id === seg.id ? (() => {
                              const saveTitle = () => {
                                const newTitle = editingTitle.value.trim();
                                setEditingTitle(null);
                                if (!newTitle || newTitle === seg.title) return;
                                if (seg.isGCal) {
                                  setGcalProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: newTitle } : p));
                                  renameGCalEvent(seg, newTitle, seg.title);
                                } else {
                                  setProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: newTitle } : p));
                                  fetch("/api/update-event", {
                                    method: "POST",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({
                                      apiKey: config?.notionConfig.apiKey,
                                      pageId: seg.id,
                                      property: config?.notionConfig.titleProperty,
                                      value: newTitle,
                                      propType: "title",
                                    }),
                                  }).then((r) => r.json()).then((d) => {
                                    if (!d.success) setProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: seg.title } : p));
                                  }).catch(() => setProjects((ps) => ps.map((p) => p.id === seg.id ? { ...p, title: seg.title } : p)));
                                }
                              };
                              return (
                                <input
                                  autoFocus
                                  value={editingTitle.value}
                                  onChange={(e) => setEditingTitle({ id: seg.id, value: e.target.value })}
                                  onKeyDown={(e) => {
                                    if (e.key === "Escape") { setEditingTitle(null); return; }
                                    if (e.key === "Enter") { e.preventDefault(); saveTitle(); }
                                  }}
                                  onBlur={saveTitle}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{
                                    position: "absolute", left: 2,
                                    height: "100%", boxSizing: "border-box", padding: "0 6px",
                                    width: `${Math.max(dayWidth * Math.max(labelDuration, 1) - 4, 60)}px`,
                                    background: "rgba(0,0,0,0.4)", border: "none", outline: "none",
                                    color: "#fff", fontSize: 9, fontWeight: "bold",
                                    borderRadius: 2, zIndex: 300,
                                  }}
                                />
                              );
                            })() : showLabel && (
                              <span style={{
                                position: "absolute", left: hasChildren && seg.isStart ? 13 : 2, display: "flex",
                                justifyContent: "flex-start", alignItems: "center",
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                pointerEvents: "none", fontSize: 9,
                                color: labelColor,
                                height: "100%", boxSizing: "border-box", padding: "0 6px",
                                width: `${Math.max(dayWidth * Math.max(labelDuration, 1) - 4 - (hasChildren && seg.isStart ? 11 : 0), 21)}px`,
                                zIndex: isHovered ? 201 : 3,
                                textDecoration: seg.done ? "line-through" : "none",
                                opacity: seg.done ? 0.6 : 1,
                              }}>
                                {isUpdating && <span style={{ display: "inline-block", animation: "pcal-spin 1s linear infinite", marginRight: 2 }}>↻</span>}
                                {truncateTitle(seg.title, Math.max(labelDuration, 1), dayWidth)}
                              </span>
                            )}
                            {/* 상위 항목 디스클로저 토글 — 펼치면 하위 항목이 그 아래 막대로 표시됨 */}
                            {hasChildren && seg.isStart && (() => {
                              const expanded = expandedParents.has(seg.id);
                              return (
                                <button
                                  title={`하위 항목 ${segChildren!.length}개 ${expanded ? "접기" : "펼치기"}`}
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setExpandedParents((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(seg.id)) next.delete(seg.id); else next.add(seg.id);
                                      return next;
                                    });
                                  }}
                                  style={{
                                    position: "absolute", left: 2, top: "50%", transform: "translateY(-50%)",
                                    width: 11, height: 11, padding: 0, border: "none", background: "transparent",
                                    color: "rgba(255,255,255,0.95)", fontSize: 8, lineHeight: 1, cursor: "pointer",
                                    display: "flex", alignItems: "center", justifyContent: "center", zIndex: 320,
                                  }}
                                >{expanded ? "▼" : "▶"}</button>
                              );
                            })()}

                            {/* Import to Notion button (GCal events only) — 노션으로 가져오고 구글 일정은 삭제 */}
                            {isHovered && seg.isStart && seg.isGCal && config && configId !== "preview" && (
                              <button
                                title="노션으로 가져오기 (구글 일정은 삭제)"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  importToNotion(seg);
                                }}
                                style={{
                                  position: "absolute",
                                  right: seg.isEnd ? 10 : 2,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  fontSize: 7,
                                  padding: "1px 4px",
                                  background: primaryColor,
                                  color: "white",
                                  border: "none",
                                  borderRadius: 3,
                                  cursor: "pointer",
                                  zIndex: 300,
                                  lineHeight: 1.4,
                                  fontWeight: 700,
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {importingId === seg.id ? "..." : "→N"}
                              </button>
                            )}

                            {/* 막대 위에 떠 있는 작은 버튼들: 강조 토글 + 플래너 보내기 (Notion 시작 세그먼트, 호버) */}
                            {isHovered && seg.isStart && !seg.isGCal && config && configId !== "preview" && !isDragging && (() => {
                              const showHighlight = !!config.notionConfig.highlightProperty;
                              const showSend = !!config.notionConfig.plannerDbId && !seg.sent;
                              if (!showHighlight && !showSend) return null;
                              const iconBtn: React.CSSProperties = {
                                padding: 0, border: "none", background: "transparent", cursor: "pointer",
                                lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center",
                                color: "rgba(255,255,255,0.8)",
                              };
                              return (
                                <>
                                  {/* 별표: 막대 세로 중앙에 겹쳐 표시 */}
                                  {showHighlight && (
                                    <button
                                      title={seg.highlighted ? "강조 해제" : "강조"}
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => { e.stopPropagation(); toggleHighlight(seg.id, !seg.highlighted); }}
                                      style={{ ...iconBtn, position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", fontSize: 12, opacity: seg.highlighted ? 1 : 0.45, zIndex: 320 }}
                                    >★</button>
                                  )}
                                  {/* 보내기: 막대 아래(별표 위치 바로 아래)에 표시. 막대 하단에 밀착(top:100%)하고
                                      paddingTop으로 아이콘을 더 내려, 호버가 끊기지 않게 다리를 놓는다 */}
                                  {showSend && (
                                    <button
                                      title="플래너로 보내기"
                                      onPointerDown={(e) => e.stopPropagation()}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setSendPopup({ id: seg.id, title: seg.title });
                                        setSendText(""); setSendState("idle"); setSendError("");
                                        setSelectedPlannerIds(new Set()); setPlannerItems([]);
                                        loadPlannerItems();
                                      }}
                                      style={{ ...iconBtn, position: "absolute", right: 8, top: "100%", paddingTop: 5, alignItems: "flex-start", color: "#888", zIndex: 320 }}
                                    ><Send size={11} strokeWidth={2.5} style={{ transform: "scaleX(-1)" }} /></button>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        );
                      })}
                      {createInput?.dateStr === dateStr && (
                        <div style={{
                          position: "absolute",
                          top: `${createInput.row * ROW_HEIGHT}px`,
                          left: 2, right: 2, height: BAR_HEIGHT,
                          borderRadius: 4,
                          background: hexToRgba(primaryColor, 0.18),
                          border: `1.5px solid ${primaryColor}`,
                          display: "flex", alignItems: "center",
                          zIndex: 500,
                        }}>
                          <input
                            autoFocus
                            placeholder="제목..."
                            value={createInput.title}
                            onChange={(e) => setCreateInput((p) => p ? { ...p, title: e.target.value } : null)}
                            onBlur={() => setCreateInput(null)}
                            onKeyDown={(e) => {
                              if (e.key === "Escape") { setCreateInput(null); return; }
                              if (e.key === "Enter" && createInput.title.trim()) {
                                e.preventDefault();
                                const t = createInput.title.trim();
                                const tmpId = `__tmp__${Date.now()}`;
                                const tmpProject: ProjectSegment = {
                                  id: tmpId, title: t, startDate: dateStr, endDate: dateStr,
                                  color: (barColors[projects.length % barColors.length]) || "#FFB3BA",
                                  pageUrl: "#", isStart: true, isEnd: true, duration: 1, rowIndex: 0,
                                };
                                setCreateInput(null);
                                setProjects((prev) => [...prev, tmpProject]);
                                fetch("/api/create-event", {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({
                                    apiKey: config?.notionConfig.apiKey,
                                    databaseId: config?.notionConfig.databaseId,
                                    titleProperty: config?.notionConfig.titleProperty,
                                    dateProperty: config?.notionConfig.dateProperty,
                                    title: t, startDate: dateStr, endDate: dateStr,
                                  }),
                                })
                                  .then((r) => r.json())
                                  .then((d) => {
                                    if (d.success && d.id) {
                                      setProjects((prev) => prev.map((p) => p.id === tmpId ? { ...p, id: d.id, pageUrl: `https://notion.so/${d.id.replace(/-/g, "")}` } : p));
                                    } else {
                                      setProjects((prev) => prev.filter((p) => p.id !== tmpId));
                                    }
                                  })
                                  .catch(() => setProjects((prev) => prev.filter((p) => p.id !== tmpId)));
                              }
                            }}
                            style={{
                              background: "transparent", border: "none", outline: "none",
                              width: "100%", padding: "0 5px", fontSize: 10,
                              color: darkMode ? "#eee" : "#444", fontWeight: 600,
                            }}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={() => { setRowOverrides(new Map()); safeStorage.removeItem("pcal_row_overrides"); fetchProjects(); }} aria-label="Refresh"
          style={{
            cursor: "pointer", color: primaryColor, display: "flex",
            justifyContent: "center", alignItems: "center", transition: "all .2s",
            background: "none", border: "none", padding: "1px 2px", fontSize: 14,
            lineHeight: 1, opacity: 0.75, position: "absolute", right: 8, bottom: 10, zIndex: 30,
          }}
        >↻</button>
      </div>

      {tooltip.visible && (
        <div style={{
          position: "fixed", zIndex: 9999, padding: "4px 8px", borderRadius: 6,
          fontSize: 10, fontWeight: "bold", color: "#555", pointerEvents: "none",
          boxShadow: "2px 2px 8px rgba(0,0,0,.1)",
          transform: "translate(-50%, 15px)", whiteSpace: "nowrap",
          left: tooltip.x, top: tooltip.y,
          backgroundColor: tooltip.color ? hexToRgba(tooltip.color, 0.15) : "#fff",
          border: `1px solid ${tooltip.color ? hexToRgba(tooltip.color, 0.4) : "#eee"}`,
        }}>
          {tooltip.text}
        </div>
      )}

      {eventPopup && (() => {
        const popupW = 150, margin = 8;
        const vw = typeof window !== "undefined" ? window.innerWidth : 9999;
        // 가로: 클릭한 일정의 오른쪽(= 다음날 왼쪽)에 붙임. 넘치면 일정 왼쪽으로 플립
        let left = eventPopup.right;
        if (left + popupW + margin > vw) left = eventPopup.left - popupW;
        left = Math.min(Math.max(left, margin), vw - popupW - margin);
        // 세로 위치/높이는 useLayoutEffect(popupPos)에서 위젯 본문 영역 기준으로 계산. 측정 전에는 숨김.
        const top = popupPos?.top ?? eventPopup.top;
        const maxH = popupPos?.maxH ?? 9999;
        return (
        <div style={{ position: "fixed", inset: 0, zIndex: 10000 }} onClick={() => setEventPopup(null)}>
          <div
            ref={popupRef}
            style={{
              position: "fixed", left, top,
              background: "#fff", borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.15)",
              border: "1px solid #eee", padding: "4px 0", minWidth: popupW, zIndex: 10001,
              opacity: popupPos ? 1 : 0,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ maxHeight: maxH, overflowY: "auto" }}>
            {visibleGroupOptions.map((opt) => {
              const isCurrent = eventPopup.group === opt;
              return (
                <div
                  key={opt}
                  style={{
                    padding: "4px 10px", fontSize: 11, cursor: "pointer",
                    fontWeight: isCurrent ? 700 : 400,
                    color: isCurrent ? primaryColor : "#444",
                    background: isCurrent ? hexToRgba(primaryColor, 0.08) : "transparent",
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) (e.currentTarget as HTMLElement).style.background = "#f5f5f5"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = isCurrent ? hexToRgba(primaryColor, 0.08) : "transparent"; }}
                  onClick={() => {
                    const pid = eventPopup.id;
                    const prevGroup = eventPopup.group;
                    const prevProject = projects.find((p) => p.id === pid);
                    const prevColor = prevProject?.color;
                    const newColor = groupColorOverrides[opt]
                      || (!opt.trim() ? groupColorOverrides["__none__"] : undefined)
                      || barColors[groupOptions.indexOf(opt) % barColors.length]
                      || prevColor;
                    setEventPopup(null);
                    // Optimistic update: group + color
                    setProjects((ps) => ps.map((p) => p.id === pid ? { ...p, group: opt, color: newColor ?? p.color } : p));

                    // Determine what property/type/value to send
                    const isRollup = groupPropType === "rollup";
                    const isRelation = groupPropType === "relation";
                    const propToWrite = (isRollup && groupWriteProp) ? groupWriteProp : config?.notionConfig.groupProperty;
                    const propTypeToWrite = (isRollup || isRelation) ? "relation" : groupPropType;
                    const pageIdForRelation = groupOptionIds[opt];

                    // For rollup/relation: we MUST have a pageId; without it, we can't update
                    if ((isRollup || isRelation) && !pageIdForRelation) {
                      // No pageId available — silently revert (can't update without a valid page ID)
                      setProjects((ps) => ps.map((p) => p.id === pid ? { ...p, group: prevGroup, color: prevColor ?? p.color } : p));
                      return;
                    }

                    const valueToSend = (isRollup || isRelation) ? pageIdForRelation! : opt;
                    fetch("/api/update-event", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({
                        apiKey: config?.notionConfig.apiKey,
                        pageId: pid,
                        property: propToWrite,
                        value: valueToSend,
                        propType: propTypeToWrite,
                      }),
                    })
                      .then((r) => r.json())
                      .then((d) => {
                        if (!d.success) setProjects((ps) => ps.map((p) => p.id === pid ? { ...p, group: prevGroup, color: prevColor ?? p.color } : p));
                      })
                      .catch(() => setProjects((ps) => ps.map((p) => p.id === pid ? { ...p, group: prevGroup, color: prevColor ?? p.color } : p)));
                  }}
                >
                  {opt}
                </div>
              );
            })}
            </div>
          </div>
        </div>
        );
      })()}

      {/* 플래너로 보내기 모달 */}
      {sendPopup && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 10002, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center" }}
          onClick={() => { if (sendState !== "sending") { setSendPopup(null); setSendText(""); setSendState("idle"); } }}
        >
          <div
            style={{ background: "#fff", borderRadius: 14, padding: 20, width: 320, maxWidth: "90vw", boxShadow: "0 10px 40px rgba(0,0,0,0.2)" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontSize: 14, fontWeight: 700, color: "#333", marginBottom: 4 }}>📤 플래너로 보내기</div>
            <div style={{ fontSize: 12, color: "#888", marginBottom: 12, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {sendPopup.title || "제목 없음"}
            </div>
            <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 6 }}>
              하위 항목 (한 줄에 하나씩, 비우면 제목 그대로 1개)
            </label>
            <textarea
              value={sendText}
              onChange={(e) => setSendText(e.target.value)}
              placeholder={"예) 1장 읽기\n2장 읽기"}
              rows={5}
              autoFocus
              style={{
                width: "100%", boxSizing: "border-box", padding: 10, fontSize: 13,
                border: "1px solid #e5e5e7", borderRadius: 8, outline: "none", resize: "vertical",
                fontFamily: "inherit", marginBottom: 12,
              }}
            />
            {/* 기존 플래너 항목 토글 선택 */}
            <label style={{ fontSize: 11, color: "#888", display: "block", marginBottom: 6 }}>
              기존 플래너 항목 연결 {plannerItemsLoading ? "(불러오는 중…)" : selectedPlannerIds.size > 0 ? `(${selectedPlannerIds.size}개 선택)` : "(선택)"}
            </label>
            {plannerItems.length > 0 ? (
              <div style={{ maxHeight: 140, overflowY: "auto", border: "1px solid #eee", borderRadius: 8, marginBottom: 12 }}>
                {plannerItems.map((it) => {
                  const on = selectedPlannerIds.has(it.id);
                  return (
                    <div
                      key={it.id}
                      onClick={() => setSelectedPlannerIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(it.id)) next.delete(it.id); else next.add(it.id);
                        return next;
                      })}
                      style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                        cursor: "pointer", fontSize: 12, color: "#444",
                        background: on ? hexToRgba(primaryColor, 0.08) : "transparent",
                      }}
                      onMouseEnter={(e) => { if (!on) (e.currentTarget as HTMLElement).style.background = "#f7f7f7"; }}
                      onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = on ? hexToRgba(primaryColor, 0.08) : "transparent"; }}
                    >
                      <div style={{
                        width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                        border: `1.5px solid ${on ? primaryColor : "#ccc"}`, background: on ? primaryColor : "transparent",
                        display: "flex", alignItems: "center", justifyContent: "center",
                      }}>
                        {on && <span style={{ color: "#fff", fontSize: 10, lineHeight: 1 }}>✓</span>}
                      </div>
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", textDecoration: it.done ? "line-through" : "none", opacity: it.done ? 0.6 : 1 }}>
                        {it.title}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              !plannerItemsLoading && (
                <div style={{ fontSize: 11, color: "#bbb", marginBottom: 12 }}>불러올 기존 항목이 없습니다.</div>
              )
            )}
            {sendState === "error" && (
              <div style={{ fontSize: 12, color: "#e53e3e", marginBottom: 10, wordBreak: "break-word" }}>
                보내기에 실패했습니다.{sendError ? ` (${sendError})` : " 다시 시도해 주세요."}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                onClick={() => { setSendPopup(null); setSendText(""); setSendState("idle"); }}
                disabled={sendState === "sending"}
                style={{ padding: "8px 14px", fontSize: 13, border: "none", borderRadius: 8, background: "#eee", color: "#555", cursor: "pointer" }}
              >
                취소
              </button>
              <button
                onClick={sendToPlanner}
                disabled={sendState === "sending" || sendState === "done"}
                style={{ padding: "8px 16px", fontSize: 13, border: "none", borderRadius: 8, background: primaryColor, color: "#fff", fontWeight: 600, cursor: "pointer", opacity: sendState === "sending" ? 0.7 : 1 }}
              >
                {sendState === "sending" ? "보내는 중…" : sendState === "done" ? "완료 ✓" : "보내기"}
              </button>
            </div>
          </div>
        </div>
      )}

    </>
  );
}
