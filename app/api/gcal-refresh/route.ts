import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  const { refresh_token } = await req.json();
  if (!refresh_token) {
    return NextResponse.json({ error: "Missing refresh_token" }, { status: 400 });
  }

  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "Google credentials not configured" }, { status: 500 });
  }

  const params = new URLSearchParams({
    refresh_token,
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "refresh_token",
  });

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
