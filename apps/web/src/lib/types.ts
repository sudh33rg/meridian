import type { components } from "../api-schema";

/** Wire types come from the generated OpenAPI schema (`npm run gen:api`); never hand-edit them. */
type S = components["schemas"];
export type Session = S["AuthResponse"];
export type Project = S["Project"];
export type Issue = S["Issue"];
export type Page = S["Page"];
export type BoardView = S["BoardView"];
export type BoardLane = S["BoardLane"];
export type BoardIssue = S["BoardIssue"];
export type AuditEvent = S["AuditEvent"];
export type WorkspaceSettings = S["WorkspaceSettings"];
export type IssueRef = S["IssueRef"];
export type Item = Record<string, unknown>;
export type ProjectRef = Pick<Project, "id" | "key" | "name">;
