import { afterEach, describe, expect, it } from "vitest";
import { serializeCookie } from "~/lib/supabase.server";

const previousNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
});

describe("Supabase cookie serialization", () => {
  it("always marks production cookies Secure", () => {
    process.env.NODE_ENV = "production";
    expect(serializeCookie("session", "value", { httpOnly: true })).toContain(
      "; Secure",
    );
  });

  it("does not force Secure outside production", () => {
    process.env.NODE_ENV = "development";
    expect(serializeCookie("session", "value", { httpOnly: true })).not.toContain(
      "; Secure",
    );
  });
});
