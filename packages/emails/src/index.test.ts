import { describe, expect, it } from "vitest";
import { PACKAGE_NAME } from "./index.js";

describe("@pulse/emails", () => {
  it("expõe o nome do pacote", () => {
    expect(PACKAGE_NAME).toBe("@pulse/emails");
  });
});
