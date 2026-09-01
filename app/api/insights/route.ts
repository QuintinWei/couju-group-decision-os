import { handleInsightRequest } from "../../../lib/insight-api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; }
  catch { return Response.json({ error: "请求内容无效" }, { status: 400 }); }
  const { getAuthenticatedStoredRoom } = await import("../../../lib/room-store");
  return handleInsightRequest(body, getAuthenticatedStoredRoom);
}
