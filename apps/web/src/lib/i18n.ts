/**
 * Interface text. Each key has an English and a Spanish value; a missing Spanish value falls back to
 * English. The workspace language (Workspace settings) selects the catalogue. Dates and numbers use the
 * same language (see datetime.ts).
 */
const en = {
  "group.work": "Work",
  "group.plan": "Plan & connect",
  "group.org": "Organization",
  "nav.overview": "Overview",
  "nav.board": "Board",
  "nav.backlog": "Backlog",
  "nav.allWork": "All work",
  "nav.knowledge": "Knowledge",
  "nav.sprints": "Sprints",
  "nav.releases": "Releases",
  "nav.goals": "Goals",
  "nav.roadmap": "Roadmap",
  "nav.reports": "Reports",
  "nav.risks": "Risks",
  "nav.decisions": "Decisions",
  "nav.analytics": "Analytics",
  "nav.portfolio": "Portfolio",
  "nav.approvals": "Approvals",
  "nav.access": "Access",
  "nav.search": "Search",
  "nav.inbox": "Inbox",
  "nav.people": "People",
  "nav.automations": "Automations",
  "nav.integrations": "Integrations",
  "nav.security": "Security",
  "nav.identity": "Identity & SSO",
  "nav.billing": "Billing",
  "nav.audit": "Audit log",
  "board.swimlanes": "Swimlanes",
  "board.none": "None",
  "board.byAssignee": "By assignee",
  "board.byEpic": "By epic",
  "board.mine": "Mine",
  "board.unassigned": "Unassigned",
  "board.highPriority": "High priority",
  "board.clearFilters": "Clear quick filters",
  "board.quickFilters": "Quick filters",
  "board.workflow": "Workflow",
  "board.addIssue": "Add issue",
  "board.hint": "Drag cards between columns, or focus a card and press Alt + ← / →",
  "drawer.discussion": "Discussion",
  "drawer.fields": "Fields",
  "drawer.reminders": "Reminders",
  "drawer.connected": "Connected knowledge",
  "common.loading": "Loading…",
  "common.close": "Close",
};

export type MessageKey = keyof typeof en;
export type Locale = "en" | "es";

const es: Partial<Record<MessageKey, string>> = {
  "group.work": "Trabajo",
  "group.plan": "Planificar y conectar",
  "group.org": "Organización",
  "nav.overview": "Resumen",
  "nav.board": "Tablero",
  "nav.backlog": "Pendientes",
  "nav.allWork": "Todo el trabajo",
  "nav.knowledge": "Conocimiento",
  "nav.sprints": "Sprints",
  "nav.releases": "Versiones",
  "nav.goals": "Objetivos",
  "nav.roadmap": "Hoja de ruta",
  "nav.reports": "Informes",
  "nav.risks": "Riesgos",
  "nav.decisions": "Decisiones",
  "nav.analytics": "Analítica",
  "nav.portfolio": "Cartera",
  "nav.approvals": "Aprobaciones",
  "nav.access": "Acceso",
  "nav.search": "Buscar",
  "nav.inbox": "Bandeja",
  "nav.people": "Personas",
  "nav.automations": "Automatizaciones",
  "nav.integrations": "Integraciones",
  "nav.security": "Seguridad",
  "nav.identity": "Identidad y SSO",
  "nav.billing": "Facturación",
  "nav.audit": "Registro de auditoría",
  "board.swimlanes": "Carriles",
  "board.none": "Ninguno",
  "board.byAssignee": "Por responsable",
  "board.byEpic": "Por épica",
  "board.mine": "Mías",
  "board.unassigned": "Sin asignar",
  "board.highPriority": "Prioridad alta",
  "board.clearFilters": "Quitar filtros rápidos",
  "board.quickFilters": "Filtros rápidos",
  "board.workflow": "Flujo de trabajo",
  "board.addIssue": "Añadir incidencia",
  "board.hint": "Arrastra las tarjetas entre columnas, o enfoca una tarjeta y pulsa Alt + ← / →",
  "drawer.discussion": "Conversación",
  "drawer.fields": "Campos",
  "drawer.reminders": "Recordatorios",
  "drawer.connected": "Conocimiento relacionado",
  "common.loading": "Cargando…",
  "common.close": "Cerrar",
};

let current: Locale = "en";

/** Selects the language. Anything other than `es` falls back to English. */
export function setLocale(value: string | null | undefined) {
  current = value === "es" ? "es" : "en";
}

export function currentLocale(): Locale {
  return current;
}

export function t(key: MessageKey): string {
  if (current === "es") return es[key] ?? en[key];
  return en[key];
}
