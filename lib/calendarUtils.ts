export interface Project {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  pageUrl: string;
  color?: string;
  group?: string;
}

export interface ProjectSegment extends Project {
  color: string;
  isStart: boolean;
  isEnd: boolean;
  duration: number;
  rowIndex: number;
}

export interface DayInfo {
  dateObj: Date;
  day: number;
  dateStr: string;
  dayName: string;
}

export const DEFAULT_BAR_COLORS = [
  "#FFB3BA",
  "#E2D1F0",
  "#C6EBC5",
  "#FFDFBA",
  "#BAE1FF",
  "#FFD1DC",
  "#B5EAD7",
  "#FFDAC1",
];

export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function getDaysInMonth(year: number, month: number): DayInfo[] {
  return Array.from(
    { length: new Date(year, month + 1, 0).getDate() },
    (_, i) => {
      const dateObj = new Date(year, month, i + 1);
      return {
        dateObj,
        day: i + 1,
        dateStr: formatDate(dateObj),
        dayName: dateObj.toLocaleDateString("en-US", { weekday: "narrow" }),
      };
    }
  );
}

export function getSegmentsForDay(
  projects: ProjectSegment[],
  dateStr: string
): ProjectSegment[] {
  return projects
    .filter((p) => dateStr >= p.startDate && dateStr <= p.endDate)
    .map((p) => {
      const isStart = dateStr === p.startDate;
      const isEnd = dateStr === p.endDate;
      let duration = 0;
      if (isStart) {
        const start = new Date(p.startDate);
        duration =
          Math.round(
            (new Date(p.endDate).getTime() - start.getTime()) / 86400000
          ) + 1;
      }
      return { ...p, isStart, isEnd, duration, rowIndex: 0 };
    });
}

export function assignRows(
  projects: ProjectSegment[],
  multiRow: boolean
): Map<string, number> {
  const rowMap = new Map<string, number>();
  const sorted = [...projects].sort(
    (a, b) =>
      a.startDate.localeCompare(b.startDate) ||
      a.endDate.localeCompare(b.endDate)
  );
  const rowEnds: string[] = [];

  for (const p of sorted) {
    let placed = false;
    for (let row = 0; row < rowEnds.length; row++) {
      if (p.startDate > rowEnds[row]) {
        rowMap.set(p.id, row);
        rowEnds[row] = p.endDate;
        placed = true;
        break;
      }
    }
    if (!placed) {
      if (!multiRow) {
        for (let row = 0; row < rowEnds.length; row++) {
          const occupied = sorted.some(
            (other) =>
              rowMap.get(other.id) === row &&
              other.startDate === p.startDate &&
              other.endDate === p.endDate
          );
          if (!occupied) {
            rowMap.set(p.id, row);
            if (p.endDate > rowEnds[row]) rowEnds[row] = p.endDate;
            placed = true;
            break;
          }
        }
      }
      if (!placed) {
        rowMap.set(p.id, rowEnds.length);
        rowEnds.push(p.endDate);
      }
    }
  }
  return rowMap;
}

// Groups events by group value, assigns same color to same group.
export function assignColors(
  projects: Project[],
  colors: string[] = DEFAULT_BAR_COLORS,
  useGroupColors = false,
): ProjectSegment[] {
  if (useGroupColors) {
    const groupColorMap = new Map<string, string>();
    let idx = 0;
    return projects.map((p) => {
      const key = p.group?.trim() ? p.group : `__id__${p.id}`;
      if (!groupColorMap.has(key)) groupColorMap.set(key, colors[idx++ % colors.length]);
      return { ...p, color: groupColorMap.get(key)!, isStart: false, isEnd: false, duration: 0, rowIndex: 0 };
    });
  }
  return projects.map((p, i) => ({
    ...p,
    color: colors[i % colors.length],
    isStart: false,
    isEnd: false,
    duration: 0,
    rowIndex: 0,
  }));
}

// Group-aware row assignment:
// - Same-group events stay in a contiguous band of rows
// - Groups pack into the lowest available band (no time conflict)
// - Minimizes total rows while keeping same-group events together
export function assignRowsGrouped(projects: ProjectSegment[]): Map<string, number> {
  if (projects.length === 0) return new Map();

  const groups = new Map<string, ProjectSegment[]>();
  for (const p of projects) {
    const key = p.group?.trim() || "__ungrouped__";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(p);
  }

  const groupLocalRows = new Map<string, Map<string, number>>();
  for (const [key, gp] of groups) {
    const sorted = [...gp].sort((a, b) => a.startDate.localeCompare(b.startDate));
    const localMap = new Map<string, number>();
    const ends: string[] = [];
    for (const p of sorted) {
      let placed = false;
      for (let r = 0; r < ends.length; r++) {
        if (p.startDate > ends[r]) {
          localMap.set(p.id, r);
          ends[r] = p.endDate;
          placed = true;
          break;
        }
      }
      if (!placed) { localMap.set(p.id, ends.length); ends.push(p.endDate); }
    }
    groupLocalRows.set(key, localMap);
  }

  const sortedGroups = [...groups.entries()].sort(([, a], [, b]) => {
    const minA = a.reduce((m, p) => (p.startDate < m ? p.startDate : m), a[0].startDate);
    const minB = b.reduce((m, p) => (p.startDate < m ? p.startDate : m), b[0].startDate);
    return minA.localeCompare(minB);
  });

  const result = new Map<string, number>();
  const rowOcc = new Map<number, Array<{ s: string; e: string }>>();

  const conflicts = (row: number, start: string, end: string) => {
    const occ = rowOcc.get(row);
    return occ ? occ.some((o) => start <= o.e && end >= o.s) : false;
  };

  for (const [key, gp] of sortedGroups) {
    const localMap = groupLocalRows.get(key)!;
    let baseRow = 0;
    outer: while (true) {
      for (const p of gp) {
        if (conflicts(baseRow + localMap.get(p.id)!, p.startDate, p.endDate)) {
          baseRow++;
          continue outer;
        }
      }
      break;
    }
    for (const p of gp) {
      const globalRow = baseRow + localMap.get(p.id)!;
      result.set(p.id, globalRow);
      if (!rowOcc.has(globalRow)) rowOcc.set(globalRow, []);
      rowOcc.get(globalRow)!.push({ s: p.startDate, e: p.endDate });
    }
  }

  return result;
}

export function hexToRgba(hex: string, alpha: number): string {
  if (!hex || !/^#([0-9A-F]{3}){1,2}$/i.test(hex)) return hex || "#ffffff";
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${255 & n}, ${alpha})`;
}

export function lightenColor(hex: string, factor: number): string {
  if (!hex || !/^#([0-9A-F]{3}){1,2}$/i.test(hex)) return hex || "#ffffff";
  const n = parseInt(hex.replace("#", ""), 16);
  const r = Math.min(255, Math.floor(((n >> 16) & 255) + (255 - ((n >> 16) & 255)) * 0.85));
  const g = Math.min(255, Math.floor(((n >> 8) & 255) + (255 - ((n >> 8) & 255)) * 0.85));
  const b = Math.min(255, Math.floor((255 & n) + (255 - (255 & n)) * factor));
  return `rgb(${r}, ${g}, ${b})`;
}

export function hexToRgbaBackground(hex: string, opacity: number): string {
  if (!hex || hex === "transparent") return "transparent";
  if (hex.startsWith("rgba")) return hex;
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity / 100})`;
}

export function truncateTitle(title: string, duration: number, dayWidth = 25): string {
  const maxChars = Math.max(4, Math.floor(Math.max(dayWidth * duration - 12, 10) / 6));
  if (title.length <= maxChars) return title;
  return `${title.slice(0, Math.max(1, maxChars - 3))}...`;
}

export function getWeekStart(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1)); // Monday
  return d;
}

export function getDaysInWeek(weekStartDate: Date): DayInfo[] {
  return Array.from({ length: 7 }, (_, i) => {
    const dateObj = new Date(weekStartDate);
    dateObj.setDate(weekStartDate.getDate() + i);
    return {
      dateObj,
      day: dateObj.getDate(),
      dateStr: formatDate(dateObj),
      dayName: dateObj.toLocaleDateString("en-US", { weekday: "short" }),
    };
  });
}

export function getFontFamily(fontFamily: string): string {
  switch (fontFamily) {
    case "Galmuri11":
      return "'Galmuri11', monospace";
    case "Corbel":
      return "'Corbel', sans-serif";
    default:
      return "'Pretendard', -apple-system, sans-serif";
  }
}
