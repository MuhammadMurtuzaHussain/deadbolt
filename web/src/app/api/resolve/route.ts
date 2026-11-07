import { resolveAttempt } from "@/lib/runtime/pipeline";

export const maxDuration = 120;

/** The chain already allows one action per attempt. This stops paying for duplicate model runs. */
const running = new Set<string>();

/** Streams newline-delimited JSON so the lock animates as each defence decides. */
export async function POST(req: Request) {
  const { attempt } = (await req.json()) as { attempt?: string };
  if (!attempt) return Response.json({ error: "attempt is required" }, { status: 400 });
  if (running.has(attempt)) return Response.json({ error: "Already running" }, { status: 409 });
  running.add(attempt);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const write = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of resolveAttempt(attempt)) write(event);
      } catch (err) {
        write({ type: "error", message: err instanceof Error ? err.message : "The agent runtime failed." });
      } finally {
        running.delete(attempt);
      }
      controller.close();
    },
  });
  return new Response(stream, {
    headers: { "content-type": "application/x-ndjson", "cache-control": "no-store" },
  });
}
