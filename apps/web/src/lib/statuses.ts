/** A project's issue workflow: the statuses its issues can be in, in board column order. */
export type StatusCategory = "todo" | "in_progress" | "done";

export type ProjectStatus = {
  key: string;
  name: string;
  category: StatusCategory;
  position: number;
  /** Most issues the column holds before a move into it is refused, or null. */
  wip_limit?: number | null;
};

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

/** The statuses every project starts with. Their keys have fixed colours in the stylesheet. */
const BUILT_IN_KEYS = ["todo", "in_progress", "in_review", "done"];

/** A stylesheet class for a status's colour: built-in keys keep theirs, custom statuses use their category. */
export function statusClass(status: ProjectStatus): string {
  return BUILT_IN_KEYS.includes(status.key) ? status.key : status.category;
}

/** The label to show for a key the project may not define (for example after a status was deleted). */
export function fallbackLabel(key: string): string {
  return key.replaceAll("_", " ");
}
