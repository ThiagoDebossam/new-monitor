import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createDb, type Database } from "./client.js";
import { sweep } from "./detector.js";
import { recordHeartbeat, recordOffline } from "./heartbeat.js";
import { incidents, instances, monitors, organizations, projects } from "./schema.js";

/**
 * "Cenários que decidem o produto" (CLAUDE.md). O primeiro é o mais importante: um monitor que
 * alarma em deploy é desinstalado em duas semanas. O último cenário da lista do CLAUDE.md — dez
 * quedas em cinco minutos → no máximo dois e-mails — depende do sistema de e-mail e fica para a
 * Fase 2 (ver ROADMAP.md).
 */
describe("cenários que decidem o produto — heartbeat + detector", () => {
  let container: StartedPostgreSqlContainer;
  let db: Database;
  let projectId: string;

  beforeAll(async () => {
    container = await new PostgreSqlContainer("postgres:16-alpine").start();
    db = createDb(container.getConnectionUri());
    await migrate(db, { migrationsFolder: "./migrations" });
  }, 60_000);

  afterAll(async () => {
    await container.stop();
  });

  beforeEach(async () => {
    const [org] = await db
      .insert(organizations)
      .values({ name: "Acme", slug: `acme-${crypto.randomUUID()}` })
      .returning();
    const [project] = await db
      .insert(projects)
      .values({ orgId: org!.id, name: "Default", slug: "default" })
      .returning();
    projectId = project!.id;
  });

  afterEach(async () => {
    await db.execute(sql`TRUNCATE incidents, instances, monitors, projects, organizations RESTART IDENTITY CASCADE`);
  });

  async function getMonitor(slug: string) {
    const [monitor] = await db
      .select()
      .from(monitors)
      .where(and(eq(monitors.projectId, projectId), eq(monitors.slug, slug)));
    if (!monitor) throw new Error(`monitor "${slug}" não encontrado`);
    return monitor;
  }

  async function backdateInstance(monitorId: string, instanceKey: string, secondsAgo: number) {
    await db
      .update(instances)
      .set({ expectedNextAt: new Date(Date.now() - secondsAgo * 1000) })
      .where(and(eq(instances.monitorId, monitorId), eq(instances.instanceKey, instanceKey)));
  }

  async function getInstance(monitorId: string, instanceKey: string) {
    const [instance] = await db
      .select()
      .from(instances)
      .where(and(eq(instances.monitorId, monitorId), eq(instances.instanceKey, instanceKey)));
    return instance;
  }

  async function openIncidents(monitorId: string) {
    return db.select().from(incidents).where(and(eq(incidents.monitorId, monitorId), sql`${incidents.resolvedAt} is null`));
  }

  it("primeiro heartbeat confirma o monitor (ADR-0006: pending → up, sem incidente)", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-primeiro", instanceKey: "inst-1", sequence: 0 });
    const monitor = await getMonitor("svc-primeiro");
    expect(monitor.status).toBe("up");
    expect(monitor.minHealthyInstances).toBe(1);
  });

  it("instância expira → monitor cai → incidente abre", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-expira", instanceKey: "inst-1", sequence: 0 });
    const monitor = await getMonitor("svc-expira");
    await backdateInstance(monitor.id, "inst-1", 1);

    const opened = await sweep(db);

    expect(opened.map((o) => o.monitorId)).toContain(monitor.id);
    const after = await getMonitor("svc-expira");
    expect(after.status).toBe("down");
    const instance = await getInstance(monitor.id, "inst-1");
    expect(instance?.status).toBe("down");
  });

  it("instância expira e volta → incidente resolve com duração correta", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-recupera", instanceKey: "inst-1", sequence: 0 });
    const monitor = await getMonitor("svc-recupera");
    await backdateInstance(monitor.id, "inst-1", 1);
    await sweep(db);
    expect((await getMonitor("svc-recupera")).status).toBe("down");

    await recordHeartbeat(db, { projectId, monitorSlug: "svc-recupera", instanceKey: "inst-1", sequence: 1 });

    const after = await getMonitor("svc-recupera");
    expect(after.status).toBe("up");
    const [incident] = await db.select().from(incidents).where(eq(incidents.monitorId, monitor.id));
    expect(incident?.resolvedAt).not.toBeNull();
    expect(incident!.resolvedAt!.getTime()).toBeGreaterThanOrEqual(incident!.startedAt.getTime());
    expect(await openIncidents(monitor.id)).toHaveLength(0);
  });

  it("deploy rolling com min=1 → nenhum incidente", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-deploy", instanceKey: "old", sequence: 0 });
    const monitor = await getMonitor("svc-deploy");
    // a réplica nova bate antes de a antiga expirar
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-deploy", instanceKey: "new", sequence: 0 });
    // só a antiga fica para trás
    await backdateInstance(monitor.id, "old", 1);

    const opened = await sweep(db);

    expect(opened.map((o) => o.monitorId)).not.toContain(monitor.id);
    expect((await getMonitor("svc-deploy")).status).toBe("up");
    expect((await getInstance(monitor.id, "old"))?.status).toBe("down");
    expect((await getInstance(monitor.id, "new"))?.status).toBe("up");
  });

  it("SIGTERM com réplica remanescente → nenhum incidente", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-sigterm", instanceKey: "a", sequence: 0 });
    const monitor = await getMonitor("svc-sigterm");
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-sigterm", instanceKey: "b", sequence: 0 });

    await recordOffline(db, { projectId, monitorSlug: "svc-sigterm", instanceKey: "a" });

    expect((await getInstance(monitor.id, "a"))?.status).toBe("ended");
    const opened = await sweep(db);
    expect(opened.map((o) => o.monitorId)).not.toContain(monitor.id);
    expect((await getMonitor("svc-sigterm")).status).toBe("up");
    expect(await openIncidents(monitor.id)).toHaveLength(0);
  });

  it("2 de 3 réplicas morrem com min=3 → incidente abre", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-tres", instanceKey: "a", sequence: 0 });
    const monitor = await getMonitor("svc-tres");
    await db.update(monitors).set({ minHealthyInstances: 3 }).where(eq(monitors.id, monitor.id));
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-tres", instanceKey: "b", sequence: 0 });
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-tres", instanceKey: "c", sequence: 0 });
    expect((await getMonitor("svc-tres")).status).toBe("up");

    await backdateInstance(monitor.id, "a", 1);
    await backdateInstance(monitor.id, "b", 1);

    const opened = await sweep(db);

    expect(opened.map((o) => o.monitorId)).toContain(monitor.id);
    expect((await getMonitor("svc-tres")).status).toBe("down");
  });

  it("dois detectores concorrentes → um único incidente", async () => {
    await recordHeartbeat(db, { projectId, monitorSlug: "svc-race", instanceKey: "inst-1", sequence: 0 });
    const monitor = await getMonitor("svc-race");
    await backdateInstance(monitor.id, "inst-1", 1);

    await Promise.all([sweep(db), sweep(db)]);

    const rows = await db.select().from(incidents).where(eq(incidents.monitorId, monitor.id));
    expect(rows).toHaveLength(1);
  });

  it("isolamento entre tenants: mesmo slug e mesma instance_key em projetos diferentes não colidem", async () => {
    const [otherOrg] = await db
      .insert(organizations)
      .values({ name: "Beta", slug: `beta-${crypto.randomUUID()}` })
      .returning();
    const [otherProject] = await db
      .insert(projects)
      .values({ orgId: otherOrg!.id, name: "Default", slug: "default" })
      .returning();
    const otherProjectId = otherProject!.id;

    await recordHeartbeat(db, { projectId, monitorSlug: "shared-slug", instanceKey: "shared-inst", sequence: 0 });
    await recordHeartbeat(db, { projectId: otherProjectId, monitorSlug: "shared-slug", instanceKey: "shared-inst", sequence: 0 });

    const [monitorA] = await db.select().from(monitors).where(and(eq(monitors.projectId, projectId), eq(monitors.slug, "shared-slug")));
    const [monitorB] = await db
      .select()
      .from(monitors)
      .where(and(eq(monitors.projectId, otherProjectId), eq(monitors.slug, "shared-slug")));
    expect(monitorA!.id).not.toBe(monitorB!.id);

    // offline no projeto A não pode encerrar a instância do projeto B
    await recordOffline(db, { projectId, monitorSlug: "shared-slug", instanceKey: "shared-inst" });
    expect((await getInstance(monitorA!.id, "shared-inst"))?.status).toBe("ended");
    expect((await getInstance(monitorB!.id, "shared-inst"))?.status).toBe("up");
  });
});
