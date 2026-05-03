export interface Project {
  id: string;
  title: string;
  startDate: string;
  endDate: string;
  pageUrl: string;
  color?: string;
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

export function assignColors(
  projects: Project[],
  colors: string[] = DEFAULT_BAR_COLORS
): ProjectSegment[] {
  return projects.map((p, i) => ({
    ...p,
    color: colors[i % colors.length],
    isStart: false,
    isEnd: false,
    duration: 0,
    rowIndex: 0,
  }));
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

export function truncateTitle(title: string, duration: number): string {
  const maxChars = Math.max(4, Math.floor(Math.max(25 * duration - 12, 10) / 6));
  if (title.length <= maxChars) return title;
  return `${title.slice(0, Math.max(1, maxChars - 3))}...`;
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
