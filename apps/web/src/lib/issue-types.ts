/** A project's issue types. The key is stored on issues; the name and icon are for display. */
export type IssueType = {
  key: string;
  name: string;
  /** One of: task, bug, story, epic, feature, improvement, incident, request. */
  icon: string;
  /** 0 for standard work, 1 for epic-level work that groups children. */
  hierarchy_level: number;
  position: number;
};

/** Shown until a project's types load, and for a key the project no longer defines. */
export const FALLBACK_TYPES: IssueType[] = [
  { key: "task", name: "Task", icon: "task", hierarchy_level: 0, position: 0 },
  { key: "bug", name: "Bug", icon: "bug", hierarchy_level: 0, position: 1 },
  { key: "story", name: "Story", icon: "story", hierarchy_level: 0, position: 2 },
  { key: "epic", name: "Epic", icon: "epic", hierarchy_level: 1, position: 3 },
];

/** The type a new issue gets: the first standard type by position. */
export function defaultTypeKey(types: IssueType[]): string {
  const standard = types.filter((t) => t.hierarchy_level === 0).sort((a, b) => a.position - b.position);
  return (standard[0] ?? types[0] ?? FALLBACK_TYPES[0]).key;
}

export function typeName(types: IssueType[], key: string): string {
  return types.find((t) => t.key === key)?.name ?? key.replaceAll("_", " ");
}
