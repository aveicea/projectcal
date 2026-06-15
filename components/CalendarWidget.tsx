"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { ChevronLeft, ChevronRight, Link } from "lucide-react";
import {
  Project,
  ProjectSegment,
  DEFAULT_BAR_COLORS,
  getDaysInMonth,
  getDaysInWeek,
  getWeekStart,
  assignRows,
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
  initialGcalShowTimed,
  initialGcalColorOverrides,
  initialGcalBorderColorOverrides,
  initialGroupColors,
  widgetConfigStr,
}: CalendarWidgetProps) {
  const [centerYear, setCenterYear] = useState<number | null>(null);
  const [centerMonth, setCenterMonth] = useState<number | null>(null);
  const [todayStr, setTodayStr] = useState<string>("");
  const [weekStartStr, setWeekStartStr] = useState<string>("");

  useEffect(() => {
    const now = new Date();
    setCenterYear(now.getFullYear());
    setCenterMonth(now.getMonth());
    setTodayStr(now.toDateString());
    setWeekStartStr(formatDate(getWeekStart(now)));
  }, []);

  const [projects, setProjects] = useState<ProjectSegment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [rowOverrides, setRowOverrides] = useState<Map<string, number>>(new Map());
  const [dateOverrides, setDateOverrides] = useState<Map<string, { startDate: string; endDate: string }>>(new Map());
  const [dropDateStr, setDropDateStr] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState({ visible: false, x: 0, y: 0, text: "", color: "" });
  const bodyRef = useRef<HTMLDivElement>(null);
  const scrolledRef = useRef(false);
  const dragGrabDate = useRef<string | null>(null);
  const dragMode = useRef<"move" | "resize-start" | "resize-end" | null>(null);

  // ── GCal state ────────────────────────────────────────────────────────────
  const [gcalToken, setGcalToken] = useState<string | null>(null);
  const [gcalCalendars, setGcalCalendars] = useState<GCalCalendar[]>([]);
  const [selectedCalendarIds, setSelectedCalendarIds] = useState<Set<string>>(new Set());
  const [gcalProjects, setGcalProjects] = useState<AnySegment[]>([]);
  const [gcalLoading, setGcalLoading] = useState(false);
  const [showGCalPanel, setShowGCalPanel] = useState(false);
  const [syncingNotionId, setSyncingNotionId] = useState<string | null>(null);
  const [syncedIds, setSyncedIds] = useState<Set<string>>(new Set());
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

  // Load token + synced IDs from localStorage (or from URL-embedded token)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = localStorage.getItem("pcal_gcal_token");
    const expiry = localStorage.getItem("pcal_gcal_expiry");
    if (token && expiry && Date.now() < parseInt(expiry)) {
      setGcalToken(token);
    } else if (initialGcalToken) {
      // URL-embedded token (no expiry check — if expired, 401 handler will clear it)
      setGcalToken(initialGcalToken);
    }
    const synced = localStorage.getItem("pcal_synced_ids");
    if (synced) {
      try { setSyncedIds(new Set(JSON.parse(synced))); } catch { /* ignore */ }
    }
    const showTimed = localStorage.getItem("pcal_gcal_show_timed");
    if (showTimed === "true") setGcalShowTimed(true);
    else if (initialGcalShowTimed) setGcalShowTimed(true);

    const savedCalColors = localStorage.getItem("pcal_gcal_colors");
    if (savedCalColors) {
      try { setGcalColorOverrides({ ...JSON.parse(savedCalColors), ...initialGcalColorOverrides }); } catch { if (initialGcalColorOverrides) setGcalColorOverrides(initialGcalColorOverrides); }
    } else if (initialGcalColorOverrides) {
      setGcalColorOverrides(initialGcalColorOverrides);
    }

    const savedBorderColors = localStorage.getItem("pcal_gcal_border_colors");
    if (savedBorderColors) {
      try { setGcalBorderColorOverrides({ ...JSON.parse(savedBorderColors), ...initialGcalBorderColorOverrides }); } catch { if (initialGcalBorderColorOverrides) setGcalBorderColorOverrides(initialGcalBorderColorOverrides); }
    } else if (initialGcalBorderColorOverrides) {
      setGcalBorderColorOverrides(initialGcalBorderColorOverrides);
    }

    const savedGroupColors = localStorage.getItem("pcal_group_colors");
    if (savedGroupColors) {
      try { setGroupColorOverrides({ ...JSON.parse(savedGroupColors), ...initialGroupColors }); } catch { if (initialGroupColors) setGroupColorOverrides(initialGroupColors); }
    } else if (initialGroupColors) {
      setGroupColorOverrides(initialGroupColors);
    }

    const savedCalOrder = localStorage.getItem("pcal_gcal_order");
    if (savedCalOrder) {
      try { setGcalCalendarOrder(JSON.parse(savedCalOrder)); } catch { /* ignore */ }
    }

    const savedRowOverrides = localStorage.getItem("pcal_row_overrides");
    if (savedRowOverrides) {
      try {
        const obj = JSON.parse(savedRowOverrides) as Record<string, number>;
        setRowOverrides(new Map(Object.entries(obj).map(([k, v]) => [k, v])));
      } catch { /* ignore */ }
    }
  }, [initialGcalToken, initialGcalColorOverrides, initialGroupColors, initialGcalShowTimed]);

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
          const saved = localStorage.getItem("pcal_gcal_selected");
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
      .catch((e: unknown) => {
        if ((e as Error).message === "401") {
          setGcalToken(null);
          localStorage.removeItem("pcal_gcal_token");
        }
      });
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
      .catch((e: unknown) => {
        if (cancelled) return;
        if ((e as Error).message === "401") {
          setGcalToken(null);
          localStorage.removeItem("pcal_gcal_token");
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
      response_type: "token",
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
        const { token, expiresIn } = event.data as { type: string; token: string; expiresIn: string };
        const expiry = Date.now() + parseInt(expiresIn) * 1000 - 60000;
        localStorage.setItem("pcal_gcal_token", token);
        localStorage.setItem("pcal_gcal_expiry", String(expiry));
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
    localStorage.removeItem("pcal_gcal_token");
    localStorage.removeItem("pcal_gcal_expiry");
    localStorage.removeItem("pcal_gcal_selected");
  };

  const toggleCalendar = (calId: string) => {
    setSelectedCalendarIds((prev) => {
      const next = new Set(prev);
      if (next.has(calId)) next.delete(calId);
      else next.add(calId);
      localStorage.setItem("pcal_gcal_selected", JSON.stringify([...next]));
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
        localStorage.removeItem("pcal_gcal_token");
        return;
      }
      if (res.ok) {
        setSyncedIds((prev) => {
          const next = new Set([...prev, project.id]);
          localStorage.setItem("pcal_synced_ids", JSON.stringify([...next]));
          return next;
        });
      }
    } catch (e) {
      console.error("Sync error:", e);
    } finally {
      setSyncingNotionId(null);
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
        localStorage.removeItem("pcal_gcal_token");
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

  const fetchProjects = useCallback(async () => {
    if (centerYear === null || centerMonth === null) return;
    setLoading(true);
    setError(null);

    const applyGroupColors = (segs: ReturnType<typeof assignColors>) => {
      if (Object.keys(groupColorOverrides).length === 0) return segs;
      return segs.map((p) => ({
        ...p,
        color: (p.group && groupColorOverrides[p.group]) || p.color,
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
            },
            startDate: fetchStart,
            endDate: fetchEnd,
          }),
        });
        if (!res.ok) throw new Error("Failed to fetch");
        const json = await res.json();
        setProjects(json.success && json.data ? applyGroupColors(assignColors(json.data, barColors)) : []);
      } catch (e) {
        console.error(e);
        setError("프로젝트를 불러올 수 없습니다.");
        setProjects([]);
      } finally {
        setLoading(false);
      }
      return;
    }

    setLoading(false);
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

  const formatShortDate = (dateStr: string) => {
    const d = new Date(dateStr + "T00:00:00");
    return `${d.getMonth() + 1}/${d.getDate()}`;
  };

  // ── Layout computation ────────────────────────────────────────────────────

  // Apply date overrides to both Notion and GCal events
  // Hide Notion events that have been synced to GCal (show GCal version instead)
  const effectiveNotionProjects: AnySegment[] = projects
    .filter((p) => !gcalSyncedNotionIds.has(p.id))
    .map((p) => {
      const o = dateOverrides.get(p.id);
      return o ? { ...p, ...o } : p;
    });

  const effectiveGCalProjects: AnySegment[] = gcalProjects.map((p) => {
    const o = dateOverrides.get(p.id);
    return o ? { ...p, ...o } : p;
  });

  const allDisplayProjects: AnySegment[] = [...effectiveGCalProjects, ...effectiveNotionProjects];

  const rowMap = assignRows(allDisplayProjects as ProjectSegment[], multiRow);
  const effectiveRowMap = new Map(rowMap);
  rowOverrides.forEach((row, id) => {
    if (effectiveRowMap.has(id)) effectiveRowMap.set(id, row);
  });

  const rowValues = Array.from(effectiveRowMap.values());
  const maxRow = rowValues.length > 0 ? Math.max(...rowValues) + 1 : 1;
  const totalRows = Math.max(dragId ? Math.max(maxRow, 2) : maxRow, 1);

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

      <div style={{
        fontFamily: font, background: bgColor,
        border: darkMode ? "none" : `1px solid ${primaryColor}`,
        outline: darkMode ? "none" : `2px solid ${headerBg}`,
        boxShadow: darkMode ? "none" : `2px 2px 0px ${primaryColor}4D, 4px 4px 12px ${primaryColor}26`,
        borderRadius: 10, overflow: "hidden", userSelect: "none",
        width: "fit-content", maxWidth: "98vw",
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
            <Link size={12} strokeWidth={2.5} />
            {headerLabel} Timeline
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
                href={`/onboarding?from=${widgetConfigStr}`}
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
              <div style={{ maxHeight: 320, overflowY: "auto" }}>
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
                        localStorage.setItem("pcal_gcal_order", JSON.stringify(allIds));
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
                          localStorage.setItem("pcal_gcal_colors", JSON.stringify(next));
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
                            localStorage.setItem("pcal_gcal_border_colors", JSON.stringify(next));
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
                  localStorage.setItem("pcal_gcal_show_timed", String(next));
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
            <div style={{ display: "flex", padding: "0 12px", minWidth: "min-content" }}>
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
                  <div key={dateStr} style={{
                    display: "flex", flexDirection: "column", alignItems: "center",
                    width: dayWidth, flexShrink: 0,
                  }}>
                    {/* Date header */}
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: 6, height: 34, position: "relative", opacity: isCurrWeek ? 1 : 0.55 }}>
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
                      style={{
                        height: `${totalRows * ROW_HEIGHT}px`, width: "100%", position: "relative",
                        background: isColDrop ? hexToRgba(primaryColor, 0.12) : "transparent",
                        transition: "background 0.1s",
                        borderRadius: 4,
                      }}
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                        setDropDateStr(dateStr);
                      }}
                      onDragLeave={() => setDropDateStr(null)}
                      onDrop={(e) => {
                        e.preventDefault();
                        const sourceId = e.dataTransfer.getData("application/x-project-id") || e.dataTransfer.getData("text/plain") || dragId || "";
                        if (!sourceId) { setDragId(null); setDropDateStr(null); dragMode.current = null; dragGrabDate.current = null; return; }

                        const mode = dragMode.current;
                        const project = allDisplayProjects.find((p) => p.id === sourceId);

                        if (project?.isGCal) {
                          // GCal event drag → update in Google Calendar
                          if (mode === "move" && dragGrabDate.current) {
                            const zoneRect = e.currentTarget.getBoundingClientRect();
                            const dropRow = Math.max(0, Math.floor((e.clientY - zoneRect.top) / ROW_HEIGHT));
                            const delta = daysBetween(dragGrabDate.current, dateStr);
                            if (delta !== 0) {
                              const newStart = addDays(project.startDate, delta);
                              const newEnd = addDays(project.endDate, delta);
                              setDateOverrides((prev) => { const next = new Map(prev); next.set(sourceId, { startDate: newStart, endDate: newEnd }); return next; });
                              updateGCalEvent(project, newStart, newEnd);
                            }
                            setRowOverrides((prev) => {
                              const next = bumpRows(sourceId, dropRow, prev);
                              const obj: Record<string, number> = {};
                              next.forEach((v, k) => { obj[k] = v; });
                              localStorage.setItem("pcal_row_overrides", JSON.stringify(obj));
                              return next;
                            });
                          } else if (mode === "resize-end") {
                            const newEnd = dateStr >= project.startDate ? dateStr : project.startDate;
                            setDateOverrides((prev) => { const next = new Map(prev); next.set(sourceId, { startDate: project.startDate, endDate: newEnd }); return next; });
                            updateGCalEvent(project, project.startDate, newEnd);
                          } else if (mode === "resize-start") {
                            const newStart = dateStr <= project.endDate ? dateStr : project.endDate;
                            setDateOverrides((prev) => { const next = new Map(prev); next.set(sourceId, { startDate: newStart, endDate: project.endDate }); return next; });
                            updateGCalEvent(project, newStart, project.endDate);
                          }
                        } else if (project) {
                          // Notion event drag (local only)
                          if (mode === "move" && dragGrabDate.current) {
                            // Compute target row from drop Y position
                            const zoneRect = e.currentTarget.getBoundingClientRect();
                            const dropRow = Math.max(0, Math.floor((e.clientY - zoneRect.top) / ROW_HEIGHT));
                            const delta = daysBetween(dragGrabDate.current, dateStr);
                            if (delta !== 0) {
                              setDateOverrides((prev) => { const next = new Map(prev); next.set(sourceId, { startDate: addDays(project.startDate, delta), endDate: addDays(project.endDate, delta) }); return next; });
                            }
                            setRowOverrides((prev) => {
                              const next = bumpRows(sourceId, dropRow, prev);
                              const obj: Record<string, number> = {};
                              next.forEach((v, k) => { obj[k] = v; });
                              localStorage.setItem("pcal_row_overrides", JSON.stringify(obj));
                              return next;
                            });
                          } else if (mode === "resize-end") {
                            const newEnd = dateStr >= project.startDate ? dateStr : project.startDate;
                            setDateOverrides((prev) => { const next = new Map(prev); next.set(sourceId, { startDate: project.startDate, endDate: newEnd }); return next; });
                          } else if (mode === "resize-start") {
                            const newStart = dateStr <= project.endDate ? dateStr : project.endDate;
                            setDateOverrides((prev) => { const next = new Map(prev); next.set(sourceId, { startDate: newStart, endDate: project.endDate }); return next; });
                          }
                        }
                        setDragId(null); setDropDateStr(null); dragMode.current = null; dragGrabDate.current = null;
                      }}
                    >
                      {segments.map((seg) => {
                        const isHovered = hoveredId === seg.id;
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

                        const bgC = seg.isGCal
                          ? gcalColor
                          : isHovered ? seg.color : hexToRgba(seg.color, 0.55);

                        return (
                          <div
                            key={seg.id}
                            style={{
                              height: BAR_HEIGHT, display: "flex", alignItems: "center",
                              justifyContent: "center", position: "absolute", color: "white",
                              fontSize: 10, fontWeight: "bold", overflow: "visible",
                              transition: "background-color .2s",
                              cursor: isDragging ? "grabbing" : "grab",
                              left: 0, zIndex: zIdx, backgroundColor: bgC,
                              top: `${row * ROW_HEIGHT}px`,
                              ...shapeStyle,
                              ...(isDragging ? { opacity: 0.3 } : isUpdating ? { opacity: 0.6 } : { opacity: segOpacity }),
                              ...gcalOutlineStyle,
                            }}
                            draggable={!isUpdating}
                            onDragStart={(e) => {
                              dragMode.current = "move";
                              dragGrabDate.current = dateStr;
                              setDragId(seg.id);
                              setDropDateStr(null);
                              e.dataTransfer.effectAllowed = "move";
                              e.dataTransfer.setData("application/x-project-id", seg.id);
                              e.dataTransfer.setData("text/plain", seg.id);
                            }}
                            onDragEnd={() => {
                              setDragId(null); setDropDateStr(null);
                              dragMode.current = null; dragGrabDate.current = null;
                            }}
                            onMouseEnter={(e) => {
                              setHoveredId(seg.id);
                              setTooltip({
                                visible: true, x: e.clientX, y: e.clientY,
                                text: `${seg.title}  ${formatShortDate(seg.startDate)} ~ ${formatShortDate(seg.endDate)}`,
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
                                draggable
                                style={{
                                  position: "absolute", left: 0, top: 0, width: 7, height: "100%",
                                  cursor: "ew-resize", zIndex: 20,
                                  borderTopLeftRadius: 4, borderBottomLeftRadius: 4,
                                  background: "transparent",
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  dragMode.current = "resize-start";
                                  setDragId(seg.id);
                                  setDropDateStr(null);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("application/x-project-id", seg.id);
                                  e.dataTransfer.setData("text/plain", seg.id);
                                }}
                                onDragEnd={(e) => {
                                  e.stopPropagation();
                                  setDragId(null); setDropDateStr(null);
                                  dragMode.current = null;
                                }}
                              />
                            )}

                            {/* Right resize handle */}
                            {seg.isEnd && (
                              <div
                                draggable
                                style={{
                                  position: "absolute", right: 0, top: 0, width: 7, height: "100%",
                                  cursor: "ew-resize", zIndex: 20,
                                  borderTopRightRadius: 4, borderBottomRightRadius: 4,
                                  background: "transparent",
                                }}
                                onMouseDown={(e) => e.stopPropagation()}
                                onDragStart={(e) => {
                                  e.stopPropagation();
                                  dragMode.current = "resize-end";
                                  setDragId(seg.id);
                                  setDropDateStr(null);
                                  e.dataTransfer.effectAllowed = "move";
                                  e.dataTransfer.setData("application/x-project-id", seg.id);
                                  e.dataTransfer.setData("text/plain", seg.id);
                                }}
                                onDragEnd={(e) => {
                                  e.stopPropagation();
                                  setDragId(null); setDropDateStr(null);
                                  dragMode.current = null;
                                }}
                              />
                            )}

                            {/* Label */}
                            {showLabel && (
                              <span style={{
                                position: "absolute", left: 2, display: "flex",
                                justifyContent: "flex-start", alignItems: "center",
                                whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                pointerEvents: "none", fontSize: 9,
                                color: labelColor,
                                height: "100%", boxSizing: "border-box", padding: "0 6px",
                                width: `${Math.max(dayWidth * Math.max(labelDuration, 1) - 4, 21)}px`,
                                zIndex: isHovered ? 201 : 3,
                              }}>
                                {isUpdating && <span style={{ display: "inline-block", animation: "pcal-spin 1s linear infinite", marginRight: 2 }}>↻</span>}
                                {truncateTitle(seg.title, Math.max(labelDuration, 1), dayWidth)}
                              </span>
                            )}

                            {/* Sync to GCal button (Notion events only, when GCal connected) */}
                            {isHovered && seg.isStart && !seg.isGCal && gcalToken && configId !== "preview" && (
                              <button
                                title={syncedIds.has(seg.id) ? "Google Calendar에 추가됨" : "Google Calendar에 추가"}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  syncToGCal(seg);
                                }}
                                style={{
                                  position: "absolute",
                                  right: seg.isEnd ? 10 : 2,
                                  top: "50%",
                                  transform: "translateY(-50%)",
                                  fontSize: 7,
                                  padding: "1px 4px",
                                  background: syncedIds.has(seg.id) ? "#34A853" : primaryColor,
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
                                {syncingNotionId === seg.id ? "..." : syncedIds.has(seg.id) ? "✓" : "→G"}
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <button onClick={() => { setRowOverrides(new Map()); localStorage.removeItem("pcal_row_overrides"); fetchProjects(); }} aria-label="Refresh"
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
    </>
  );
}
