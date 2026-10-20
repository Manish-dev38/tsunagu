import { toNextJsHandler } from "corsair";
import { getClient } from "@/server/corsair/client";

let handlers: ReturnType<typeof toNextJsHandler> | undefined;

function getHandlers() {
  handlers ??= toNextJsHandler(getClient(), { basePath: "/api/corsair" });
  return handlers;
}

export const GET = (req: Request) => getHandlers().GET(req);
export const POST = (req: Request) => getHandlers().POST(req);
export const OPTIONS = (req: Request) => getHandlers().OPTIONS(req);
