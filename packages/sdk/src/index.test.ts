import { describe, expect, it } from "vitest";
import { SDK_NAME } from "./index.js";

describe("@pulse/node", () => {
  it("expõe o nome do pacote", () => {
    expect(SDK_NAME).toBe("@pulse/node");
  });
});
