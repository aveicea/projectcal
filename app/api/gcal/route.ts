import { NextRequest, NextResponse } from "next/server";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get("token");
  const action = searchParams.get("action");

  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // List all calendars
  if (action === "list") {
    const res = await fetch(
      "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  // Delete an event
  if (action === "delete") {
    const calendarId = searchParams.get("calendarId") || "primary";
    const eventId = searchParams.get("eventId");
    if (!eventId) return NextResponse.json({ error: "eventId required" }, { status: 400 });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
      { method: "DELETE", headers: { Authorization: `Bearer ${token}` } }
    );
    return NextResponse.json({ success: res.ok }, { status: res.ok ? 200 : res.status });
  }

  // Fetch events for a specific calendar
  const calendarId = searchParams.get("calendarId") || "primary";
  const timeMin = searchParams.get("timeMin");
  const timeMax = searchParams.get("timeMax");

  const params = new URLSearchParams({
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "500",
    ...(timeMin ? { timeMin } : {}),
    ...(timeMax ? { timeMax } : {}),
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function PATCH(req: NextRequest) {
  const { token, calendarId = "primary", eventId, patch } = await req.json();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(patch),
    }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}

export async function POST(req: NextRequest) {
  const { token, calendarId = "primary", event } = await req.json();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
