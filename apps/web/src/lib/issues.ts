/** Issue-list helpers shared by the work views and the advanced panels. */
import { requestWithHeaders } from "./api";
import type { Issue } from "./types";

/** Issues come in pages of 200, following the `X-Next-Cursor` header. The client stops after
 * `ISSUE_MAX_PAGES` (10,000 issues) and warns in the console; the API also takes filters for
 * narrower views. */
export const ISSUE_PAGE_SIZE = 200;
export const ISSUE_MAX_PAGES = 50;

/** Every active issue in a project (or every archived one when `archived` is set). */
export async function loadIssues(token: string, projectId: string, archived = false): Promise<Issue[]> {
  const all: Issue[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < ISSUE_MAX_PAGES; page++) {
    const params = new URLSearchParams({ limit: String(ISSUE_PAGE_SIZE) });
    if (archived) params.set("archived", "true");
    if (cursor) params.set("cursor", cursor);
    const { data, headers }: { data: Issue[]; headers: Headers } = await requestWithHeaders<Issue[]>(
      token,
      `/projects/${projectId}/issues?${params.toString()}`,
    );
    all.push(...data);
    cursor = headers.get("x-next-cursor");
    if (!cursor) return all;
  }
  console.warn(`Showing the first ${all.length} issues; this project has more.`);
  return all;
}

/** A personal filter preset. Filter keys: status, priority, assignee_id, q. */
export type SavedView = {
  id: string;
  project_id: string;
  name: string;
  filters: Record<string, string>;
  created_at: string;
  updated_at: string;
};

export type BulkItemResult = { id: string; ok: boolean; error?: string | null };
export type BulkResult = { updated: number; results: BulkItemResult[] };
export type NotificationKind = "approval" | "automation";
export type NotificationPreference = { kind: NotificationKind; enabled: boolean };
