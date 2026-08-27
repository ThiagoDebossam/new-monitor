import { describe, expect, it } from "vitest";

describe("detector scaffold", () => {
  it("existe um ponto de entrada", async () => {
    await expect(import("./index.js")).resolves.toBeDefined();
  });
});
