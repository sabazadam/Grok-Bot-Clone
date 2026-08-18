import { getSettings, saveSettings } from "@/lib/server/store";
import type { ProviderId, Settings } from "@/lib/types";
import { PROVIDERS } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  const settings = getSettings();
  return Response.json({
    timezone: settings.timezone,
    providers: Object.fromEntries(
      PROVIDERS.filter((id) => id !== "rehearsal").map((id) => [
        id,
        {
          hasKey: Boolean(settings.providers[id]?.apiKey),
          baseUrl: settings.providers[id]?.baseUrl || "",
        },
      ]),
    ),
  });
}

export async function PUT(request: Request) {
  const body = (await request.json()) as {
    timezone?: string;
    providers?: Partial<Record<ProviderId, { apiKey?: string; baseUrl?: string }>>;
  };
  const current = getSettings();
  const next: Settings = {
    timezone: body.timezone || current.timezone,
    providers: { ...current.providers },
  };
  for (const [key, value] of Object.entries(body.providers || {})) {
    const id = key as ProviderId;
    next.providers[id] = {
      apiKey: value?.apiKey || current.providers[id]?.apiKey,
      baseUrl: value?.baseUrl ?? current.providers[id]?.baseUrl,
    };
  }
  await saveSettings(next);
  return GET();
}
