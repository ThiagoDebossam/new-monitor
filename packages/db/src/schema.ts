// Fase 1 (ver docs/DISCOVERY.md §7 e §5). Cobre apenas as tabelas necessárias ao núcleo do
// heartbeat: organizations, projects, api_keys, monitors, instances, incidents.
// users/memberships (Fase 3) e notifications/notification_targets (Fase 2) chegam depois.
import { sql } from "drizzle-orm";
import { index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const monitorStatus = pgEnum("monitor_status", ["pending", "up", "down", "paused"]);
export const instanceStatus = pgEnum("instance_status", ["up", "down", "ended"]);

export const organizations = pgTable("organizations", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("projects_org_id_slug_idx").on(table.orgId, table.slug)],
);

// ADR-0007: hash apenas, prefixo reconhecível para varredura de segredos, escopo de projeto.
export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  keyPrefix: text("key_prefix").notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ADR-0003: Monitor é a definição lógica e estável; Instance (abaixo) é uma execução concreta.
export const monitors = pgTable(
  "monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    intervalSeconds: integer("interval_seconds").notNull(),
    graceSeconds: integer("grace_seconds").notNull(),
    minHealthyInstances: integer("min_healthy_instances").notNull(),
    status: monitorStatus("status").notNull().default("pending"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
    pausedUntil: timestamp("paused_until", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("monitors_project_id_slug_idx").on(table.projectId, table.slug)],
);

// ADR-0005: sem heartbeats persistidos — esta tabela guarda só o estado corrente por instância.
export const instances = pgTable(
  "instances",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    instanceKey: text("instance_key").notNull(),
    status: instanceStatus("status").notNull().default("up"),
    hostname: text("hostname"),
    pid: integer("pid"),
    sdkVersion: text("sdk_version"),
    appVersion: text("app_version"),
    environment: text("environment"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expectedNextAt: timestamp("expected_next_at", { withTimezone: true }).notNull(),
    lastSequence: integer("last_sequence"),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("instances_monitor_id_instance_key_idx").on(table.monitorId, table.instanceKey),
    // ADR-0004: sustenta a varredura periódica — custo proporcional às instâncias expiradas.
    index("instances_expiring_idx")
      .on(table.expectedNextAt)
      .where(sql`${table.status} = 'up'`),
  ],
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    monitorId: uuid("monitor_id")
      .notNull()
      .references(() => monitors.id, { onDelete: "cascade" }),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    cause: text("cause"),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
  },
  (table) => [
    // Torna impossível, no nível do banco, dois incidentes abertos simultâneos para o mesmo
    // monitor — a proteção contra corrida entre detectores concorrentes vive aqui, não na
    // aplicação (DISCOVERY.md §7).
    uniqueIndex("incidents_monitor_id_open_idx")
      .on(table.monitorId)
      .where(sql`${table.resolvedAt} is null`),
  ],
);
