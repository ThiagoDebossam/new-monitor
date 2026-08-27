import { createDb, type Database } from "@pulse/db/client";

let instance: Database | undefined;

// Singleton reaproveitado entre requisições no mesmo processo — abrir uma conexão por
// requisição custaria a latência que RNF-1 não permite.
export function getDb(): Database {
  if (!instance) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error("DATABASE_URL não definido");
    instance = createDb(databaseUrl);
  }
  return instance;
}
